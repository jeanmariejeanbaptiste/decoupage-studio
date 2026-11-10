import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../../seed/fiction';
import { db, deleteProject, listProjects, loadProject, saveProject } from '../../store/db';
import { removeProject, undoHome } from '../../store/homeHistory';
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

  it('copie, suppression et restauration sont annoncées aux autres onglets', async () => {
    await db.projects.clear();
    const orig = buildFiction();
    await saveProject(orig);
    const heard: Array<{ id: string; updatedAt: string; tab: string }> = [];
    const listener = new BroadcastChannel('ds-projects');
    listener.onmessage = (e) => heard.push(e.data);
    const wait = () => new Promise((r) => setTimeout(r, 30));

    const id = await duplicateProject(orig.project.id);
    await removeProject(orig.project.id);
    await undoHome(orig.project.id);
    await wait();
    listener.close();
    expect(heard.map((m) => m.id)).toEqual([id, orig.project.id, orig.project.id]);
    // Même format que les enregistrements ; une date vide ne fait rouvrir le projet nulle part.
    for (const m of heard) expect(m).toEqual({ id: m.id, updatedAt: '', tab: expect.any(String) });
  });
});
