import { produce } from 'immer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { mapPlaces } from '../domain/geo';
import { setDecorLocation } from '../domain/locations';
import { assignShots, updateDay } from '../domain/schedule';
import { watchPlaces } from './geocoder';
import { mutateDoc, undo, useProjectStore } from './projectStore';

function project() {
  const base = buildFiction();
  const [s1, s2] = base.project.sequenceIds;
  return produce(base, (d) => {
    assignShots(d, d.sequences[s1].shotIds, 1);
    assignShots(d, d.sequences[s2].shotIds, 2);
    setDecorLocation(d, d.sequences[s1].decorId!, { address: '20 bd Diderot, Paris' });
    updateDay(d, 2, { seqAddresses: { [s2]: 'Nulle part' } });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('géocodage des adresses', () => {
  it('une requête par seconde au plus, résultat gardé hors annulation, jamais redemandé', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; at: number }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push({ url, at: Date.now() });
        const hit = url.includes('Diderot') ? [{ lat: '48.8443', lon: '2.3744' }] : [];
        return { ok: true, json: async () => hit } as Response;
      }),
    );
    useProjectStore.getState().loadDoc(project());
    mutateDoc((d) => void (d.project.title = 'Avant'));
    const stop = watchPlaces(mapPlaces(useProjectStore.getState().doc!));
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(2);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
    expect(calls[0].url).toBe('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=20%20bd%20Diderot%2C%20Paris');
    const doc = useProjectStore.getState().doc!;
    expect(Object.values(doc.geocodes ?? {})).toEqual([
      { address: '20 bd Diderot, Paris', lat: 48.8443, lon: 2.3744 },
      { address: 'Nulle part', missing: true },
    ]);
    // Annuler défait la saisie, pas le géocodage.
    undo();
    expect(useProjectStore.getState().doc!.project.title).not.toBe('Avant');
    expect(Object.keys(useProjectStore.getState().doc!.geocodes ?? {})).toHaveLength(2);
    // Une seconde carte sur les mêmes adresses ne relance rien.
    stop();
    const again = watchPlaces(mapPlaces(useProjectStore.getState().doc!));
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(2);
    again();
  });

  it('service indisponible : nouvel essai une minute plus tard, espacé après un refus 429', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    let status = 429;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.push(Date.now());
        return { ok: status === 200, status, json: async () => [{ lat: '45.76', lon: '4.83' }] } as Response;
      }),
    );
    const doc = produce(project(), (d) => {
      updateDay(d, 2, { seqAddresses: {} });
      setDecorLocation(d, d.sequences[d.project.sequenceIds[0]].decorId!, { address: '2 place Bellecour, Lyon' });
    });
    useProjectStore.getState().loadDoc(doc);
    const stop = watchPlaces(mapPlaces(doc));
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1);
    // Rien d'autre pendant la minute d'attente.
    status = 200;
    await vi.advanceTimersByTimeAsync(50_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toHaveLength(2);
    expect(Object.values(useProjectStore.getState().doc!.geocodes ?? {})).toEqual([{ address: '2 place Bellecour, Lyon', lat: 45.76, lon: 4.83 }]);
    stop();
  });

  it('carte masquée pendant la pause qui suit un refus 429 : aucune requête ne part', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: false, status: 429, json: async () => [] } as Response;
      }),
    );
    const doc = produce(project(), (d) => {
      updateDay(d, 2, { seqAddresses: {} });
      setDecorLocation(d, d.sequences[d.project.sequenceIds[0]].decorId!, { address: '5 rue Mercière, Lyon' });
    });
    useProjectStore.getState().loadDoc(doc);
    const stop = watchPlaces(mapPlaces(doc));
    // Le refus (après l'éventuelle pause laissée par un test précédent).
    for (let i = 0; i < 120 && !calls.length; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    // Nouvelle adresse demandée, mais la pause de 30 s court ; la carte est masquée avant la fin.
    const stop2 = watchPlaces(mapPlaces(produce(doc, (d) => setDecorLocation(d, d.sequences[d.project.sequenceIds[0]].decorId!, { address: '9 quai Saint-Antoine, Lyon' }))));
    await vi.advanceTimersByTimeAsync(10_000);
    stop();
    stop2();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(1);
  });

  it('rien ne part hors ligne', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const doc = produce(project(), (d) => {
      setDecorLocation(d, d.sequences[d.project.sequenceIds[0]].decorId!, { address: '1 rue Ailleurs, Lyon' });
    });
    useProjectStore.getState().loadDoc(doc);
    const stop = watchPlaces(mapPlaces(doc));
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).not.toHaveBeenCalled();
    stop();
    online.mockRestore();
  });
});
