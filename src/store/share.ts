import { create } from 'zustand';
import type { DataConnection, Peer } from 'peerjs';
import { diff, type Op } from '../domain/patch';
import { droppedRemoteIds } from '../domain/reviewMerge';
import { withoutReview } from '../domain/serialize';
import type { ProjectDoc } from '../domain/types';
import { navigate } from '../app/router';
import { deleteProject, getBlob, putBlobRaw, saveProject, setRemoteBlobSource } from './db';
import { rememberLastProject, setPersistGuard } from './persistence';
import { applyRemote, isApplyingRemote, setMutationGuard, useProjectStore } from './projectStore';
import { useUi } from './uiStore';

/**
 * Travail à plusieurs, d'ordinateur à ordinateur : le navigateur de l'hôte fait office de serveur.
 * L'hôte ouvre un partage (lien + mot de passe, lecture seule ou modification, copie autorisée ou
 * non) ; les invités s'y connectent directement (WebRTC, mise en relation par PeerJS). Seules les
 * modifications circulent, champ par champ ; l'hôte les relaie aux autres invités.
 */

/** Lecture seule, relecture (commentaires seulement) ou modification. */
export type ShareMode = 'read' | 'review' | 'edit';

export interface Guest {
  id: string;
  name: string;
}

interface ShareState {
  role: 'none' | 'host' | 'guest';
  status: 'idle' | 'opening' | 'open' | 'reconnecting' | 'joining' | 'joined' | 'closed' | 'error';
  error?: string;
  room?: string;
  password?: string;
  mode: ShareMode;
  keep: boolean;
  guests: Guest[];
  hostName?: string;
  /** Invité d'un partage en direct, ou relecteur d'une version publiée dans Google Drive (`review.ts`). */
  via?: 'peer' | 'drive';
}

export const useShare = create<ShareState>(() => ({ role: 'none', status: 'idle', mode: 'edit', keep: false, guests: [] }));

type Msg =
  | { t: 'hello'; password: string; name: string }
  | { t: 'welcome'; doc: ProjectDoc; mode: ShareMode; keep: boolean; hostName: string; guests: Guest[] }
  | { t: 'denied'; reason: string }
  | { t: 'bye' }
  | { t: 'ops'; ops: Op[] }
  | { t: 'settings'; mode: ShareMode; keep: boolean }
  | { t: 'guests'; guests: Guest[] }
  | { t: 'blob?'; key: string }
  | { t: 'blob'; key: string; type: string; data: ArrayBuffer | null };

let peer: Peer | null = null;
const conns = new Map<string, { conn: DataConnection; name: string; ok: boolean }>();
let hostConn: DataConnection | null = null;
let unsubscribe: (() => void) | null = null;
const blobWaiters = new Map<string, Array<(b: Blob | undefined) => void>>();
const blobCache = new Map<string, Blob>();

/** Serveur de mise en relation : celui de PeerJS, ou un autre déclaré (tests, hébergement propre). */
function peerOptions(): Record<string, unknown> {
  try {
    const custom = localStorage.getItem('ds-peer-server');
    if (custom) {
      const [host, port] = custom.split(':');
      return { host, port: Number(port) || 9000, path: '/', secure: false };
    }
  } catch {
    /* stockage indisponible : serveur par défaut */
  }
  return {};
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const randomCode = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => ALPHABET[x % ALPHABET.length]).join('');

export const shareLink = (room: string) => `${window.location.origin}${window.location.pathname}#/join?room=${room}`;

async function newPeer(id?: string): Promise<Peer> {
  const { Peer } = await import('peerjs');
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    const timer = setTimeout(() => reject(new Error('Le service de mise en relation ne répond pas.')), 15000);
    p.on('open', () => {
      clearTimeout(timer);
      resolve(p);
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Erreurs passagères (réseau faible, identifiant encore tenu par le serveur après un rechargement). */
const TRANSIENT = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'unavailable-id', 'peer-unavailable', 'webrtc']);
const transient = (e: unknown) => TRANSIENT.has((e as { type?: string })?.type ?? '') || /ne répond pas/.test((e as Error)?.message ?? '');

/** Ouvre un pair, en réessayant tant que l'erreur est passagère (jusqu'à `patience` ms). */
async function openPeer(id: string | undefined, patience = 60000): Promise<Peer> {
  const until = Date.now() + patience;
  for (;;) {
    try {
      return await newPeer(id);
    } catch (e) {
      if (!transient(e) || Date.now() > until) throw e;
      await wait(3000);
    }
  }
}

/**
 * Lien et mot de passe d'un projet : tirés une fois, puis gardés dans ce navigateur (jamais dans le
 * projet, que reçoivent les invités). Le lien ne change plus d'un partage à l'autre.
 */
function projectCredentials(projectId: string, renew = false): { room: string; password: string } {
  const key = `ds-share:${projectId}`;
  let v: { room?: string; password?: string } | null = null;
  try {
    v = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    v = null;
  }
  const out = { room: v?.room || `decoupage-${randomCode(12)}`, password: !renew && v?.password ? v.password : randomCode(6) };
  try {
    localStorage.setItem(key, JSON.stringify(out));
  } catch {
    /* stockage indisponible : lien valable le temps de ce partage */
  }
  return out;
}

/** Nouveau mot de passe, même lien ; les invités déjà connectés restent. */
export function renewSharePassword() {
  const doc = useProjectStore.getState().doc;
  if (useShare.getState().role !== 'host' || !doc) return;
  useShare.setState({ password: projectCredentials(doc.project.id, true).password });
}

function send(conn: DataConnection | null | undefined, msg: Msg) {
  if (conn?.open) void conn.send(msg);
}

/** Diffuse les modifications locales (hors modifications reçues) aux autres participants. */
function watchLocalChanges() {
  unsubscribe?.();
  unsubscribe = useProjectStore.subscribe((s, prev) => {
    if (useShare.getState().role === 'host' && s.doc?.project.id !== prev.doc?.project.id) {
      // L'hôte ouvre un autre projet : le partage du précédent se ferme.
      stopHosting();
      return;
    }
    if (useShare.getState().role === 'guest' && useShare.getState().status === 'joined' && prev.doc && s.doc?.project.id !== prev.doc.project.id) {
      // L'invité ouvre un de ses projets : il quitte le partage, rien de son projet ne part chez l'hôte.
      leaveSession(false);
      return;
    }
    if (isApplyingRemote() || !s.doc || !prev.doc || s.doc === prev.doc || s.doc.project.id !== prev.doc.project.id) return;
    const ops = diff(prev.doc, s.doc);
    if (!ops.length) return;
    const st = useShare.getState();
    if (st.role === 'host') for (const c of conns.values()) if (c.ok) send(c.conn, { t: 'ops', ops });
    if (st.role === 'guest') send(hostConn, { t: 'ops', ops });
  });
}

function guestList(): Guest[] {
  return [...conns.entries()].filter(([, c]) => c.ok).map(([id, c]) => ({ id, name: c.name }));
}

function broadcastGuests() {
  const guests = guestList();
  useShare.setState({ guests });
  for (const c of conns.values()) if (c.ok) send(c.conn, { t: 'guests', guests });
}

async function answerBlob(conn: DataConnection, key: string) {
  const b = (await getBlob(key, false)) ?? blobCache.get(key);
  send(conn, { t: 'blob', key, type: b?.type ?? '', data: b ? await b.arrayBuffer() : null });
}

function receiveBlob(m: Extract<Msg, { t: 'blob' }>) {
  const waiters = blobWaiters.get(m.key);
  if (!waiters) return;
  if (!m.data) return; // un autre participant l'a peut-être
  const blob = new Blob([m.data], { type: m.type });
  blobCache.set(m.key, blob);
  const st = useShare.getState();
  const doc = useProjectStore.getState().doc;
  if ((st.role === 'host' || st.keep) && doc) void putBlobRaw(m.key, doc.project.id, blob);
  blobWaiters.delete(m.key);
  waiters.forEach((w) => w(blob));
}

/** Image absente de ce navigateur : on la demande aux autres participants. */
function requestBlob(key: string): Promise<Blob | undefined> {
  if (blobCache.has(key)) return Promise.resolve(blobCache.get(key));
  const st = useShare.getState();
  const targets = st.role === 'guest' ? [hostConn] : [...conns.values()].filter((c) => c.ok).map((c) => c.conn);
  if (!targets.some((c) => c?.open)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const list = blobWaiters.get(key) ?? [];
    list.push(resolve);
    blobWaiters.set(key, list);
    if (list.length === 1) targets.forEach((c) => send(c, { t: 'blob?', key }));
    setTimeout(() => {
      if (blobWaiters.get(key)?.includes(resolve)) {
        blobWaiters.set(key, (blobWaiters.get(key) ?? []).filter((w) => w !== resolve));
        resolve(undefined);
      }
    }, 15000);
  });
}

function installGuards() {
  setMutationGuard(() => {
    const st = useShare.getState();
    if (st.role !== 'guest' || st.mode === 'edit') return true;
    return st.mode === 'review' && commentWriting;
  });
  setPersistGuard(() => !(useShare.getState().role === 'guest' && !useShare.getState().keep));
  setRemoteBlobSource(requestBlob);
  watchLocalChanges();
}

function resetGuards() {
  setMutationGuard(null);
  setPersistGuard(null);
  setRemoteBlobSource(null);
  unsubscribe?.();
  unsubscribe = null;
}

// --- Hôte ---------------------------------------------------------------------------------------

export async function startHosting(opts: { mode: ShareMode; keep: boolean }): Promise<void> {
  if (useShare.getState().role !== 'none') return;
  const doc = useProjectStore.getState().doc;
  if (!doc) return;
  useShare.setState({ role: 'host', status: 'opening', error: undefined, mode: opts.mode, keep: opts.keep, guests: [] });
  try {
    const { room, password } = projectCredentials(doc.project.id);
    const p = await openPeer(room);
    if (useShare.getState().role !== 'host') return void p.destroy();
    peer = p;
    attachHost(p);
    useShare.setState({ status: 'open', room, password });
    installGuards();
    window.addEventListener('online', recoverHost);
  } catch (e) {
    stopHosting();
    useShare.setState({ status: 'error', error: (e as Error).message || 'Le service de mise en relation ne répond pas.' });
  }
}

function attachHost(p: Peer) {
  p.on('connection', onGuestConnection);
  p.on('open', () => {
    if (useShare.getState().status === 'reconnecting') useShare.setState({ status: 'open' });
  });
  // Réseau faible : le lien reste valable, l'hôte se reconnecte seul (les invités déjà là restent reliés).
  p.on('disconnected', recoverHost);
  p.on('error', (e) => {
    if (transient(e)) recoverHost();
  });
}

let hostRetry: number | undefined;
function recoverHost() {
  if (useShare.getState().role !== 'host' || hostRetry !== undefined) return;
  if (useShare.getState().status === 'open' && peer?.open) return;
  useShare.setState({ status: 'reconnecting' });
  const tick = async () => {
    hostRetry = undefined;
    const st = useShare.getState();
    if (st.role !== 'host' || !st.room) return;
    if (peer?.open) return void useShare.setState({ status: 'open' });
    try {
      if (peer && !peer.destroyed && peer.disconnected) peer.reconnect();
      else {
        peer?.destroy();
        const p = await openPeer(st.room, 0);
        if (useShare.getState().role !== 'host') return void p.destroy();
        peer = p;
        attachHost(p);
        useShare.setState({ status: 'open' });
        return;
      }
    } catch {
      /* nouvel essai plus bas */
    }
    hostRetry = window.setTimeout(() => void tick(), 3000);
  };
  hostRetry = window.setTimeout(() => void tick(), 1000);
}

function onGuestConnection(conn: DataConnection) {
  conns.set(conn.peer, { conn, name: '…', ok: false });
  conn.on('data', (raw) => {
    const m = raw as Msg;
    const entry = conns.get(conn.peer);
    if (!entry) return;
    if (m.t === 'hello') {
      const st = useShare.getState();
      if (m.password.trim().toLowerCase() !== st.password) {
        send(conn, { t: 'denied', reason: 'Mot de passe incorrect.' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      entry.ok = true;
      entry.name = m.name.trim().slice(0, 40) || 'Invité';
      const doc = useProjectStore.getState().doc;
      if (!doc) return;
      send(conn, { t: 'welcome', doc, mode: st.mode, keep: st.keep, hostName: doc.project.director || 'l’hôte', guests: guestList() });
      broadcastGuests();
      return;
    }
    if (!entry.ok) return;
    const mode = useShare.getState().mode;
    // Relecture : seuls les commentaires viennent des invités.
    const ops = m.t === 'ops' ? (mode === 'edit' ? m.ops : mode === 'review' ? m.ops.filter((o) => o.p[0] === 'comments') : []) : [];
    if (m.t === 'ops' && ops.length) {
      const before = useProjectStore.getState().doc;
      applyRemote(ops);
      // Commentaire de la relecture en ligne retiré par un invité : écarté ici, comme si l'hôte l'avait retiré.
      const after = useProjectStore.getState().doc;
      const gone = after?.review ? droppedRemoteIds(before, after) : [];
      if (gone.length) applyRemote([{ p: ['review', 'dismissed'], v: [...(after!.review!.dismissed ?? []), ...gone] }]);
      // Relais aux autres invités.
      for (const [id, c] of conns) if (id !== conn.peer && c.ok) send(c.conn, { t: 'ops', ops });
    } else if (m.t === 'blob?') void answerBlob(conn, m.key);
    else if (m.t === 'blob') receiveBlob(m);
  });
  conn.on('close', () => {
    // Une connexion remplacée (invité revenu après une coupure) ne retire pas le nouveau venu.
    if (conns.get(conn.peer)?.conn === conn) conns.delete(conn.peer);
    broadcastGuests();
  });
}

/** Change les droits en cours de partage (lecture seule / modification, copie autorisée). */
export function updateShareSettings(patch: Partial<Pick<ShareState, 'mode' | 'keep'>>) {
  useShare.setState(patch);
  const { mode, keep } = useShare.getState();
  for (const c of conns.values()) if (c.ok) send(c.conn, { t: 'settings', mode, keep });
}

export function kickGuest(id: string) {
  const c = conns.get(id)?.conn;
  send(c, { t: 'bye' });
  setTimeout(() => c?.close(), 200);
  conns.delete(id);
  broadcastGuests();
}

/** Ferme le partage : tous les invités sont déconnectés. */
export function stopHosting() {
  window.clearTimeout(hostRetry);
  hostRetry = undefined;
  window.removeEventListener('online', recoverHost);
  // Fermeture voulue : les invités ne cherchent pas à se reconnecter.
  for (const c of conns.values()) {
    send(c.conn, { t: 'bye' });
    c.conn.close();
  }
  conns.clear();
  peer?.destroy();
  peer = null;
  resetGuards();
  useShare.setState({ role: 'none', status: 'idle', room: undefined, password: undefined, guests: [], error: undefined });
}

// --- Invité -------------------------------------------------------------------------------------

let joinCreds: { room: string; password: string; name: string } | null = null;
let byeReceived = false;

export async function joinSession(room: string, password: string, name: string): Promise<boolean> {
  leaveSession();
  joinCreds = { room, password, name };
  useShare.setState({ role: 'guest', status: 'joining', error: undefined, room, via: 'peer' });
  const r = await connectToHost(45000);
  if (r === true) return true;
  hostConn?.close();
  hostConn = null;
  peer?.destroy();
  peer = null;
  joinCreds = null;
  resetGuards();
  // Connexion manquée : on n'est plus invité (boutons d'enregistrement, export… rétablis).
  useShare.setState({ role: 'none', status: 'error', error: r, room: undefined });
  return false;
}

/**
 * Relie l'invité à l'hôte, en réessayant pendant `patience` ms : un wifi faible, un hôte qui
 * recharge sa page ne font plus échouer la connexion au premier essai. Rend `true` ou le message d'erreur.
 */
async function connectToHost(patience: number): Promise<true | string> {
  const creds = joinCreds;
  if (!creds) return 'Lien de partage incomplet.';
  const until = Date.now() + patience;
  let last = 'L’hôte ne répond pas : son partage est peut-être fermé.';
  byeReceived = false;
  while (Date.now() < until && joinCreds === creds) {
    try {
      if (!peer || peer.destroyed) peer = await openPeer(undefined, Math.max(0, until - Date.now()));
      else if (peer.disconnected) peer.reconnect();
      const r = await attemptJoin(peer, creds, Math.min(15000, Math.max(3000, until - Date.now())));
      if (r === true) return true;
      if (r.final) return r.message;
      last = r.message;
    } catch (e) {
      if (!transient(e)) return (e as Error).message;
    }
    if (joinCreds !== creds) break;
    await wait(2500);
  }
  return last;
}

/** Un essai de connexion : `true`, ou un échec (définitif : mot de passe refusé). */
function attemptJoin(p: Peer, creds: { room: string; password: string; name: string }, timeout: number): Promise<true | { message: string; final: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const conn = p.connect(creds.room, { reliable: true });
    const done = (r: true | { message: string; final: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      p.off('error', onError);
      if (r !== true) conn.close();
      resolve(r);
    };
    const onError = (e: { type?: string; message?: string }) =>
      done({ message: e.type === 'peer-unavailable' ? 'Ce partage n’existe plus ou l’hôte est hors ligne.' : e.message || 'Connexion impossible.', final: !transient(e) });
    const timer = setTimeout(() => done({ message: 'L’hôte ne répond pas : son partage est peut-être fermé.', final: false }), timeout);
    p.on('error', onError);
    conn.on('open', () => send(conn, { t: 'hello', password: creds.password, name: creds.name }));
    conn.on('data', (raw) => {
      const m = raw as Msg;
      if (m.t === 'welcome') {
        hostConn?.close();
        hostConn = conn;
        useShare.setState({ mode: m.mode, keep: m.keep, hostName: m.hostName, guests: m.guests });
        installGuards();
        // La relecture en ligne reste à l'hôte : ni son lien ni son état ne passent chez l'invité (ni dans sa copie).
        // Projet partagé chargé avant d'être « rejoint » : il remplace le projet ouvert ici sans
        // être pris pour l'ouverture d'un autre projet (qui ferait quitter le partage).
        useProjectStore.getState().loadDoc(withoutReview(m.doc));
        useShare.setState({ status: 'joined' });
        // Rien de ce projet n'est enregistré ici (sauf copie accordée) : pas d'état hérité du précédent.
        useUi.getState().set({ saveStatus: 'idle', selection: null, editing: null });
        done(true);
        return;
      }
      if (hostConn !== conn) {
        if (m.t === 'denied') done({ message: m.reason, final: true });
        return;
      }
      if (m.t === 'bye') byeReceived = true;
      else if (m.t === 'ops') applyRemote(m.ops.filter((o) => o.p[0] !== 'review'));
      else if (m.t === 'settings') {
        const wasKept = useShare.getState().keep;
        useShare.setState({ mode: m.mode, keep: m.keep });
        const doc = useProjectStore.getState().doc;
        // Copie retirée par l'hôte : celle déjà enregistrée ici disparaît ; copie accordée : enregistrée tout de suite.
        if (wasKept && !m.keep && doc) void deleteProject(doc.project.id);
        if (!wasKept && m.keep && doc) void saveProject(doc);
      } else if (m.t === 'guests') useShare.setState({ guests: m.guests });
      else if (m.t === 'blob?') void answerBlob(conn, m.key);
      else if (m.t === 'blob') receiveBlob(m);
    });
    conn.on('close', () => {
      if (!settled) return done({ message: 'L’hôte ne répond pas : son partage est peut-être fermé.', final: false });
      if (hostConn !== conn || useShare.getState().status !== 'joined') return;
      // Fermeture voulue par l'hôte : retour à l'accueil. Coupure réseau : l'invité garde le projet
      // à l'écran et se reconnecte seul.
      if (byeReceived) void expelled();
      else void rejoin();
    });
  });
}

async function rejoin() {
  useShare.setState({ status: 'reconnecting' });
  hostConn = null;
  const r = await connectToHost(120000);
  if (r !== true && useShare.getState().role === 'guest' && useShare.getState().status === 'reconnecting') void expelled();
}

/**
 * L'hôte a fermé le partage (ou retiré l'invité) : retour à l'accueil. Copie autorisée : le projet,
 * dans son dernier état, est enregistré dans ce navigateur et figure à l'accueil.
 */
async function expelled() {
  const { keep } = useShare.getState();
  const doc = useProjectStore.getState().doc;
  useShare.setState({ status: 'closed' });
  let saved = false;
  if (keep && doc) {
    try {
      await saveProject(doc);
      rememberLastProject(doc.project.id);
      saved = true;
    } catch {
      /* stockage indisponible : pas de copie */
    }
  }
  leaveSession();
  useProjectStore.getState().loadDoc(null);
  navigate('home');
  useUi.getState().toast({ message: saved ? 'Partage fermé par l’hôte. Votre copie est à l’accueil.' : 'Partage fermé par l’hôte.' });
}

/**
 * Quitte le partage ; sans copie autorisée, le projet reçu est retiré de ce navigateur (et de
 * l'affichage, sauf si l'invité vient d'ouvrir un de ses propres projets).
 */
export function leaveSession(unload = true) {
  const st = useShare.getState();
  if (st.role !== 'guest') return;
  joinCreds = null;
  hostConn?.close();
  hostConn = null;
  peer?.destroy();
  peer = null;
  resetGuards();
  const shared = st.room ? useProjectStore.getState().doc : null;
  if (!st.keep) {
    if (unload) useProjectStore.getState().loadDoc(null);
    if (shared && unload) void deleteProject(shared.project.id);
  }
  useShare.setState({ role: 'none', status: 'idle', room: undefined, guests: [], hostName: undefined, error: undefined, via: undefined });
}

/**
 * Relecture d'une version publiée dans Google Drive : la même posture qu'un invité « Commenter »
 * d'un partage en direct (seuls les commentaires s'écrivent, rien ne s'enregistre ici), sans
 * connexion directe. Les images viennent de la source donnée.
 */
export function enterDriveReview(hostName: string, blobs: (key: string) => Promise<Blob | undefined>): void {
  if (useShare.getState().role === 'host') stopHosting();
  if (useShare.getState().role === 'guest') leaveSession(false);
  useShare.setState({ role: 'guest', status: 'joined', mode: 'review', keep: false, hostName, guests: [], room: undefined, error: undefined, via: 'drive' });
  setMutationGuard(() => commentWriting);
  setPersistGuard(() => false);
  setRemoteBlobSource(blobs);
}

/** Invité en lecture seule : l'interface ne montre que ce qui sert à regarder. */
export const useReadOnly = () => useShare((s) => s.role === 'guest' && s.mode !== 'edit');
/** Peut commenter : l'auteur, et les invités en relecture ou en modification. */
export const useCanComment = () => useShare((s) => s.role !== 'guest' || s.mode !== 'read');
/** Relecteur d'une version publiée dans Google Drive. */
export const useDriveReview = () => useShare((s) => s.role === 'guest' && s.via === 'drive');
/** Invité en relecture : l'écran se présente en aperçu, prêt à commenter. */
export const useReviewing = () => useShare((s) => s.role === 'guest' && s.mode === 'review');

let commentWriting = false;
/** Écrit un commentaire : seule modification permise à un invité en relecture. */
export function asComment(fn: () => void): void {
  commentWriting = true;
  try {
    fn();
  } finally {
    commentWriting = false;
  }
}
/** L'invité peut-il emporter le projet (exports, enregistrement) ? */
export const useCanCopy = () => useShare((s) => s.role !== 'guest' || s.keep);
