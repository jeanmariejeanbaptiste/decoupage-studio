import { create } from 'zustand';
import type { DataConnection, Peer } from 'peerjs';
import { diff, type Op, type Path } from '../domain/patch';
import { droppedRemoteIds } from '../domain/reviewMerge';
import { newId } from '../domain/factory';
import { projectCopy, withoutReview } from '../domain/serialize';
import { guestCommentOps, mergeComments, uniqueName } from '../domain/comments';
import type { ID, ProjectDoc } from '../domain/types';
import { navigate } from '../app/router';
import { useCloud } from './cloud';
import { db, deleteProject, getBlob, putBlobRaw, saveProject, setRemoteBlobSource } from './db';
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
  status: 'idle' | 'opening' | 'open' | 'joining' | 'joined' | 'closed' | 'error';
  error?: string;
  room?: string;
  password?: string;
  mode: ShareMode;
  keep: boolean;
  guests: Guest[];
  hostName?: string;
  /** Nom sous lequel l'hôte a accueilli cet invité (suffixé s'il était déjà pris). */
  selfName?: string;
  /** Invité d'un partage en direct, ou relecteur d'une version publiée dans Google Drive (`review.ts`). */
  via?: 'peer' | 'drive';
}

export const useShare = create<ShareState>(() => ({ role: 'none', status: 'idle', mode: 'edit', keep: false, guests: [] }));

type Msg =
  | { t: 'hello'; password: string; name: string }
  | { t: 'welcome'; doc: ProjectDoc; mode: ShareMode; keep: boolean; hostName: string; guests: Guest[]; name?: string }
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
/**
 * Invité : ce navigateur avait déjà un projet du même identifiant (fichier ouvert, copie d'un partage
 * précédent). Il n'est ni écrasé ni supprimé ; la copie accordée s'enregistre à part, sous un autre nom.
 */
let localTwin = false;
/** Commentaires retirés par l'hôte pendant ce partage : une liste reçue d'un invité ne les ramène pas. */
const removedComments = new Set<ID>();

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

/** Nom de l'hôte montré aux invités : son compte Google, sinon le réalisateur, sinon rien. */
function hostDisplayName(doc: ProjectDoc): string {
  return useCloud.getState().user?.name?.trim() || doc.project.director?.trim() || '';
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
    const st = useShare.getState();
    // Invité : ses ajouts et retraits de plans ou de séquences partent comme tels, l'hôte les fusionne.
    const ops = diff(prev.doc, s.doc, [], [], { idLists: st.role === 'guest' });
    if (!ops.length) return;
    if (st.role === 'host' && prev.doc.comments !== s.doc.comments) {
      const kept = new Set((s.doc.comments ?? []).map((c) => c.id));
      for (const c of prev.doc.comments ?? []) if (!kept.has(c.id)) removedComments.add(c.id);
    }
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
  setPersistGuard(() => !(useShare.getState().role === 'guest' && (!useShare.getState().keep || localTwin)));
  setRemoteBlobSource(requestBlob);
  watchLocalChanges();
}

/** Images reçues et demandes en attente : rien ne survit au partage (ni ne sert au suivant). */
function forgetBlobs() {
  for (const waiters of blobWaiters.values()) waiters.forEach((w) => w(undefined));
  blobWaiters.clear();
  blobCache.clear();
}

function resetGuards() {
  forgetBlobs();
  setMutationGuard(null);
  setPersistGuard(null);
  setRemoteBlobSource(null);
  unsubscribe?.();
  unsubscribe = null;
}

// --- Hôte ---------------------------------------------------------------------------------------

export async function startHosting(opts: { mode: ShareMode; keep: boolean }): Promise<void> {
  if (useShare.getState().role !== 'none') return;
  useShare.setState({ role: 'host', status: 'opening', error: undefined, mode: opts.mode, keep: opts.keep, guests: [] });
  try {
    const room = `decoupage-${randomCode(12)}`;
    const password = randomCode(6);
    peer = await newPeer(room);
    useShare.setState({ status: 'open', room, password });
    installGuards();
    window.addEventListener('beforeunload', guardUnload);
    peer.on('connection', (conn) => {
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
          const doc = useProjectStore.getState().doc;
          if (!doc) return;
          const hostName = hostDisplayName(doc);
          entry.ok = true;
          entry.name = uniqueName(m.name.trim().slice(0, 40) || 'Invité', [hostName, ...guestList().filter((g) => g.id !== conn.peer).map((g) => g.name)]);
          send(conn, { t: 'welcome', doc, mode: st.mode, keep: st.keep, hostName, guests: guestList(), name: entry.name });
          broadcastGuests();
          return;
        }
        if (!entry.ok) return;
        if (m.t === 'ops') receiveGuestOps(conn.peer, m.ops);
        else if (m.t === 'blob?') void answerBlob(conn, m.key);
        else if (m.t === 'blob') receiveBlob(m);
      });
      conn.on('close', () => {
        conns.delete(conn.peer);
        broadcastGuests();
      });
    });
    peer.on('disconnected', () => peer?.reconnect());
  } catch (e) {
    stopHosting();
    useShare.setState({ status: 'error', error: (e as Error).message });
  }
}

/** Valeur au bout d'un chemin (undefined si absent). */
function valueAt(doc: unknown, path: Path): unknown {
  let node = doc;
  for (const k of path) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, k)) return undefined;
    node = (node as Record<string | number, unknown>)[k];
  }
  return node;
}

/**
 * Modifications d'un invité, chez l'hôte. Relecture : seuls des commentaires. Les listes que deux
 * participants ont pu changer en même temps (commentaires, plans d'une séquence, séquences) sont
 * fusionnées ici, puis renvoyées entières à tous, l'émetteur compris : l'état de l'hôte fait foi.
 */
function receiveGuestOps(from: string, raw: unknown) {
  const mode = useShare.getState().mode;
  const before = useProjectStore.getState().doc;
  if (!before || !Array.isArray(raw)) return;
  const valid = (raw as Op[]).filter((o) => o && typeof o === 'object' && Array.isArray(o.p));
  const allowed = mode === 'edit' ? valid : mode === 'review' ? guestCommentOps(valid, before.comments ?? []) : [];
  const echoed = new Map<string, Path>();
  const ops = allowed.map((o): Op => {
    if ('ins' in o || 'rm' in o) echoed.set(JSON.stringify(o.p), o.p);
    if (o.p.length === 1 && o.p[0] === 'comments' && 'v' in o && Array.isArray(o.v)) {
      echoed.set(JSON.stringify(o.p), o.p);
      return { p: o.p, v: mergeComments(before.comments ?? [], o.v, removedComments) };
    }
    return o;
  });
  if (!ops.length) return;
  applyRemote(ops);
  // Commentaire de la relecture en ligne retiré par un invité : écarté ici, comme si l'hôte l'avait retiré.
  const after = useProjectStore.getState().doc;
  const gone = after?.review ? droppedRemoteIds(before, after) : [];
  if (gone.length) applyRemote([{ p: ['review', 'dismissed'], v: [...(after!.review!.dismissed ?? []), ...gone] }]);
  const doc = useProjectStore.getState().doc;
  const echo: Op[] = [...echoed.values()].map((p) => ({ p, v: valueAt(doc, p) })).filter((o) => o.v !== undefined);
  const relay = [...ops.filter((o) => !echoed.has(JSON.stringify(o.p))), ...echo];
  for (const [id, c] of conns) {
    const out = id === from ? echo : relay;
    if (c.ok && out.length) send(c.conn, { t: 'ops', ops: out });
  }
}

/** Change les droits en cours de partage (lecture seule / modification, copie autorisée). */
export function updateShareSettings(patch: Partial<Pick<ShareState, 'mode' | 'keep'>>) {
  useShare.setState(patch);
  const { mode, keep } = useShare.getState();
  for (const c of conns.values()) if (c.ok) send(c.conn, { t: 'settings', mode, keep });
}

/** Retire un invité ; le mot de passe change, pour qu'il ne revienne pas avec l'ancien (les autres restent connectés). */
export function kickGuest(id: string) {
  const c = conns.get(id);
  if (c) {
    send(c.conn, { t: 'bye' });
    setTimeout(() => c.conn.close(), 300);
  }
  conns.delete(id);
  useShare.setState({ password: randomCode(6) });
  broadcastGuests();
}

/** Quitter ou recharger la page de l'hôte coupe ses invités : le navigateur demande confirmation. */
function guardUnload(e: BeforeUnloadEvent) {
  const st = useShare.getState();
  if (st.role !== 'host' || !st.guests.length) return;
  e.preventDefault();
  e.returnValue = '';
}

/** Ferme le partage : tous les invités sont déconnectés. */
export function stopHosting() {
  window.removeEventListener('beforeunload', guardUnload);
  for (const c of conns.values()) c.conn.close();
  conns.clear();
  removedComments.clear();
  peer?.destroy();
  peer = null;
  resetGuards();
  useShare.setState({ role: 'none', status: 'idle', room: undefined, password: undefined, guests: [], error: undefined });
}

// --- Invité -------------------------------------------------------------------------------------

export async function joinSession(room: string, password: string, name: string): Promise<boolean> {
  // Un partage hébergé dans cet onglet se ferme d'abord (ses invités sont prévenus).
  if (useShare.getState().role === 'host') stopHosting();
  leaveSession();
  useShare.setState({ role: 'guest', status: 'joining', error: undefined, room, via: 'peer' });
  try {
    peer = await newPeer();
    const conn = peer.connect(room, { reliable: true });
    hostConn = conn;
    let kicked = false;
    return await new Promise<boolean>((resolve) => {
      const fail = (error: string) => {
        clearTimeout(timer);
        // Connexion manquée : on n'est plus invité (boutons d'enregistrement, export… rétablis).
        hostConn?.close();
        hostConn = null;
        peer?.destroy();
        peer = null;
        resetGuards();
        useShare.setState({ role: 'none', status: 'error', error, room: undefined });
        resolve(false);
      };
      const timer = setTimeout(() => fail('L’hôte ne répond pas : son partage est peut-être fermé.'), 20000);
      conn.on('open', () => send(conn, { t: 'hello', password, name }));
      conn.on('data', (raw) => {
        const m = raw as Msg;
        if (m.t === 'welcome') {
          clearTimeout(timer);
          useShare.setState({ mode: m.mode, keep: m.keep, hostName: m.hostName, guests: m.guests, selfName: m.name });
          // Tenu pour présent tant que la base n'a pas répondu : rien ne s'écrit par-dessus entre-temps.
          localTwin = true;
          void db.projects
            .get(m.doc.project.id)
            .then((r) => {
              if (hostConn === conn) localTwin = !!r;
            })
            .catch(() => undefined);
          installGuards();
          // La relecture en ligne reste à l'hôte : ni son lien ni son état ne passent chez l'invité (ni dans sa copie).
          // Projet partagé chargé avant d'être « rejoint » : il remplace le projet ouvert ici sans
          // être pris pour l'ouverture d'un autre projet (qui ferait quitter le partage).
          useProjectStore.getState().loadDoc(withoutReview(m.doc));
          useShare.setState({ status: 'joined' });
          // Rien de ce projet n'est enregistré ici (sauf copie accordée) : pas d'état hérité du précédent.
          useUi.getState().set({ saveStatus: 'idle', selection: null, editing: null });
          resolve(true);
        } else if (m.t === 'denied') fail(m.reason);
        else if (m.t === 'bye') kicked = true;
        else if (m.t === 'ops') applyRemote(m.ops.filter((o) => o.p[0] !== 'review'));
        else if (m.t === 'settings') {
          const wasKept = useShare.getState().keep;
          useShare.setState({ mode: m.mode, keep: m.keep });
          const doc = useProjectStore.getState().doc;
          // Copie retirée par l'hôte : celle déjà enregistrée ici disparaît ; copie accordée : enregistrée tout de suite.
          if (wasKept && !m.keep && doc && !localTwin) void deleteProject(doc.project.id);
          if (!wasKept && m.keep && doc && !localTwin) void saveProject(doc);
        }
        else if (m.t === 'guests') useShare.setState({ guests: m.guests });
        else if (m.t === 'blob?') void answerBlob(conn, m.key);
        else if (m.t === 'blob') receiveBlob(m);
      });
      conn.on('close', () => {
        if (useShare.getState().status === 'joined') void expelled(kicked);
      });
      peer?.on('error', (e) => fail(e.type === 'peer-unavailable' ? 'Ce partage n’existe plus ou l’hôte est hors ligne.' : e.message));
    });
  } catch (e) {
    peer?.destroy();
    peer = null;
    useShare.setState({ role: 'none', status: 'error', error: (e as Error).message });
    return false;
  }
}

/**
 * L'hôte a fermé le partage (ou retiré l'invité) : retour à l'accueil. Copie autorisée : le projet,
 * dans son dernier état, est enregistré dans ce navigateur et figure à l'accueil.
 */
async function expelled(kicked = false) {
  const { keep } = useShare.getState();
  const doc = useProjectStore.getState().doc;
  useShare.setState({ status: 'closed' });
  let saved = false;
  if (keep && doc) {
    try {
      const copy = localTwin ? projectCopy(doc, newId()) : doc;
      await saveProject(copy);
      rememberLastProject(copy.project.id);
      saved = true;
    } catch {
      /* stockage indisponible : pas de copie */
    }
  }
  leaveSession();
  useProjectStore.getState().loadDoc(null);
  navigate('home');
  const why = kicked ? 'Vous avez été retiré du partage.' : 'Partage fermé par l’hôte.';
  useUi.getState().toast({ message: saved ? `${why} Votre copie est à l’accueil.` : why });
}

/**
 * Quitte le partage ; sans copie autorisée, le projet reçu est retiré de ce navigateur (et de
 * l'affichage, sauf si l'invité vient d'ouvrir un de ses propres projets).
 */
export function leaveSession(unload = true) {
  const st = useShare.getState();
  if (st.role !== 'guest') return;
  hostConn?.close();
  hostConn = null;
  peer?.destroy();
  peer = null;
  resetGuards();
  const shared = st.room ? useProjectStore.getState().doc : null;
  if (!st.keep) {
    if (unload) useProjectStore.getState().loadDoc(null);
    if (shared && unload && !localTwin) void deleteProject(shared.project.id);
  }
  localTwin = false;
  useShare.setState({ role: 'none', status: 'idle', room: undefined, guests: [], hostName: undefined, selfName: undefined, error: undefined, via: undefined });
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
