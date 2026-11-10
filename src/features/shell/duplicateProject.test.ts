import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { db, deleteProject, listProjects, loadProject, saveProject } from '../../store/db';
import { duplicateProject } from './duplicateProject';

describe('dupliquer un projet', () => {
  it('donne un second projet, et la copie garde ses images quand l’original est supprimé', async () => {
    await db.blobs.clear();
    await db.projects.clear();
    const orig = buildFiction();
    const shotId = Object.keys(orig.shots)[0];
    orig.shots[shotId].storyboard = { blobKey: `${orig.project.id}:image` };
    await saveProject(orig);
    await db.blobs.put({ key: `${orig.project.id}:image`, projectId: orig.project.id, name: 'a.png', blob: new Blob(['x'], { type: 'image/png' }) });

    const id = await duplicateProject(orig.project.id);
    expect(id).toBeTruthy();
    expect(id).not.toBe(orig.project.id);
    const list = await listProjects();
    expect(list.map((p) => p.title).sort()).toEqual(['La Consigne', 'La Consigne (copie)']);
    const copy = await loadProject(id!);
    expect(Object.keys(copy!.shots)).toEqual(Object.keys(orig.shots));

    await deleteProject(orig.project.id);
    expect(await db.blobs.get(`${orig.project.id}:image`)).toBeTruthy();
  });

  it('projet introuvable : rien', async () => {
    expect(await duplicateProject('absent')).toBeNull();
  });
});
