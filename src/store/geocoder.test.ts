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
