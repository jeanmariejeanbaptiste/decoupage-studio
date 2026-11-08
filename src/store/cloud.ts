/**
 * Synchronisation facultative avec Google Drive : chaque projet (et ses images) est rangé dans le
 * dossier privé de l'application (`appDataFolder`, invisible dans le Drive de l'utilisateur), via
 * Google Identity Services côté navigateur. Rien ne transite par un autre serveur.
 * Le jeton d'accès ne vit qu'en mémoire ; seule l'identité (nom, adresse) est mémorisée.
 */
import { create } from 'zustand';
import { GOOGLE_CLIENT_ID } from '../app/config';
import { parseProjectFile, serializeDoc } from '../domain/serialize';
import type { ProjectDoc } from '../domain/types';
import { db, deleteProject, listProjects, loadProject, saveProject } from './db';
import { flushEditors, flushSave, openStoredProject } from './persistence';
import { useProjectStore } from './projectStore';
import { useUi } from './uiStore';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata openid email profile';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const USER_KEY = 'ds-cloud-user';
const TOMB_KEY = 'ds-cloud-deleted';
const PUSH_DELAY = 4000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; hint?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string; message?: string }) => void; hint?: string }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

export interface CloudUser {
  email: string;
  name?: string;
  picture?: string;
}

interface CloudState {
  /** Connexion possible : un identifiant d'application Google est configuré. */
  enabled: boolean;
  user: CloudUser | null;
  /** Jeton valide en mémoire. */
  connected: boolean;
  status: 'idle' | 'syncing' | 'error';
  lastSync?: string;
  error?: string;
}

function storedUser(): CloudUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

export const useCloud = create<CloudState>(() => ({ enabled: !!GOOGLE_CLIENT_ID, user: storedUser(), connected: false, status: 'idle' }));

let token: string | null = null;
let expiresAt = 0;
let client: TokenClient | null = null;
let gisPromise: Promise<void> | null = null;

const gis = () => (window as unknown as { google?: Gis }).google;
const valid = () => !!token && Date.now() < expiresAt;

/** Charge le script de Google à l'avance : le clic de connexion doit ouvrir la fenêtre sans attendre. */
export function preloadGoogle(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) return Promise.resolve();
  if (gis()) return Promise.resolve();
  gisPromise ??= new Promise<void>((ok, ko) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = () => ok();
    sc.onerror = () => {
      gisPromise = null;
      ko(new Error('Service de connexion Google injoignable.'));
    };
    document.head.appendChild(sc);
  });
  return gisPromise;
}

function fail(message: string) {
  useCloud.setState({ status: 'error', error: message });
}

/** Connexion (à appeler directement depuis un clic : Safari bloque sinon la fenêtre de Google). */
export function signIn(): void {
  const g = gis();
  if (!g) {
    void preloadGoogle().then(() => useUi.getState().toast({ message: 'Connexion prête : cliquez de nouveau.' }), (e: Error) => fail(e.message));
    return;
  }
  const user = useCloud.getState().user;
  client ??= g.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (r) => void onToken(r),
    error_callback: (e) => fail(e.type === 'popup_closed' ? 'Connexion annulée.' : 'Connexion impossible.'),
  });
  client.requestAccessToken({ prompt: user ? '' : 'consent', hint: user?.email });
}

async function onToken(r: TokenResponse) {
  if (r.error || !r.access_token) return fail(r.error_description || 'Connexion refusée.');
  token = r.access_token;
  expiresAt = Date.now() + Math.max(60, (r.expires_in ?? 3600) - 60) * 1000;
  try {
    const me = (await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${token}` } })).json()) as { email?: string; name?: string; picture?: string };
    const user: CloudUser = { email: me.email ?? '', name: me.name, picture: me.picture };
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* stockage indisponible */
    }
    useCloud.setState({ user, connected: true, error: undefined });
  } catch {
    useCloud.setState({ connected: true });
  }
  await syncAll();
}

export function signOut(): void {
  const t = token;
  token = null;
  expiresAt = 0;
  if (t) gis()?.accounts.oauth2.revoke(t);
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* stockage indisponible */
  }
  useCloud.setState({ user: null, connected: false, status: 'idle', error: undefined, lastSync: undefined });
}

// --- Drive ---------------------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  if (!valid()) {
    useCloud.setState({ connected: false });
    throw new Error('Session Google expirée : reconnectez-vous.');
  }
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = null;
    useCloud.setState({ connected: false });
    throw new Error('Session Google expirée : reconnectez-vous.');
  }
  if (!res.ok) throw new Error(`Google Drive a répondu ${res.status}.`);
  return res;
}

async function listFiles(): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let page = '';
  do {
    const q = `spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,appProperties)${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const j = (await (await drive(`${API}/files?${q}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(j.files ?? []));
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

async function upload(meta: Record<string, unknown>, blob: Blob, id?: string): Promise<string> {
  const b = `ds${Math.random().toString(36).slice(2)}`;
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${b}--`]);
  const url = id ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
  const res = await drive(url, { method: id ? 'PATCH' : 'POST', headers: { 'content-type': `multipart/related; boundary=${b}` }, body });
  return ((await res.json()) as { id: string }).id;
}

const download = async (id: string) => (await drive(`${API}/files/${id}?alt=media`)).blob();
const removeFile = (id: string) => drive(`${API}/files/${id}`, { method: 'DELETE' });

/** Suppressions faites ici hors connexion, à reporter dans le Drive (identifiant et date). */
interface Tomb {
  id: string;
  at: string;
}
function tombstones(): Tomb[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMB_KEY) ?? '[]') as Array<string | Tomb>;
    // Ancien format : identifiants seuls.
    return raw.map((x) => (typeof x === 'string' ? { id: x, at: new Date(0).toISOString() } : x));
  } catch {
    return [];
  }
}
function setTombstones(list: Tomb[]) {
  try {
    const byId = new Map(list.map((x) => [x.id, x]));
    localStorage.setItem(TOMB_KEY, JSON.stringify([...byId.values()]));
  } catch {
    /* stockage indisponible */
  }
}

/** Projet supprimé : ses fichiers quittent le Drive, une marque datée prévient les autres appareils. */
async function buryRemote(projectId: string, at: string, files: DriveFile[]): Promise<void> {
  for (const f of files) if (f.appProperties?.projectId === projectId && f.appProperties.kind !== 'tombstone') await removeFile(f.id);
  const old = files.find((f) => f.appProperties?.kind === 'tombstone' && f.appProperties.projectId === projectId);
  await upload(
    { name: `deleted-${projectId}`, ...(old ? {} : { parents: ['appDataFolder'] }), appProperties: { kind: 'tombstone', projectId, deletedAt: at } },
    new Blob(['{}'], { type: 'application/json' }),
    old?.id,
  );
}

async function pushProject(doc: ProjectDoc, files: DriveFile[]): Promise<void> {
  const existing = files.find((f) => f.appProperties?.kind === 'project' && f.appProperties.projectId === doc.project.id);
  const meta: Record<string, unknown> = {
    name: `${doc.project.id}.decoupage`,
    appProperties: { kind: 'project', projectId: doc.project.id, updatedAt: doc.project.updatedAt, title: doc.project.title.slice(0, 80) },
  };
  if (!existing) meta.parents = ['appDataFolder'];
  await upload(meta, new Blob([serializeDoc(doc)], { type: 'application/json' }), existing?.id);
  // Images : celles qui manquent dans le Drive.
  const remote = new Set(files.filter((f) => f.appProperties?.kind === 'blob').map((f) => f.appProperties!.key));
  const rows = await db.blobs.where('projectId').equals(doc.project.id).toArray();
  for (const r of rows) {
    if (remote.has(r.key)) continue;
    await upload({ name: `blob-${r.key.replace(/[^\w.-]+/g, '_')}`, parents: ['appDataFolder'], appProperties: { kind: 'blob', key: r.key, projectId: r.projectId } }, r.blob);
  }
}

async function pullBlobs(projectId: string, files: DriveFile[]): Promise<void> {
  const local = new Set((await db.blobs.where('projectId').equals(projectId).primaryKeys()) as string[]);
  for (const f of files) {
    const p = f.appProperties;
    if (p?.kind !== 'blob' || p.projectId !== projectId || local.has(p.key)) continue;
    await db.blobs.put({ key: p.key, projectId, name: p.key, blob: await download(f.id) });
  }
}

/** Rapproche le navigateur et le Drive : le plus récent l'emporte, projet par projet. */
export async function syncAll(): Promise<void> {
  if (useCloud.getState().status === 'syncing') return;
  useCloud.setState({ status: 'syncing', error: undefined });
  try {
    // Saisie en attente enregistrée d'abord : le projet ouvert ne peut pas être écrasé par une version plus ancienne.
    flushEditors();
    await flushSave();
    let files = await listFiles();
    // Projets supprimés ici hors connexion : reportés dans le Drive.
    const dead = tombstones();
    if (dead.length) {
      for (const d of dead) await buryRemote(d.id, d.at, files);
      setTombstones([]);
      files = await listFiles();
    }
    // Projets supprimés sur un autre appareil : retirés ici, sauf s'ils ont été modifiés depuis.
    const graves = new Map(files.filter((f) => f.appProperties?.kind === 'tombstone').map((f) => [f.appProperties!.projectId, f]));
    const remote = files.filter((f) => f.appProperties?.kind === 'project');
    let locals = await listProjects();
    const openId = useProjectStore.getState().doc?.project.id;
    for (const [id, g] of graves) {
      const l = locals.find((x) => x.id === id);
      const at = g.appProperties!.deletedAt ?? '';
      if (!l) continue;
      if (l.updatedAt <= at && id !== openId) await deleteProject(id);
      else if (l.updatedAt > at) {
        // Modifié après la suppression : le projet revit partout.
        await removeFile(g.id);
        graves.delete(id);
      }
    }
    locals = await listProjects();
    const ids = new Set([...locals.map((l) => l.id), ...remote.map((r) => r.appProperties!.projectId)]);
    let reopen = false;
    for (const id of ids) {
      const l = locals.find((x) => x.id === id);
      const r = remote.find((x) => x.appProperties!.projectId === id);
      const rAt = r?.appProperties?.updatedAt ?? '';
      if (!l && graves.has(id)) continue;
      if (r && (!l || rAt > l.updatedAt)) {
        const doc = parseProjectFile(await (await download(r.id)).text());
        await saveProject(doc);
        await pullBlobs(id, files);
        if (id === openId) reopen = true;
      } else if (l && (!r || l.updatedAt > rAt)) {
        const doc = await loadProject(id);
        if (doc) await pushProject(doc, files);
      } else if (r) await pullBlobs(id, files);
    }
    if (reopen && openId) await openStoredProject(openId);
    useCloud.setState({ status: 'idle', lastSync: new Date().toISOString() });
  } catch (e) {
    fail((e as Error).message);
  }
}

/** Projet supprimé dans le navigateur : retiré du Drive (tout de suite, ou à la prochaine connexion). */
export async function cloudForget(projectId: string): Promise<void> {
  if (!useCloud.getState().user) return;
  const at = new Date().toISOString();
  if (!valid()) return setTombstones([...tombstones(), { id: projectId, at }]);
  try {
    await buryRemote(projectId, at, await listFiles());
  } catch {
    setTombstones([...tombstones(), { id: projectId, at }]);
  }
}

/** Suppression annulée : le projet n'est plus à retirer, et revient dans le Drive. */
export async function cloudRestore(projectId: string): Promise<void> {
  setTombstones(tombstones().filter((x) => x.id !== projectId));
  if (!useCloud.getState().user || !valid()) return;
  try {
    const files = await listFiles();
    for (const f of files) if (f.appProperties?.kind === 'tombstone' && f.appProperties.projectId === projectId) await removeFile(f.id);
    const doc = await loadProject(projectId);
    if (doc) await pushProject(doc, files);
  } catch {
    /* repris à la prochaine synchronisation */
  }
}

/** Après chaque enregistrement local, le projet ouvert part dans le Drive (débouncé). */
export function startCloudPush(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = useUi.subscribe((s, prev) => {
    if (s.saveStatus !== 'saved' || prev.saveStatus === 'saved' || !valid()) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const doc = useProjectStore.getState().doc;
      if (!doc || useCloud.getState().status === 'syncing') return;
      try {
        useCloud.setState({ status: 'syncing' });
        await pushProject(doc, await listFiles());
        useCloud.setState({ status: 'idle', lastSync: new Date().toISOString() });
      } catch (e) {
        fail((e as Error).message);
      }
    }, PUSH_DELAY);
  });
  return () => {
    unsub();
    clearTimeout(timer);
  };
}
