/**
 * Synchronisation facultative avec Google Drive : chaque projet (et ses images) est rangé dans le
 * dossier privé de l'application (`appDataFolder`, invisible dans le Drive de l'utilisateur), via
 * Google Identity Services côté navigateur. Rien ne transite par un autre serveur.
 * Le jeton d'accès ne vit qu'en mémoire ; seule l'identité (nom, adresse) est mémorisée.
 * La même connexion sert la relecture en ligne (portée drive.file, demandée en plus au premier besoin).
 */
import { create } from 'zustand';
import { GOOGLE_CLIENT_ID } from '../app/config';
import { parseProjectFile, serializeDoc } from '../domain/serialize';
import type { ProjectDoc } from '../domain/types';
import { db, deleteProject, listProjects, loadProject, saveProject } from './db';
import { DRIVE_API as API, DRIVE_UPLOAD as UPLOAD, GIS_SCRIPT, SCOPE_APPDATA, SCOPE_FILE, SCOPE_IDENTITY, USERINFO } from './googleUrls';
import { flushEditors, flushSave, openStoredProject } from './persistence';
import { useProjectStore } from './projectStore';
import { useUi } from './uiStore';

const SYNC_SCOPE = `${SCOPE_APPDATA} ${SCOPE_IDENTITY}`;
const USER_KEY = 'ds-cloud-user';
const TOMB_KEY = 'ds-cloud-deleted';
/** Jetons d'accès (une heure) gardés le temps de leur validité : un rechargement ne déconnecte plus. */
const TOKEN_KEY = 'ds-cloud-token';
/** Accès aux fichiers de l'application (relecture) déjà accordé ici : redemandé discrètement au renouvellement. */
const FILE_FLAG = 'ds-cloud-file';
const PUSH_DELAY = 4000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; hint?: string; scope?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string; message?: string }) => void; hint?: string }): TokenClient;
      revoke(token: string, done?: () => void): void;
      hasGrantedAllScopes?(r: TokenResponse, ...scopes: string[]): boolean;
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
  /** Jeton valide en mémoire (synchronisation privée). */
  connected: boolean;
  /** Jeton valide pour les fichiers de l'application (relecture en ligne). */
  fileAccess: boolean;
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

/** Jetons tenus : un seul d'ordinaire (Google cumule les portées accordées), deux au plus. */
interface Held {
  token: string;
  expiresAt: number;
  scopes: string[];
}
let held: Held[] = [];
let client: TokenClient | null = null;
let gisPromise: Promise<void> | null = null;

/**
 * Jetons gardés pour un rechargement. Celui d'un relecteur sans compte ici ne vit que le temps de
 * l'onglet (sessionStorage) : fermé, l'onglet ne laisse à personne d'autre de quoi commenter sous
 * son nom.
 */
function keepTokens(): void {
  const lasting = !!useCloud.getState().user || !reviewContext.reviewing();
  const write = (store: Storage, list: Held[]) => (list.length ? store.setItem(TOKEN_KEY, JSON.stringify(list)) : store.removeItem(TOKEN_KEY));
  try {
    write(localStorage, lasting ? held : []);
  } catch {
    /* stockage indisponible */
  }
  try {
    write(sessionStorage, lasting ? [] : held);
  } catch {
    /* stockage indisponible */
  }
}
(() => {
  const read = (store: Storage): Held[] => {
    const raw = JSON.parse(store.getItem(TOKEN_KEY) ?? 'null') as Held[] | { token?: string; expiresAt?: number } | null;
    // Ancien format : un jeton de synchronisation seul.
    return Array.isArray(raw) ? raw : raw?.token ? [{ token: raw.token, expiresAt: raw.expiresAt ?? 0, scopes: [SCOPE_APPDATA] }] : [];
  };
  const ok = (h: Held) => typeof h?.token === 'string' && h.expiresAt > Date.now() && Array.isArray(h.scopes);
  try {
    const user = storedUser();
    // Sans compte ici, un jeton durable n'est repris que pour l'auteur d'une relecture publiée.
    const author = localStorage.getItem(FILE_FLAG) === '1';
    held = read(localStorage).filter((h) => ok(h) && (!!user || (author && !h.scopes.includes(SCOPE_APPDATA))));
  } catch {
    /* rien à reprendre */
  }
  try {
    // Relecteur sans compte : son jeton, le temps de l'onglet (rechargement compris).
    held = [...held, ...read(sessionStorage).filter((h) => ok(h) && !h.scopes.includes(SCOPE_APPDATA) && !held.some((x) => x.token === h.token))];
  } catch {
    /* rien à reprendre */
  }
})();

const gis = () => (window as unknown as { google?: Gis }).google;
const holder = (scope: string, margin = 0) => held.find((h) => h.scopes.includes(scope) && Date.now() + margin < h.expiresAt);
/** Synchronisation privée possible : quelqu'un s'est connecté ici, et son jeton vaut encore. */
const valid = () => !!useCloud.getState().user && !!holder(SCOPE_APPDATA);
const fileFlag = () => {
  try {
    return localStorage.getItem(FILE_FLAG) === '1';
  } catch {
    return false;
  }
};

/** Jeton donnant accès aux fichiers de l'application (relecture), s'il est encore valide. */
export const driveFileToken = (): string | null => holder(SCOPE_FILE)?.token ?? null;

export const useCloud = create<CloudState>(() => ({ enabled: !!GOOGLE_CLIENT_ID, user: storedUser(), connected: !!storedUser() && !!holder(SCOPE_APPDATA), fileAccess: !!holder(SCOPE_FILE), status: 'idle' }));

/**
 * Où en est la relecture en ligne (renseigné par `review.ts`) : un relecteur sans compte ne garde
 * pas l'accès aux fichiers au-delà de sa relecture ; l'auteur d'une relecture publiée, si.
 */
let reviewContext = { reviewing: () => false, published: () => false };
export const setReviewContext = (c: typeof reviewContext) => void (reviewContext = c);

/** Charge le script de Google à l'avance : le clic de connexion doit ouvrir la fenêtre sans attendre. */
export function preloadGoogle(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) return Promise.resolve();
  if (gis()?.accounts) return Promise.resolve();
  gisPromise ??= new Promise<void>((ok, ko) => {
    const sc = document.createElement('script');
    sc.src = GIS_SCRIPT;
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

/** Demande en cours auprès de Google : synchronisation (connexion) ou fichiers de l'application. */
interface Request {
  kind: 'sync' | 'file';
  silent: boolean;
  resolve?: (token: string) => void;
  reject?: (e: Error) => void;
}
let inflight: Request | null = null;
/** Renouvellement en cours sans fenêtre de choix (au premier clic, Google valide d'office l'accord déjà donné). */
let renewing = false;

function ask(g: Gis, req: Request, o: { prompt: string; hint?: string; scope: string }) {
  inflight?.reject?.(new Error('Connexion interrompue.'));
  inflight = req;
  renewing = true;
  tokenClient(g).requestAccessToken(o);
}

const syncScope = () => (fileFlag() ? `${SYNC_SCOPE} ${SCOPE_FILE}` : SYNC_SCOPE);

/** Connexion (à appeler directement depuis un clic : Safari bloque sinon la fenêtre de Google). */
export function signIn(): void {
  const g = gis();
  if (!g?.accounts) {
    void preloadGoogle().then(() => useUi.getState().toast({ message: 'Connexion prête : cliquez de nouveau.' }), (e: Error) => fail(e.message));
    return;
  }
  const user = useCloud.getState().user;
  // Le clic qui mène ici a pu déjà lancer le renouvellement discret : il suffit.
  if (renewing && inflight?.kind === 'sync') {
    inflight.silent = false;
    return;
  }
  ask(g, { kind: 'sync', silent: false }, { prompt: user ? '' : 'consent', hint: user?.email, scope: syncScope() });
}

/**
 * Accès aux fichiers de l'application (portée drive.file, demandée en plus, au premier besoin) :
 * publier une relecture, la commenter. À appeler depuis un clic. Ne déconnecte rien : la
 * synchronisation privée garde sa portée.
 */
export function requestDriveFile(): Promise<string> {
  const ready = holder(SCOPE_FILE, 60_000)?.token;
  if (ready) return Promise.resolve(ready);
  const g = gis();
  if (!g?.accounts) {
    void preloadGoogle().catch(() => undefined);
    return Promise.reject(new Error('Connexion Google en cours de chargement : réessayez.'));
  }
  // Le même clic a déjà lancé le renouvellement discret (portées déjà accordées) : on l'attend.
  const pending = renewing ? inflight : null;
  if (pending && fileFlag()) {
    pending.silent = false;
    return new Promise<string>((resolve, reject) => {
      const [ok, ko] = [pending.resolve, pending.reject];
      pending.resolve = (t) => {
        ok?.(t);
        resolve(t);
      };
      pending.reject = (e) => {
        ko?.(e);
        reject(e);
      };
    });
  }
  const user = useCloud.getState().user;
  return new Promise<string>((resolve, reject) => {
    ask(g, { kind: 'file', silent: false, resolve, reject }, { prompt: '', hint: user?.email, scope: user ? `${SYNC_SCOPE} ${SCOPE_FILE}` : SCOPE_FILE });
  });
}

function tokenClient(g: Gis): TokenClient {
  client ??= g.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SYNC_SCOPE,
    callback: (r) => {
      renewing = false;
      const req = inflight;
      inflight = null;
      void onToken(r, req);
    },
    error_callback: (e) => {
      renewing = false;
      const req = inflight;
      inflight = null;
      const message = e.type === 'popup_closed' ? 'Connexion annulée.' : 'Connexion impossible.';
      req?.reject?.(new Error(message));
      // Un renouvellement discret qui échoue ne dérange pas : « Se reconnecter » reste possible.
      if (req?.kind === 'sync' && !req.silent) fail(message);
    },
  });
  return client;
}

/**
 * Session tenue le plus longtemps possible : le jeton de Google dure une heure ; à moins de cinq
 * minutes de la fin (ou après), le premier clic ou la première touche le renouvelle sans rien demander,
 * avec les portées déjà accordées (synchronisation, relecture). Safari n'ouvre la fenêtre de Google
 * qu'en réponse à un geste.
 */
export function keepSessionAlive(): () => void {
  const onGesture = () => {
    if (renewing) return;
    const user = useCloud.getState().user;
    const margin = 5 * 60_000;
    const needSync = !!user && !holder(SCOPE_APPDATA, margin);
    // Sans compte de synchronisation : seulement pour l'auteur d'une relecture publiée (un relecteur
    // est redemandé au geste « Envoyer », jamais hors de sa relecture).
    const needFile = fileFlag() && !holder(SCOPE_FILE, margin) && (!!user || reviewContext.published());
    if (!needSync && !needFile) return;
    const g = gis();
    if (!g?.accounts) {
      void preloadGoogle().catch(() => undefined);
      return;
    }
    if (user) ask(g, { kind: 'sync', silent: true }, { prompt: '', hint: user.email, scope: syncScope() });
    else ask(g, { kind: 'file', silent: true }, { prompt: '', scope: SCOPE_FILE });
  };
  window.addEventListener('click', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  return () => {
    window.removeEventListener('click', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  };
}

/** Portées réellement accordées (la fenêtre de Google laisse décocher une case). */
function grantedScopes(r: TokenResponse, asked: string): string[] {
  const listed = (r.scope ?? asked).split(/\s+/).filter(Boolean);
  const check = gis()?.accounts?.oauth2.hasGrantedAllScopes;
  if (!check) return listed;
  return [...new Set([...listed, SCOPE_APPDATA, SCOPE_FILE])].filter((sc) => (sc === SCOPE_APPDATA || sc === SCOPE_FILE ? check(r, sc) : true));
}

async function onToken(r: TokenResponse, req: Request | null) {
  const kind = req?.kind ?? 'sync';
  if (r.error || !r.access_token) {
    const message = r.error_description || 'Connexion refusée.';
    req?.reject?.(new Error(message));
    if (kind === 'sync') {
      if (req?.silent) useCloud.setState({ connected: valid() });
      else fail(message);
    }
    return;
  }
  const user = useCloud.getState().user;
  let scopes = grantedScopes(r, kind === 'file' ? SCOPE_FILE : syncScope());
  // Google cumule les accords déjà donnés par ce compte (ailleurs, pour la synchronisation) : sans
  // connexion ici, l'accès aux fichiers ne vaut pas connexion, rien de privé ne se synchronise.
  if (kind === 'file' && !user) scopes = scopes.filter((sc) => sc !== SCOPE_APPDATA);
  const entry: Held = { token: r.access_token, expiresAt: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 60) * 1000, scopes };
  // Un jeton plus ancien n'est gardé que s'il porte une portée que le nouveau n'a pas.
  held = [entry, ...held.filter((h) => Date.now() < h.expiresAt && h.scopes.some((sc) => !scopes.includes(sc)))];
  keepTokens();
  const file = scopes.includes(SCOPE_FILE);
  if (file && (user || !reviewContext.reviewing())) {
    try {
      localStorage.setItem(FILE_FLAG, '1');
    } catch {
      /* stockage indisponible */
    }
  }
  useCloud.setState({ fileAccess: !!holder(SCOPE_FILE), connected: valid() });
  if (file) req?.resolve?.(entry.token);
  else req?.reject?.(new Error('Accès à Google Drive non accordé.'));
  if (kind === 'file') return;
  if (!scopes.includes(SCOPE_APPDATA)) return fail('Accès à Google Drive non accordé.');
  try {
    const me = (await (await fetch(USERINFO, { headers: { authorization: `Bearer ${entry.token}` } })).json()) as { email?: string; name?: string; picture?: string };
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
  for (const h of held) gis()?.accounts?.oauth2.revoke(h.token);
  held = [];
  keepTokens();
  try {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(FILE_FLAG);
  } catch {
    /* stockage indisponible */
  }
  useCloud.setState({ user: null, connected: false, fileAccess: false, status: 'idle', error: undefined, lastSync: undefined });
}

/** Relecture quittée par un relecteur sans compte ici : son accès aux fichiers est oublié. */
export function forgetReviewerAccess(): void {
  if (useCloud.getState().user) return;
  held = held.filter((h) => h.scopes.includes(SCOPE_APPDATA));
  keepTokens();
  try {
    localStorage.removeItem(FILE_FLAG);
  } catch {
    /* stockage indisponible */
  }
  useCloud.setState({ fileAccess: !!holder(SCOPE_FILE) });
}

/** Jeton refusé par Google (expiré, retiré) : oublié. */
export function dropToken(token: string): void {
  held = held.filter((h) => h.token !== token);
  keepTokens();
  useCloud.setState({ connected: valid(), fileAccess: !!holder(SCOPE_FILE) });
}

// --- Drive ---------------------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  const token = holder(SCOPE_APPDATA)?.token;
  if (!token) {
    useCloud.setState({ connected: false });
    throw new Error('Session Google expirée : reconnectez-vous.');
  }
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    dropToken(token);
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
