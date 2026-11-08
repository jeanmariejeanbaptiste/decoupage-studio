import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { db, saveProject } from './db';
import { pruneOrphanBlobs } from './persistence';

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
});
