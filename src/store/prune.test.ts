import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { projectCopy } from '../domain/serialize';
import { db, deleteProject, saveProject } from './db';
import { holdTabLock, otherTabsOpen, pruneOrphanBlobs } from './persistence';

describe('ménage des images', () => {
  it('retire les images qu’aucun projet n’utilise, garde les autres', async () => {
    const doc = buildFiction();
    const shotId = Object.keys(doc.shots)[0];
    doc.shots[shotId].storyboard = { blobKey: `${doc.project.id}:gardee` };
    doc.floorPlans = { [doc.project.sequenceIds[0]]: { items: [], bg: { blobKey: `${doc.project.id}:fond`, opacity: 0.5, x: 0, y: 0, w: 1000 } } };
    await saveProject(doc);
    const blob = new Blob(['x'], { type: 'image/png' });
    await db.blobs.bulkPut([
      { key: `${doc.project.id}:gardee`, projectId: doc.project.id, name: 'a.png', blob },
      { key: `${doc.project.id}:fond`, projectId: doc.project.id, name: 'b.png', blob },
      { key: `${doc.project.id}:remplacee`, projectId: doc.project.id, name: 'c.png', blob },
      { key: 'projet-efface:image', projectId: 'projet-efface', name: 'd.png', blob },
    ]);
    expect(await pruneOrphanBlobs()).toBe(2);
    const left = (await db.blobs.toCollection().primaryKeys()).sort();
    expect(left).toEqual([`${doc.project.id}:fond`, `${doc.project.id}:gardee`]);
  });

  it('ne touche à rien quand un autre onglet est ouvert (son historique peut rétablir une image)', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await db.blobs.put({ key: 'ailleurs:remplacee', projectId: 'ailleurs', name: 'r.png', blob });
    const nav = navigator as unknown as { locks?: unknown };
    const holders = [{ name: 'ds-tabs' }];
    nav.locks = { request: () => new Promise(() => undefined), query: async () => ({ held: holders }) };
    try {
      holdTabLock();
      // Un second onglet tient aussi le verrou : pas de ménage.
      holders.push({ name: 'ds-tabs' });
      expect(await otherTabsOpen()).toBe(true);
      expect(await pruneOrphanBlobs()).toBe(0);
      expect(await db.blobs.get('ailleurs:remplacee')).toBeDefined();
      holders.pop();
      expect(await otherTabsOpen()).toBe(false);
      expect(await pruneOrphanBlobs()).toBe(1);
    } finally {
      delete nav.locks;
    }
  });
});

describe('suppression d’un projet copié', () => {
  it('garde les images encore utilisées par la copie, efface les autres', async () => {
    await db.blobs.clear();
    await db.projects.clear();
    const orig = buildFiction();
    const shotId = Object.keys(orig.shots)[0];
    orig.shots[shotId].storyboard = { blobKey: `${orig.project.id}:commune` };
    const copy = projectCopy(orig, 'copie-1');
    await saveProject(orig);
    await saveProject(copy);
    const blob = new Blob(['x'], { type: 'image/png' });
    await db.blobs.bulkPut([
      { key: `${orig.project.id}:commune`, projectId: orig.project.id, name: 'a.png', blob },
      { key: `${orig.project.id}:propre`, projectId: orig.project.id, name: 'b.png', blob },
    ]);
    await deleteProject(orig.project.id);
    const left = await db.blobs.toArray();
    expect(left.map((b) => [b.key, b.projectId])).toEqual([[`${orig.project.id}:commune`, 'copie-1']]);
    await deleteProject('copie-1');
    expect(await db.blobs.count()).toBe(0);
  });
});
