import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { projectCopy, serializeDoc } from '../domain/serialize';
import { db, getBlob, loadProject, saveProject } from './db';
import { flushSave, onTabMessage, openDoc, openFromFile, openStoredProject, restoreMedia, RETRY_DELAYS, startAutosave, warnUnsaved } from './persistence';
import { mutateDoc, useProjectStore } from './projectStore';
import { useUi } from './uiStore';

const status = () => useUi.getState().saveStatus;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('échec d’enregistrement', () => {
  it('garde la modification et la réessaie seule, jusqu’à la réussite', async () => {
    const doc = buildFiction();
    useProjectStore.getState().loadDoc(doc);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const put = vi.spyOn(db.projects, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await flushSave();
    expect(status()).toBe('error');
    expect(await loadProject(doc.project.id)).toBeUndefined();
    vi.advanceTimersByTime(RETRY_DELAYS[0]);
    vi.useRealTimers();
    await vi.waitFor(() => expect(status()).toBe('saved'));
    expect(put).toHaveBeenCalledTimes(2);
    expect((await loadProject(doc.project.id))?.project.title).toBe(doc.project.title);
  });

  it('enregistrement en échec : on reste sur le projet plutôt que de perdre sa saisie en en ouvrant un autre', async () => {
    const stop = startAutosave();
    const a = buildFiction();
    useProjectStore.getState().loadDoc(a);
    await flushSave();
    const b = projectCopy(buildFiction(), 'projet-b');
    await saveProject(b);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mutateDoc((d) => void (d.project.director = 'Saisie de A'));
    vi.spyOn(db.projects, 'put').mockRejectedValue(new Error('QuotaExceededError'));
    expect(await openStoredProject('projet-b')).toBe(false);
    expect(await openDoc(projectCopy(buildFiction(), 'projet-c'))).toBe(false);
    expect(useProjectStore.getState().doc?.project.id).toBe(a.project.id);
    expect(status()).toBe('error');
    // Stockage rétabli : la saisie de A est enregistrée, puis B s'ouvre.
    vi.mocked(db.projects.put).mockRestore();
    expect(await openStoredProject('projet-b')).toBe(true);
    expect((await loadProject(a.project.id))?.project.director).toBe('Saisie de A');
    stop();
  });

  it('prévient avant de fermer l’onglet seulement après un échec', () => {
    const ev = () => new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    useUi.getState().set({ saveStatus: 'error' });
    const failed = ev();
    warnUnsaved(failed);
    expect(failed.defaultPrevented).toBe(true);
    for (const s of ['saved', 'dirty'] as const) {
      useUi.getState().set({ saveStatus: s });
      const ok = ev();
      warnUnsaved(ok);
      expect(ok.defaultPrevented).toBe(false);
    }
  });

  it('n’affiche pas « Enregistré » quand une saisie est arrivée pendant l’écriture', async () => {
    const stop = startAutosave();
    useProjectStore.getState().loadDoc(buildFiction());
    const saving = flushSave();
    mutateDoc((d) => void (d.project.title = 'Saisi pendant l’écriture'));
    await saving;
    expect(status()).toBe('dirty');
    await flushSave();
    expect(status()).toBe('saved');
    stop();
  });
});

describe('plusieurs onglets', () => {
  it('relit la version plus récente d’un autre onglet sans l’écraser', async () => {
    const mine = buildFiction();
    useProjectStore.getState().loadDoc(mine);
    const theirs = structuredClone(mine);
    theirs.project.title = 'Modifié ailleurs';
    theirs.project.updatedAt = new Date(Date.parse(mine.project.updatedAt) + 60_000).toISOString();
    await saveProject(theirs);
    onTabMessage({ id: mine.project.id, updatedAt: theirs.project.updatedAt, tab: 'autre' });
    await vi.waitFor(() => expect(useProjectStore.getState().doc?.project.title).toBe('Modifié ailleurs'));
    expect((await loadProject(mine.project.id))?.project.title).toBe('Modifié ailleurs');
  });

  it('projet supprimé dans un autre onglet : déchargé ici, jamais réenregistré', async () => {
    const stop = startAutosave();
    const doc = buildFiction();
    useProjectStore.getState().loadDoc(doc);
    mutateDoc((d) => void (d.project.title = 'En attente'));
    await db.projects.delete(doc.project.id);
    onTabMessage({ id: doc.project.id, updatedAt: new Date().toISOString(), tab: 'autre', deleted: true });
    expect(useProjectStore.getState().doc).toBeNull();
    await flushSave();
    expect(await loadProject(doc.project.id)).toBeUndefined();
    stop();
  });
});

describe('médias d’un fichier ouvert', () => {
  it('un média mal encodé est passé, les autres sont rangés', async () => {
    const doc = buildFiction();
    const text = serializeDoc(doc, undefined, {
      'm:bon': { type: 'image/png', data: btoa('png') },
      'm:abime': { type: 'image/png', data: '%%% pas du base 64' },
    });
    expect(await restoreMedia(text, doc.project.id)).toBe(1);
    expect(await getBlob('m:bon', false)).toBeDefined();
    expect(await getBlob('m:abime', false)).toBeUndefined();
  });

  it('stockage du navigateur indisponible : un message en français, jamais le texte technique', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db.projects, 'get').mockRejectedValueOnce(new Error('DatabaseClosedError: UnknownError Internal error opening backing store'));
    // jsdom ne connaît pas File.text().
    const fileOf = (text: string) => Object.assign(new File([text], 'film.decoupage'), { text: async () => text });
    const file = fileOf(serializeDoc(buildFiction()));
    expect(await openFromFile(file)).toBe(false);
    const last = useUi.getState().toasts.at(-1)!;
    expect(last.message).toBe('Ce fichier n’a pas pu être ouvert dans ce navigateur.');
    expect(await openFromFile(fileOf('{"doc": tronqué'))).toBe(false);
    expect(useUi.getState().toasts.at(-1)!.message).toBe('Le fichier n’est pas un JSON valide.');
  });
});
