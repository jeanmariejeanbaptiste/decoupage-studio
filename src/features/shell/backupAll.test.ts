import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { mediaOfFile, parseProjectFile, projectCopy } from '../../domain/serialize';
import { db, saveProject } from '../../store/db';
import { buildBackupZip, uniqueName } from './backupAll';

// Les Blob relus de fake-indexeddb ne passent pas par le FileReader de jsdom : médias trouvés en base, contenu fixe.
vi.mock('../../store/persistence', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../store/persistence')>();
  const { mediaKeys } = await import('../../domain/serialize');
  const { db: base } = await import('../../store/db');
  return {
    ...real,
    collectMedia: async (doc: Parameters<typeof mediaKeys>[0]) => {
      const out: Record<string, { type: string; data: string }> = {};
      for (const key of mediaKeys(doc)) if (await base.blobs.get(key)) out[key] = { type: 'image/png', data: 'cG5n' };
      return out;
    },
  };
});

describe('sauvegarde de tous les projets', () => {
  it('nomme sans doublon', () => {
    const taken = new Set<string>();
    expect(uniqueName('film.decoupage', taken)).toBe('film.decoupage');
    expect(uniqueName('film.decoupage', taken)).toBe('film-2.decoupage');
    expect(uniqueName('film.decoupage', taken)).toBe('film-3.decoupage');
  });

  it('un fichier .decoupage par projet, images comprises, relisible', async () => {
    await db.blobs.clear();
    await db.projects.clear();
    const a = buildFiction();
    const shotId = Object.keys(a.shots)[0];
    a.shots[shotId].storyboard = { blobKey: `${a.project.id}:image` };
    // Même titre et même version : deux noms distincts dans l'archive.
    const b = { ...projectCopy(a, 'autre'), project: { ...a.project, id: 'autre' } };
    await saveProject(a);
    await saveProject(b);
    await db.blobs.put({ key: `${a.project.id}:image`, projectId: a.project.id, name: 'a.png', blob: new Blob(['png'], { type: 'image/png' }) });

    const { data, count } = await buildBackupZip();
    expect(count).toBe(2);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files).sort();
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    const ids: string[] = [];
    for (const n of names) {
      const text = await zip.file(n)!.async('string');
      ids.push(parseProjectFile(text).project.id);
      expect(Object.keys(mediaOfFile(text))).toEqual([`${a.project.id}:image`]);
    }
    expect(ids.sort()).toEqual([a.project.id, 'autre'].sort());
  });
});
