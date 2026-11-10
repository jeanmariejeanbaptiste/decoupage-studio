import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { projectCopy, serializeDoc } from '../domain/serialize';
import { db, loadProject, saveProject } from './db';
import { useProjectStore } from './projectStore';
import { DRIVE_API, DRIVE_UPLOAD, SCOPE_APPDATA } from './googleUrls';

/** Dossier de l'application dans un Drive simulé : identifiant → propriétés et contenu. */
const files = new Map<string, { name: string; appProperties: Record<string, string>; body: string }>();
let seq = 0;
/** Envois de projet refusés (coupure) avant le retour à la normale. */
let failProjectUploads = 0;

async function fakeDrive(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = init.method ?? 'GET';
  const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.startsWith(`${DRIVE_UPLOAD}/files`)) {
    const text = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsText(init.body as Blob);
    });
    const boundary = text.slice(2, text.indexOf('\r\n'));
    const [, metaPart, bodyPart] = text.split(`--${boundary}`);
    const meta = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).trim()) as { name: string; appProperties: Record<string, string> };
    if (meta.appProperties.kind === 'project' && failProjectUploads > 0) {
      failProjectUploads -= 1;
      return new Response('', { status: 500 });
    }
    const body = bodyPart.slice(bodyPart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
    const id = method === 'PATCH' ? url.slice(`${DRIVE_UPLOAD}/files/`.length).split('?')[0] : `f${++seq}`;
    files.set(id, { name: meta.name, appProperties: meta.appProperties, body });
    return json({ id });
  }
  if (url.startsWith(`${DRIVE_API}/files?`)) return json({ files: [...files].map(([id, f]) => ({ id, name: f.name, appProperties: f.appProperties })) });
  const id = url.slice(`${DRIVE_API}/files/`.length).split('?')[0];
  if (method === 'DELETE') {
    files.delete(id);
    return new Response(null, { status: 204 });
  }
  const f = files.get(id);
  return f ? new Response(f.body, { status: 200 }) : new Response('', { status: 404 });
}

let cloud: typeof import('./cloud');

beforeAll(async () => {
  localStorage.setItem('ds-cloud-user', JSON.stringify({ email: 'test@example.com' }));
  localStorage.setItem('ds-cloud-token', JSON.stringify([{ token: 'jeton', expiresAt: Date.now() + 3_600_000, scopes: [SCOPE_APPDATA] }]));
  vi.stubGlobal('fetch', vi.fn(fakeDrive));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  cloud = await import('./cloud');
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('synchronisation Google Drive', () => {
  it('un fichier distant abîmé n’empêche pas les autres projets de suivre', async () => {
    await db.projects.clear();
    files.clear();
    const good = buildFiction();
    files.set('abime', { name: 'x.decoupage', appProperties: { kind: 'project', projectId: 'abime', updatedAt: '2026-11-10T10:00:00Z', title: 'Abîmé' }, body: '{"doc": tronqué' });
    files.set('bon', { name: 'y.decoupage', appProperties: { kind: 'project', projectId: good.project.id, updatedAt: good.project.updatedAt, title: good.project.title }, body: serializeDoc(good) });
    await cloud.syncAll();
    expect((await loadProject(good.project.id))?.project.title).toBe(good.project.title);
    expect(cloud.useCloud.getState().status).toBe('error');
    expect(cloud.useCloud.getState().error).toContain('Abîmé');
  });

  it('original supprimé : les images que sa copie utilise restent dans le Drive', async () => {
    await db.projects.clear();
    await db.blobs.clear();
    files.clear();
    useProjectStore.getState().loadDoc(null);
    const orig = buildFiction();
    orig.shots[Object.keys(orig.shots)[0]].storyboard = { blobKey: `${orig.project.id}:commune` };
    const copy = projectCopy(orig, 'duplique');
    await saveProject(orig);
    await saveProject(copy);
    await db.blobs.put({ key: `${orig.project.id}:commune`, projectId: orig.project.id, name: 'a.png', blob: new Blob(['png'], { type: 'image/png' }) });
    await cloud.syncAll();
    // Suppression de l'original ici (la copie reste), reportée dans le Drive.
    await db.projects.delete(orig.project.id);
    await cloud.cloudForget(orig.project.id);
    expect([...files.values()].some((f) => f.appProperties.kind === 'blob' && f.appProperties.key === `${orig.project.id}:commune`)).toBe(true);
    // Un appareil neuf récupère la copie avec son image.
    await db.projects.clear();
    await db.blobs.clear();
    await cloud.syncAll();
    expect(await loadProject('duplique')).toBeDefined();
    expect(await db.blobs.get(`${orig.project.id}:commune`)).toBeDefined();
  });

  it('les images d’une copie partent avec elle, même rangées sous l’original', async () => {
    await db.projects.clear();
    await db.blobs.clear();
    files.clear();
    const orig = buildFiction();
    const copy = projectCopy(orig, 'copie-1');
    copy.shots[Object.keys(copy.shots)[0]].storyboard = { blobKey: `${orig.project.id}:image` };
    await saveProject(copy);
    await db.blobs.put({ key: `${orig.project.id}:image`, projectId: orig.project.id, name: 'a.png', blob: new Blob(['png'], { type: 'image/png' }) });
    await cloud.syncAll();
    expect(cloud.useCloud.getState().error).toBeUndefined();
    const sent = [...files.values()].filter((f) => f.appProperties.kind === 'blob').map((f) => f.appProperties.key);
    expect(sent).toEqual([`${orig.project.id}:image`]);

    // Sur un autre appareil, la copie arrive avec son image.
    await db.projects.clear();
    await db.blobs.clear();
    await cloud.syncAll();
    expect(await loadProject('copie-1')).toBeDefined();
    expect(await db.blobs.get(`${orig.project.id}:image`)).toBeDefined();
  });

  it('version tirée du Drive pour le projet ouvert : relue telle quelle, sans y réécrire celle de l’onglet', async () => {
    await db.projects.clear();
    files.clear();
    const mine = buildFiction();
    await saveProject(mine);
    useProjectStore.getState().loadDoc(mine);
    const theirs = structuredClone(mine);
    theirs.project.title = 'Modifié sur un autre appareil';
    theirs.project.updatedAt = new Date(Date.parse(mine.project.updatedAt) + 60_000).toISOString();
    files.set('p', { name: 'p.decoupage', appProperties: { kind: 'project', projectId: mine.project.id, updatedAt: theirs.project.updatedAt, title: 'x' }, body: serializeDoc(theirs) });
    await cloud.syncAll();
    expect(useProjectStore.getState().doc?.project.title).toBe('Modifié sur un autre appareil');
    expect((await loadProject(mine.project.id))?.project.title).toBe('Modifié sur un autre appareil');
  });

  it('modifié des deux côtés depuis la dernière synchronisation : la version écartée est gardée en copie', async () => {
    await db.projects.clear();
    files.clear();
    useProjectStore.getState().loadDoc(null);
    const base = buildFiction();
    base.project.id = 'conflit';
    base.project.updatedAt = '2026-11-10T09:00:00.000Z';
    await saveProject(base);
    await cloud.syncAll();
    expect([...files.values()].some((f) => f.appProperties.projectId === 'conflit')).toBe(true);
    // Hors connexion, chacun de son côté.
    const here = structuredClone(base);
    here.project.director = 'Modifié ici';
    here.project.updatedAt = '2026-11-10T10:00:00.000Z';
    await saveProject(here);
    const there = structuredClone(base);
    there.project.director = 'Modifié là-bas';
    there.project.updatedAt = '2026-11-10T11:00:00.000Z';
    const [fileId] = [...files].find(([, f]) => f.appProperties.kind === 'project')!;
    files.set(fileId, { ...files.get(fileId)!, appProperties: { kind: 'project', projectId: 'conflit', updatedAt: there.project.updatedAt, title: 'x' }, body: serializeDoc(there) });
    await cloud.syncAll();
    const all = await db.projects.toArray();
    expect((await loadProject('conflit'))?.project.director).toBe('Modifié là-bas');
    const copy = all.find((p) => p.id !== 'conflit');
    expect(copy?.title).toMatch(/\(conflit du /);
    expect(copy?.doc.project.director).toBe('Modifié ici');
    // Sans modification des deux côtés, aucune copie de plus.
    await cloud.syncAll();
    expect(await db.projects.count()).toBe(2);
  });

  it('conflit dans l’autre sens, envoi coupé : une seule copie, avec ses images', async () => {
    await db.projects.clear();
    await db.blobs.clear();
    files.clear();
    useProjectStore.getState().loadDoc(null);
    const base = buildFiction();
    base.project.id = 'conflit-2';
    base.project.updatedAt = '2026-11-10T09:00:00.000Z';
    await saveProject(base);
    await cloud.syncAll();
    // Là-bas, une image ajoutée (rangée dans le Drive) ; ici, une modification plus récente.
    const there = structuredClone(base);
    there.shots[Object.keys(there.shots)[0]].storyboard = { blobKey: 'conflit-2:image' };
    there.project.updatedAt = '2026-11-10T10:00:00.000Z';
    const [fileId] = [...files].find(([, f]) => f.appProperties.kind === 'project')!;
    files.set(fileId, { ...files.get(fileId)!, appProperties: { kind: 'project', projectId: 'conflit-2', updatedAt: there.project.updatedAt, title: 'x' }, body: serializeDoc(there) });
    files.set('img', { name: 'blob', appProperties: { kind: 'blob', key: 'conflit-2:image', projectId: 'conflit-2' }, body: 'png' });
    const here = structuredClone(base);
    here.project.director = 'Modifié ici';
    here.project.updatedAt = '2026-11-10T11:00:00.000Z';
    await saveProject(here);
    failProjectUploads = 1;
    await cloud.syncAll();
    expect(cloud.useCloud.getState().status).toBe('error');
    await cloud.syncAll();
    expect(cloud.useCloud.getState().status).toBe('idle');
    const copies = (await db.projects.toArray()).filter((p) => p.id !== 'conflit-2');
    expect(copies).toHaveLength(1);
    expect(copies[0].title).toMatch(/\(conflit du /);
    expect(await db.blobs.get('conflit-2:image')).toBeDefined();
    expect(files.get(fileId)!.appProperties.updatedAt).toBe(here.project.updatedAt);
  });
});
