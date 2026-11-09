/**
 * Relecture en ligne par Google Drive, sans serveur.
 *
 * L'auteur publie une version du film : un instantané (rien de privé, voir `reviewSnapshot.ts`) dans
 * son Drive, ouvert en commentaire à tous ceux qui ont le lien. Les relecteurs le lisent sans compte
 * (clé d'API) ; pour commenter, ils se connectent : chaque remarque est un commentaire Drive natif
 * (signé par Google) dont la traîne dit où elle porte. L'auteur relève ces commentaires (ouverture du
 * projet, retour sur la page, toutes les 2 min), y répond dans l'application ; ses réponses partent
 * chez les relecteurs en réécrivant la seule partie commentaires de l'instantané.
 *
 * Chez le relecteur, le projet relu ne vit qu'en mémoire (comme un invité « Commenter » d'un partage
 * en direct) : jamais enregistré, jamais synchronisé.
 */
import { create } from 'zustand';
import { produce } from 'immer';
import { REVIEW_ENABLED } from '../app/config';
import { commentAttachments, deleteComment, deleteReply } from '../domain/comments';
import type { Op } from '../domain/patch';
import { LIMITS, mergeDriveComments, mergeSnapshotComments, type DriveComment } from '../domain/reviewMerge';
import { parseReviewSnapshot, reviewDoc, reviewMediaKeys, reviewSnapshot, withComments, type ReviewPublication, type ReviewSnapshot } from '../domain/reviewSnapshot';
import { cleanRef, decodeComment, driveKey, driveRefOf, encodeComment, MAX_CONTENT, type DriveRef, type TrailerPayload } from '../domain/reviewTrailer';
import { ProjectFileError, type MediaEntry } from '../domain/serialize';
import type { ID, ProjectDoc } from '../domain/types';
import { ensureVersions } from '../domain/versions';
import { driveFileToken, dropToken, forgetReviewerAccess, preloadGoogle, requestDriveFile, setReviewContext, useCloud } from './cloud';
import { getBlob, putBlobRaw } from './db';
import { blobToBase64, flushEditors, flushSave } from './persistence';
import { applyRemote, mutateDoc, mutateOutsideHistory, useProjectStore } from './projectStore';
import * as drive from './reviewDrive';
import { asComment, enterDriveReview, leaveSession, useShare } from './share';

/** Retours relevés au plus souvent toutes les 2 min, page visible. */
const SYNC_EVERY = 120_000;
/** Commentaires de l'auteur renvoyés aux relecteurs au plus une fois toutes les 20 s. */
const PUSH_EVERY = 20_000;
const PUSH_DEBOUNCE = 1500;
const SESSION_KEY = 'ds-review-session';
/** Fichiers nommés par un relecteur : image jointe, tracés rangés à part. */
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_EXTRA = 2 * 1024 * 1024;

/**
 * Relecteur : où en est un commentaire (ou une réponse) qu'il envoie ou retire ; `stopped` : l'auteur
 * a arrêté la relecture, plus rien ne part.
 */
export type ItemStatus = 'sending' | 'failed' | 'removing' | 'unremoved' | 'stopped';

interface ReviewState {
  /** Auteur : publication ou réglage du lien en cours. */
  busy: null | 'publish' | 'link';
  error?: string;
  /** Projet concerné par l'erreur (elle ne s'affiche que là). */
  errorFor?: string;
  /** Auteur : derniers retours relevés. */
  lastSync?: string;
  /** Relecteur : ouverture du lien. */
  phase: 'idle' | 'loading' | 'ready' | 'error';
  loadError?: string;
  /** Relecteur : envois en cours ou manqués (commentaire ou réponse, par identifiant local). */
  pending: Record<ID, ItemStatus>;
  /** Relecteur : ses commentaires Drive (il peut les corriger ou les retirer). */
  mine: string[];
  /** Relecteur : son nom Google. */
  me?: string;
}

export const useReview = create<ReviewState>(() => ({ busy: null, phase: 'idle', pending: {}, mine: [] }));

const cur = () => useProjectStore.getState().doc;
const jsonBlob = (x: unknown) => new Blob([JSON.stringify(x)], { type: 'application/json' });
const refOf = (pub: ReviewPublication): DriveRef => (pub.resourceKey ? { id: pub.fileId, rk: pub.resourceKey } : { id: pub.fileId });

/** `<id>[~<clé>]` d'un lien de relecture. */
export function parseReviewRef(raw: string): DriveRef | null {
  const [id, rk] = decodeURIComponent(raw).split('~');
  return cleanRef(rk ? { id, rk } : { id });
}

export const reviewLink = (pub: Pick<ReviewPublication, 'fileId' | 'resourceKey'>) =>
  `${window.location.origin}${window.location.pathname}#/review/${pub.fileId}${pub.resourceKey ? `~${pub.resourceKey}` : ''}`;

/** Une seule écriture du fichier publié à la fois (publication, renvoi des commentaires). */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

function message(e: unknown): string {
  if (e instanceof drive.DriveError) {
    if (e.status === 401) return 'Session Google expirée : réessayez.';
    if (e.status === 403 && /publishOutNotPermitted|domainPolicy|cannotShare|sharingRateLimit|teamDrive/i.test(e.reason)) return 'Votre compte Google ne permet pas de partager hors de votre organisation.';
    if (e.status === 403) return 'Google Drive refuse cette opération.';
    if (e.status === 404) return 'Fichier introuvable dans Google Drive.';
    return 'Google Drive ne répond pas. Réessayez plus tard.';
  }
  if (e instanceof TypeError) return 'Google Drive est injoignable.';
  return (e as Error)?.message || 'Erreur inattendue.';
}

/** Jeton refusé (expiré, retiré) : oublié, redemandé au prochain geste. */
function forget401(e: unknown, token: string) {
  if (e instanceof drive.DriveError && e.status === 401) dropToken(token);
}

// --- Images --------------------------------------------------------------------------------------

/**
 * Image réduite pour la relecture : JPEG, 1600 px au plus, qualité 0,82, fond blanc. Toute image
 * venue d'ailleurs passe par là avant d'être rangée ou montrée : décodée puis réencodée, elle ne peut
 * plus être qu'une image (jamais un SVG ni une page qui s'exécuterait dans l'application).
 */
async function reduceImage(blob: Blob): Promise<Blob> {
  if (blob.size > MAX_IMAGE) throw new Error('Image trop lourde.');
  const bmp = await createImageBitmap(blob);
  try {
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d');
    if (!g) throw new Error('Image illisible.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Image illisible.'))), 'image/jpeg', 0.82));
  } finally {
    bmp.close();
  }
}

async function mediaOf(keys: readonly string[]): Promise<Record<string, MediaEntry>> {
  const out: Record<string, MediaEntry> = {};
  for (const k of keys) {
    const b = await getBlob(k);
    if (!b) continue;
    try {
      const small = await reduceImage(b);
      out[k] = { type: 'image/jpeg', data: await blobToBase64(small) };
    } catch {
      /* image illisible : la case restera vide chez le relecteur */
    }
  }
  return out;
}

function fromBase64(m: MediaEntry): Blob {
  const bin = atob(m.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m.type });
}

/** Tracés trop lourds rangés à part par le relecteur : lus une fois par version du commentaire. */
const extraCache = new Map<string, Partial<TrailerPayload>>();
async function loadExtras(remote: readonly DriveComment[]): Promise<Record<string, Partial<TrailerPayload>>> {
  const out: Record<string, Partial<TrailerPayload>> = {};
  for (const rc of remote) {
    if (rc.deleted) continue;
    const x = cleanRef(decodeComment(rc.content ?? '').payload?.x);
    if (!x) continue;
    const key = `${rc.id}@${rc.modifiedTime ?? ''}`;
    if (!extraCache.has(key)) {
      try {
        const j = JSON.parse(await (await drive.readPublic(x, MAX_EXTRA)).text()) as { m?: unknown };
        extraCache.set(key, { m: j.m as TrailerPayload['m'] });
      } catch {
        continue;
      }
    }
    out[rc.id] = extraCache.get(key)!;
  }
  return out;
}

// --- Auteur --------------------------------------------------------------------------------------

/**
 * Métadonnées de la relecture : posées partout dans l'historique (annuler ne fait pas oublier le
 * fichier publié) ; la date du projet avance pour la synchronisation privée.
 */
function patchReview(patch: Partial<ReviewPublication>): void {
  const doc = cur();
  if (!doc) return;
  const ops: Op[] = doc.review
    ? Object.entries(patch).map(([k, v]): Op => (v === undefined ? { p: ['review', k], del: true } : { p: ['review', k], v }))
    : [{ p: ['review'], v: Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }];
  ops.push({ p: ['project', 'updatedAt'], v: new Date().toISOString() });
  applyRemote(ops);
}

/** Versions du film : la relecture en a besoin (les commentaires s'y rattachent), posées hors historique. */
function ensureVersionsEverywhere(): void {
  const doc = cur();
  if (!doc || doc.versions?.length) return;
  const next = produce(doc, (d) => void ensureVersions(d));
  applyRemote([
    { p: ['versions'], v: next.versions },
    { p: ['activeVersionId'], v: next.activeVersionId },
  ]);
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastPush = 0;
let pushDirty = false;

/** Publie (ou met à jour) la version courante. À appeler depuis un clic. */
export async function publishReview(): Promise<void> {
  if (useReview.getState().busy || !cur()) return;
  const tokenP = requestDriveFile();
  const pid0 = cur()!.project.id;
  useReview.setState({ busy: 'publish', error: undefined, errorFor: undefined });
  let token = '';
  try {
    token = await tokenP;
    flushEditors();
    await serial(async () => {
      ensureVersionsEverywhere();
      const doc = cur();
      if (!doc) return;
      const pid = doc.project.id;
      const publishedAt = new Date().toISOString();
      const media = await mediaOf(reviewMediaKeys(reviewDoc(doc)));
      const body = jsonBlob(reviewSnapshot(doc, media, publishedAt));
      const prev = doc.review;
      let ref: DriveRef | null = prev ? refOf(prev) : null;
      if (ref) {
        try {
          await drive.updateFile(token, ref.id, body);
        } catch (e) {
          // Fichier supprimé du Drive entre-temps : un nouveau prend sa place (nouveau lien).
          if (!(e instanceof drive.DriveError && e.status === 404)) throw e;
          ref = null;
        }
      }
      const versionId = doc.activeVersionId!;
      if (ref) {
        if (cur()?.project.id === pid) patchReview({ publishedVersionId: versionId, publishedAt });
      } else {
        ref = await drive.createFile(token, `Découpage Studio — ${doc.project.title || 'Projet'}.json`, body);
        if (cur()?.project.id !== pid) return;
        // Rangé d'abord comme arrêté : si l'ouverture du lien échoue, « Reprendre » la refait.
        patchReview({ fileId: ref.id, resourceKey: ref.rk, publishedVersionId: versionId, publishedAt, stopped: true });
        await drive.shareWithLink(token, ref.id, 'commenter');
        if (cur()?.project.id === pid) patchReview({ stopped: undefined });
      }
      // L'instantané emporte les commentaires du moment.
      clearTimeout(pushTimer);
      pushDirty = false;
    });
    useReview.setState({ busy: null });
  } catch (e) {
    if (token) forget401(e, token);
    useReview.setState({ busy: null, error: message(e), errorFor: pid0 });
  }
}

/** Arrête (ou rouvre) le lien de relecture ; le fichier reste. À appeler depuis un clic. */
export async function setReviewLink(open: boolean): Promise<void> {
  const pub = cur()?.review;
  if (!pub || useReview.getState().busy) return;
  const tokenP = requestDriveFile();
  const pid0 = cur()!.project.id;
  useReview.setState({ busy: 'link', error: undefined, errorFor: undefined });
  let token = '';
  try {
    token = await tokenP;
    if (open) await drive.shareWithLink(token, pub.fileId, 'commenter');
    else await drive.unshare(token, pub.fileId);
    if (cur()?.review?.fileId === pub.fileId) patchReview({ stopped: open ? undefined : true });
    useReview.setState({ busy: null });
  } catch (e) {
    if (token) forget401(e, token);
    useReview.setState({ busy: null, error: message(e), errorFor: pid0 });
  }
}

/** Image jointe par un relecteur, lue par son lien : bornée, puis réencodée (jamais servie telle quelle). */
async function remoteImage(ref: DriveRef): Promise<Blob> {
  return reduceImage(await drive.readPublic(ref, MAX_IMAGE));
}

/**
 * Images jointes par les relecteurs, que le projet cite désormais : rangées dans ce navigateur, avec
 * le projet (après la reprise des retours, pour que le ménage des images ne les croie pas orphelines).
 */
async function fetchAttachments(projectId: string): Promise<void> {
  const d = cur();
  if (d?.project.id !== projectId) return;
  for (const key of commentAttachments(d)) {
    const ref = driveRefOf(key);
    if (!ref || (await getBlob(key, false))) continue;
    try {
      await putBlobRaw(key, projectId, await remoteImage(ref));
    } catch {
      /* image retirée par son auteur, trop lourde ou illisible : la vignette reste vide */
    }
  }
}

/** Commentaires Drive vus vivants au dernier relevé (l'auteur retire ceux qu'il écarte). */
let alive = new Set<string>();
/** Commentaires Drive déjà retirés d'ici. */
const removed = new Set<string>();

/** Commentaires écartés par l'auteur : retirés aussi de Drive (le propriétaire du fichier le peut). */
async function removeDismissed(token: string, pub: ReviewPublication): Promise<void> {
  for (const id of pub.dismissed ?? []) {
    if (removed.has(id) || !alive.has(id)) continue;
    try {
      await drive.removeComment(token, pub.fileId, id);
      removed.add(id);
      alive.delete(id);
    } catch (e) {
      // Déjà retiré : rien à faire ; sinon, `dismissed` reste le filet (jamais réimporté, ni montré).
      if (e instanceof drive.DriveError && e.status === 404) removed.add(id);
      forget401(e, token);
    }
  }
}

let syncing = false;

/** Relève les retours des relecteurs (auteur connecté avec l'accès aux fichiers). */
export async function syncReview(): Promise<void> {
  const doc = cur();
  const pub = doc?.review;
  const token = driveFileToken();
  if (!doc || !pub || !token || syncing || useShare.getState().role === 'guest') return;
  syncing = true;
  try {
    const remote = await drive.listComments(token, pub.fileId);
    alive = new Set(remote.filter((r) => !r.deleted).map((r) => r.id));
    const extra = await loadExtras(remote);
    const now = cur();
    if (now?.project.id !== doc.project.id || !now.review) return;
    const { publishedVersionId, dismissed } = now.review;
    // Hors historique : annuler ne défait pas des retours relevés, « Rétablir » reste possible.
    const at = new Date().toISOString();
    mutateOutsideHistory((d) => void mergeDriveComments(d, remote, { versionId: publishedVersionId, dismissed, extra, now: at }));
    await fetchAttachments(doc.project.id);
    useReview.setState({ lastSync: new Date().toISOString() });
    if (pushDirty) schedulePush();
  } catch (e) {
    forget401(e, token);
  } finally {
    syncing = false;
  }
}

function schedulePush(): void {
  pushDirty = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushComments(), Math.max(PUSH_DEBOUNCE, lastPush + PUSH_EVERY - Date.now()));
}

/** Renvoie aux relecteurs les commentaires (réponses, réglés, retours importés) : le texte publié ne change pas. */
async function pushComments(): Promise<void> {
  const doc = cur();
  const pub = doc?.review;
  const token = driveFileToken();
  // Sans jeton : repris dès qu'il revient (premier geste de l'auteur).
  if (!doc || !pub || !pushDirty || !token) return;
  pushDirty = false;
  lastPush = Date.now();
  try {
    await serial(async () => {
      await removeDismissed(token, pub);
      // Lire, modifier, écrire : abandonné si le fichier a changé entre-temps (publication depuis un
      // autre onglet ou appareil), pour ne jamais ramener une publication plus ancienne.
      const version = await drive.fileVersion(token, pub.fileId);
      const snap: ReviewSnapshot = parseReviewSnapshot(await drive.readFile(token, refOf(pub)));
      const d = cur();
      if (!d || d.project.id !== doc.project.id || d.review?.fileId !== pub.fileId) return;
      if (snap.publishedAt !== d.review.publishedAt) return;
      const draft = withComments(snap, d, {});
      const missing = reviewMediaKeys(draft.doc).filter((k) => !draft.media[k]);
      const next = missing.length ? withComments(snap, d, await mediaOf(missing)) : draft;
      const same = JSON.stringify([next.doc.comments, next.dismissed, Object.keys(next.media)]) === JSON.stringify([snap.doc.comments, snap.dismissed, Object.keys(snap.media)]);
      if (same) return;
      if ((await drive.fileVersion(token, pub.fileId)) !== version) {
        schedulePush();
        return;
      }
      await drive.updateFile(token, pub.fileId, jsonBlob(next));
    });
  } catch (e) {
    forget401(e, token);
    pushDirty = true;
  }
}

// --- Relecteur -----------------------------------------------------------------------------------

let session: { raw: string; ref: DriveRef; snap: ReviewSnapshot; docId: string } | null = null;
const blobCache = new Map<string, Promise<Blob | undefined>>();
/** Relecteur : envois et retraits, un seul à la fois par commentaire (enchaînés). */
const flights = new Map<ID, Promise<void>>();
/** Relecteur : commentaires déjà tentés (un nouvel essai cherche d'abord s'ils sont arrivés). */
const attempted = new Set<ID>();
/** Relecteur : ses commentaires retirés (identifiants locaux), à retirer aussi de Drive s'ils y sont. */
const withdrawn = new Set<ID>();

/** Toujours la même relecture (l'instantané a pu être relu entre-temps). */
const sameSession = (s: { docId: string }) => session?.docId === s.docId;

/**
 * Images de la relecture : celles de l'instantané, puis celles jointes depuis Drive (lien public),
 * toujours réencodées avant d'être montrées.
 */
function reviewBlob(key: string): Promise<Blob | undefined> {
  const hit = blobCache.get(key);
  if (hit) return hit;
  const m = session?.snap.media[key];
  const ref = m ? null : driveRefOf(key);
  if (!m && !ref) return Promise.resolve(undefined);
  const p = (m ? reduceImage(fromBase64(m)) : remoteImage(ref!)).catch(() => {
    blobCache.delete(key);
    return undefined;
  });
  blobCache.set(key, p);
  return p;
}

function loadMessage(e: unknown): string {
  if (e instanceof drive.DriveError) {
    if (e.status === 404) return 'Cette relecture n’existe plus, ou son lien a été arrêté.';
    if (e.status === 403) return 'L’organisation de l’auteur limite l’accès à cette relecture.';
    return 'Google Drive ne répond pas. Réessayez plus tard.';
  }
  if (e instanceof ProjectFileError) return e.message;
  if (e instanceof TypeError) return 'Google Drive est injoignable.';
  return (e as Error)?.message || 'Relecture illisible.';
}

/** Projet relu, en mémoire : un identifiant à part, jamais celui de l'auteur (rien ne peut l'écraser ici). */
function reviewerDoc(snap: ReviewSnapshot, ref: DriveRef, comments = snap.doc.comments): ProjectDoc {
  const doc = structuredClone(snap.doc);
  doc.project.id = `review-${ref.id}`;
  doc.comments = structuredClone(comments ?? []);
  return doc;
}

const writeLocal = (recipe: (d: ProjectDoc) => void) => asComment(() => mutateDoc(recipe));

/** Ouvre un lien de relecture (lecture sans compte). */
export async function openReview(raw: string): Promise<boolean> {
  if (!REVIEW_ENABLED) {
    useReview.setState({ phase: 'error', loadError: 'La relecture en ligne n’est pas disponible ici.' });
    return false;
  }
  const ref = parseReviewRef(raw);
  if (!ref) {
    useReview.setState({ phase: 'error', loadError: 'Lien de relecture incomplet.' });
    return false;
  }
  useReview.setState({ phase: 'loading', loadError: undefined });
  // Connexion et sélecteur prêts pour le premier commentaire (la fenêtre de Google doit s'ouvrir au clic).
  void preloadGoogle().catch(() => undefined);
  void drive.loadPicker().catch(() => undefined);
  let snap: ReviewSnapshot;
  try {
    snap = parseReviewSnapshot(await (await drive.readPublic(ref)).text());
  } catch (e) {
    useReview.setState({ phase: 'error', loadError: loadMessage(e) });
    return false;
  }
  flushEditors();
  await flushSave();
  const doc = reviewerDoc(snap, ref);
  enterDriveReview(doc.project.director || 'l’auteur', reviewBlob);
  session = { raw, ref, snap, docId: doc.project.id };
  blobCache.clear();
  useProjectStore.getState().loadDoc(doc);
  try {
    sessionStorage.setItem(SESSION_KEY, raw);
  } catch {
    /* stockage indisponible : un rechargement ramènera à l'accueil */
  }
  useReview.setState({ phase: 'ready', pending: {}, mine: [] });
  void listAsReviewer();
  return true;
}

/** Rechargement de la page pendant une relecture : elle se rouvre. */
export async function resumeReview(): Promise<boolean> {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
  } catch {
    raw = null;
  }
  return raw ? openReview(raw) : false;
}

export function forgetReviewSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Texte lisible d'un commentaire Drive, tel que la reprise le garde. */
const remoteText = (rc: DriveComment) => decodeComment(rc.content ?? '').text.slice(0, LIMITS.text).trim();

/** Relecteur connecté : les commentaires des autres relecteurs, postés depuis la publication. */
async function listAsReviewer(): Promise<void> {
  const s = session;
  const token = driveFileToken();
  if (!s || !token) return;
  try {
    const remote = await drive.listComments(token, s.ref.id);
    const extra = await loadExtras(remote);
    if (!sameSession(s) || cur()?.project.id !== s.docId) return;
    // Retirés d'ici alors qu'ils partaient (ou que la réponse de Drive s'est perdue) : retirés de Drive aussi.
    const gone = remote.filter((r) => r.author?.me && !r.deleted && withdrawn.has(String(decodeComment(r.content ?? '').payload?.i ?? ''))).map((r) => r.id);
    for (const id of gone) void drive.removeComment(token, s.ref.id, id).catch(() => undefined);
    const pending = new Set(Object.keys(useReview.getState().pending));
    writeLocal((d) => void mergeDriveComments(d, remote, { versionId: s.snap.versionId, dismissed: [...(s.snap.dismissed ?? []), ...gone], extra, pending }));
    const mine = remote.filter((r) => r.author?.me && !r.deleted).map((r) => r.id);
    const me = remote.find((r) => r.author?.me)?.author?.displayName;
    // Envois manqués qui sont en fait arrivés, tels quels : plus rien à signaler. Une correction
    // restée ici (texte différent de celui de Drive) reste « Non envoyé ».
    const byId = new Map(remote.map((r) => [r.id, r]));
    const delivered = new Set(
      (cur()?.comments ?? [])
        .flatMap((c) => [c, ...c.replies])
        .filter((x) => {
          const rc = x.remoteId ? byId.get(x.remoteId) : undefined;
          return !!rc && !rc.deleted && remoteText(rc) === x.text;
        })
        .map((x) => x.id),
    );
    useReview.setState((st) => ({
      mine: [...new Set([...st.mine, ...mine])],
      me: me ?? st.me,
      pending: Object.fromEntries(Object.entries(st.pending).filter(([id, v]) => !(v === 'failed' && delivered.has(id)))),
    }));
  } catch (e) {
    // Fichier pas encore ouvert avec ce compte (sélecteur au premier commentaire) : rien à faire ici.
    forget401(e, token);
  }
}

/** Retour sur la page : l'instantané republié (réponses de l'auteur, nouvelle version), puis Drive. */
async function refreshReviewer(): Promise<void> {
  const s = session;
  if (!s) return;
  try {
    const snap = parseReviewSnapshot(await (await drive.readPublic(s.ref)).text());
    const doc = cur();
    if (session !== s || !doc || doc.project.id !== s.docId) return;
    const comments = mergeSnapshotComments(doc.comments, s.snap.doc.comments, snap.doc.comments, snap.dismissed);
    session = { ...s, snap };
    if (snap.publishedAt !== s.snap.publishedAt || snap.versionId !== s.snap.versionId) {
      // Nouvelle publication : la nouvelle version, avec les commentaires d'ici pas encore repris.
      blobCache.clear();
      useProjectStore.getState().loadDoc(reviewerDoc(snap, s.ref, comments));
    } else if (JSON.stringify(comments) !== JSON.stringify(doc.comments ?? [])) applyRemote([{ p: ['comments'], v: comments }]);
  } catch {
    /* lien arrêté ou réseau coupé : on garde ce qu'on a */
  }
  await listAsReviewer();
}

/** Commentaire ou réponse du relecteur, par identifiants locaux. */
export interface DriveItem {
  comment: ID;
  reply?: ID;
}
const keyOf = (it: DriveItem) => it.reply ?? it.comment;
const setPending = (id: ID, v: ItemStatus | null) =>
  useReview.setState((st) => {
    const pending = { ...st.pending };
    if (v) pending[id] = v;
    else delete pending[id];
    return { pending };
  });

function findItem(doc: ProjectDoc | null, it: DriveItem) {
  const c = doc?.comments?.find((x) => x.id === it.comment);
  const r = it.reply ? c?.replies.find((x) => x.id === it.reply) : undefined;
  return { c, r, target: it.reply ? r : c };
}

/** L'auteur a arrêté la relecture : le lien ne mène plus au fichier. */
class StoppedError extends Error {}

/** Une seule opération à la fois par commentaire : la suivante attend la fin de la précédente. */
function chain(id: ID, run: () => Promise<void>): Promise<void> {
  const prev = flights.get(id) ?? Promise.resolve();
  const p = prev.then(run, run);
  const tail = p.catch(() => undefined);
  flights.set(id, tail);
  void tail.then(() => flights.get(id) === tail && flights.delete(id));
  return p;
}

/** Commentaire déjà arrivé dans Drive (réponse de Drive perdue), reconnu par sa traîne. */
async function alreadySent(token: string, fileId: string, id: ID): Promise<DriveComment | undefined> {
  try {
    const list = await drive.listComments(token, fileId);
    return list.find((rc) => rc.author?.me && !rc.deleted && decodeComment(rc.content ?? '').payload?.i === id);
  } catch {
    return undefined;
  }
}

async function deliver(it: DriveItem, tokenP: Promise<string>): Promise<void> {
  const token = await tokenP;
  const s = session;
  if (!s) throw new Error('Relecture fermée.');
  const { c, r, target } = findItem(cur(), it);
  if (!c || !target) return;
  // Images jointes : dans le Drive du relecteur, lisibles par le lien.
  const files: DriveRef[] = [];
  for (const key of target.attachments ?? []) {
    const known = driveRefOf(key);
    if (known) {
      files.push(known);
      continue;
    }
    const blob = await getBlob(key);
    if (!blob) continue;
    const small = await reduceImage(blob);
    const ref = await drive.createFile(token, 'Découpage Studio — image.jpg', small);
    await drive.shareWithLink(token, ref.id, 'reader');
    blobCache.set(driveKey(ref), Promise.resolve(small));
    files.push(ref);
  }
  const versionId = r ? r.versionId : c.versionId;
  const payload: TrailerPayload = {
    i: target.id,
    ...(versionId ? { v: versionId } : {}),
    ...(r ? { r: c.id, ...(c.remoteId ? { rr: c.remoteId } : {}) } : { a: c.anchor, ...(c.marks ? { m: c.marks } : {}) }),
    ...(files.length ? { f: files } : {}),
  };
  let content = encodeComment(target.text, payload);
  if (content.length > MAX_CONTENT && payload.m) {
    const ref = await drive.createFile(token, 'Découpage Studio — tracés.json', jsonBlob({ m: payload.m }));
    await drive.shareWithLink(token, ref.id, 'reader');
    delete payload.m;
    payload.x = ref;
    content = encodeComment(target.text, payload);
  }
  // Nouvel essai d'un envoi sans réponse : il est peut-être arrivé ; on le corrige plutôt que d'en créer un second.
  let remoteId = target.remoteId;
  if (!remoteId && attempted.has(target.id)) remoteId = (await alreadySent(token, s.ref.id, target.id))?.id;
  attempted.add(target.id);
  const post = () => (remoteId ? drive.updateComment(token, s.ref.id, remoteId, content) : drive.createComment(token, s.ref.id, content));
  let res: DriveComment;
  try {
    res = await post();
  } catch (e) {
    forget401(e, token);
    if (!drive.unseen(e)) throw e;
    // Lien arrêté par l'auteur : inutile d'ouvrir le sélecteur sur un fichier devenu inaccessible.
    if (!(await drive.linkOpen(s.ref))) throw new StoppedError();
    // Ce compte n'a pas encore ouvert le fichier : le sélecteur de Google, présélectionné, puis on réessaie.
    if (!(await drive.openWithPicker(token, s.ref.id))) throw e;
    res = await post();
  }
  if (!sameSession(s)) return;
  writeLocal((d) => {
    const t = findItem(d, it).target;
    if (!t) return;
    t.remoteId = res.id;
    if (res.author?.displayName) t.author = res.author.displayName.slice(0, 80);
    if (files.length) t.attachments = files.map(driveKey);
  });
  useReview.setState((st) => ({ mine: [...new Set([...st.mine, res.id])], me: res.author?.displayName ?? st.me }));
}

const failure = (e: unknown): ItemStatus => (e instanceof StoppedError ? 'stopped' : 'failed');

/**
 * Envoie un commentaire (ou une réponse, ou sa correction) du relecteur. À appeler depuis le geste
 * « Envoyer » : la connexion Google, s'il en faut une, s'ouvre de ce clic.
 */
export function sendDriveItem(it: DriveItem): void {
  const tokenP = requestDriveFile();
  tokenP.catch(() => undefined);
  const id = keyOf(it);
  setPending(id, 'sending');
  void chain(id, () => deliver(it, tokenP)).then(
    () => {
      // Retiré pendant l'envoi : le retrait, enchaîné, dit lui-même où il en est.
      if (useReview.getState().pending[id] === 'sending') setPending(id, null);
    },
    (e) => {
      if (useReview.getState().pending[id] === 'sending') setPending(id, failure(e));
    },
  );
}

/** Corrige le texte d'un commentaire du relecteur (le sien). */
export function editDriveItem(it: DriveItem, text: string): void {
  const t = text.trim();
  const { target } = findItem(cur(), it);
  if (!target || t === target.text || useReview.getState().pending[keyOf(it)] === 'sending') return;
  if (!t && !target.attachments?.length && !(it.reply ? false : findItem(cur(), it).c?.marks)) return;
  writeLocal((d) => {
    const x = findItem(d, it).target;
    if (x) x.text = t;
  });
  sendDriveItem(it);
}

/** Retire un commentaire du relecteur (le sien), dans Drive puis ici. */
export function deleteDriveItem(it: DriveItem): void {
  const s = session;
  const { target } = findItem(cur(), it);
  if (!s || !target) return;
  const id = keyOf(it);
  const remove = () => writeLocal((d) => (it.reply ? deleteReply(d, it.comment, it.reply) : deleteComment(d, it.comment)));
  // Jamais envoyé, et rien en vol : il suffit de le retirer d'ici.
  if (!target.remoteId && !flights.has(id) && !attempted.has(id)) {
    remove();
    setPending(id, null);
    return;
  }
  const tokenP = requestDriveFile();
  tokenP.catch(() => undefined);
  withdrawn.add(id);
  setPending(id, 'removing');
  // Après l'envoi en cours, s'il y en a un : le commentaire créé entre-temps est retiré aussi.
  void chain(id, async () => {
    const rid = findItem(cur(), it).target?.remoteId;
    if (rid) await drive.removeComment(await tokenP, s.ref.id, rid);
  }).then(
    () => {
      if (sameSession(s)) remove();
      setPending(id, null);
    },
    // Pas retiré (réseau, droits) : il reste, avec « Non retiré — Réessayer ».
    () => {
      withdrawn.delete(id);
      setPending(id, 'unremoved');
    },
  );
}

/** Est-ce un commentaire (ou une réponse) de ce relecteur ? */
export const isMine = (st: Pick<ReviewState, 'mine' | 'pending'>, x: { id: ID; remoteId?: string }) => (x.remoteId ? st.mine.includes(x.remoteId) : !!st.pending[x.id]);

/** Nom affiché avant que Google ne signe le commentaire. */
export const reviewerName = () => useReview.getState().me || useCloud.getState().user?.name || 'Vous';

// --- Mise en route -------------------------------------------------------------------------------

/**
 * Relève et renvoie, au bon moment : à l'ouverture d'un projet publié, au retour sur la page, toutes
 * les 2 min tant qu'elle est visible, et quand l'accès aux fichiers revient. Côté relecteur : le
 * projet relu quitte la mémoire dès qu'on en ouvre un autre.
 */
export function startReviewSync(): () => void {
  if (!REVIEW_ENABLED) return () => undefined;
  setReviewContext({
    reviewing: () => !!session || useShare.getState().via === 'drive',
    published: () => !session && useShare.getState().role !== 'guest' && !!cur()?.review,
  });
  const refresh = () => {
    if (session) void refreshReviewer();
    else void syncReview();
  };
  const unsubDoc = useProjectStore.subscribe((s, prev) => {
    const d = s.doc;
    if (session) {
      // Le relecteur ouvre un de ses projets (ou en crée un) : la relecture se ferme, sans rien emporter.
      if (d && d.project.id !== session.docId && useShare.getState().via === 'drive') leaveSession(false);
      return;
    }
    // Une erreur de publication ne concerne que son projet.
    if (d?.project.id !== prev.doc?.project.id && useReview.getState().error) useReview.setState({ error: undefined, errorFor: undefined });
    if (!d?.review || useShare.getState().role === 'guest') return;
    if (d.project.id !== prev.doc?.project.id) {
      lastPush = 0;
      pushDirty = false;
      clearTimeout(pushTimer);
      void syncReview();
      return;
    }
    if (d.comments !== prev.doc?.comments) schedulePush();
  });
  const unsubShare = useShare.subscribe((s, prev) => {
    if (prev.via === 'drive' && s.via !== 'drive') {
      session = null;
      blobCache.clear();
      flights.clear();
      attempted.clear();
      withdrawn.clear();
      forgetReviewSession();
      // Relecteur sans compte ici : l'accès à Google ne lui survit pas.
      forgetReviewerAccess();
      useReview.setState({ phase: 'idle', pending: {}, mine: [], me: undefined, loadError: undefined });
    }
  });
  const unsubCloud = useCloud.subscribe((s, prev) => {
    if (s.fileAccess && !prev.fileAccess) {
      refresh();
      if (pushDirty) schedulePush();
    }
  });
  const onFocus = () => refresh();
  window.addEventListener('focus', onFocus);
  const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), SYNC_EVERY);
  return () => {
    unsubDoc();
    unsubShare();
    unsubCloud();
    window.removeEventListener('focus', onFocus);
    clearInterval(timer);
    clearTimeout(pushTimer);
  };
}
