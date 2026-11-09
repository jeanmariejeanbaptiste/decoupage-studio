/**
 * Relecture en ligne : les commentaires Google Drive du fichier publié deviennent des commentaires du
 * projet (fonction pure, idempotente). Chaque commentaire Drive est repris une fois, reconnu ensuite
 * par son identifiant (`remoteId`) : modifié dans Drive, il est mis à jour ; supprimé, il est retiré
 * (jamais ce que l'auteur a écrit). Ce qui arrive est vérifié : endroit existant dans la version visée,
 * textes et tracés bornés. Un commentaire sans traîne (écrit dans Drive) n'est pas perdu : il se pose
 * sur la première séquence de la version publiée.
 */
import { newId } from './factory';
import type { CommentAnchor, CommentMarks, CommentReply, ReviewComment } from './comments';
import { cleanRef, decodeComment, driveKey, type TrailerPayload } from './reviewTrailer';
import { locateQuote } from './reviewSnapshot';
import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS, type ColumnKey, type ID, type ProjectDoc } from './types';

/** Commentaire tel que l'API de Drive le rend (`comments.list`). */
export interface DriveComment {
  id: string;
  content?: string;
  author?: { displayName?: string; me?: boolean };
  createdTime?: string;
  modifiedTime?: string;
  deleted?: boolean;
}

export const LIMITS = {
  text: 5000,
  quote: 1000,
  paths: 50,
  path: 20_000,
  /** Poids total des tracés d'un commentaire (caractères). */
  marks: 100_000,
  files: 10,
  author: 80,
  /** Commentaires Drive repris au plus, pour tout le fichier puis par compte Google. */
  imported: 500,
  perAuthor: 100,
} as const;
export const WITHDRAWN = 'Commentaire retiré par son auteur.';

export interface MergeOptions {
  /** Version publiée : celle des commentaires qui n'en désignent pas une connue. */
  versionId?: ID;
  /** Commentaires Drive retirés par l'auteur : jamais réimportés. */
  dismissed?: readonly string[];
  /** Charges rangées à part (tracés lourds), déjà lues, par commentaire Drive. */
  extra?: Readonly<Record<string, Partial<TrailerPayload>>>;
  /** Date à défaut de celle de Drive. */
  now?: string;
  /**
   * Chez un relecteur : ses envois en cours ou manqués (identifiants locaux). Sans réponse de Drive,
   * ils sont reconnus par la traîne ; leur texte local (une correction pas encore partie) fait foi.
   */
  pending?: ReadonlySet<ID>;
}

const COLUMNS = new Set<string>([...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS]);
const SAFE_PATH = /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/;
const ID_RE = /^[\w-]{4,64}$/;

interface VersionView {
  scenario: string;
  sequenceIds: ID[];
  sequences: ProjectDoc['sequences'];
  shots: ProjectDoc['shots'];
}

/** Contenu d'une version : la courante vit dans le projet, les autres sont rangées. */
function versionView(doc: ProjectDoc, versionId: ID | undefined): VersionView {
  const v = doc.versions?.find((x) => x.id === versionId);
  const current = { scenario: doc.scenario ?? '', sequenceIds: doc.project.sequenceIds, sequences: doc.sequences, shots: doc.shots };
  if (!v?.slice || v.id === doc.activeVersionId) return current;
  // Instantané de relecture : une version précédente n'y garde que son texte ; ses séquences et ses
  // plans ont les mêmes identifiants que ceux de la version publiée.
  if (!v.slice.sequenceIds.length && !Object.keys(v.slice.shots).length) return { ...current, scenario: v.slice.scenario ?? '' };
  return { scenario: v.slice.scenario ?? '', sequenceIds: v.slice.sequenceIds, sequences: v.slice.sequences, shots: v.slice.shots };
}

function resolveVersion(doc: ProjectDoc, wanted: unknown, fallback: ID | undefined): ID | undefined {
  const known = (id: unknown): id is ID => typeof id === 'string' && !!doc.versions?.some((v) => v.id === id);
  if (known(wanted)) return wanted;
  if (known(fallback)) return fallback;
  return doc.activeVersionId;
}

const int = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
const norm = (x: string) => x.replace(/\s+/g, ' ').trim();

/** Endroit vérifié dans la version visée (passage recalé par sa citation au besoin), ou rien. */
export function checkAnchor(doc: ProjectDoc, versionId: ID | undefined, a: unknown): CommentAnchor | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as Record<string, unknown>;
  const v = versionView(doc, versionId);
  if (x.kind === 'script') {
    const quote = typeof x.quote === 'string' ? x.quote.slice(0, LIMITS.quote) : '';
    const start = int(x.start);
    const end = int(x.end);
    const text = v.scenario;
    if (start !== null && end !== null && start <= end && end <= text.length && (!quote || norm(text.slice(start, end)) === norm(quote))) return { kind: 'script', start, end, quote };
    const found = locateQuote(text, quote, start ?? 0);
    return found ? { kind: 'script', ...found, quote } : null;
  }
  if (x.kind === 'shot' && typeof x.shotId === 'string' && v.shots[x.shotId]) {
    return { kind: 'shot', shotId: x.shotId, ...(typeof x.col === 'string' && COLUMNS.has(x.col) ? { col: x.col as ColumnKey } : {}) };
  }
  if (x.kind === 'sequence' && typeof x.seqId === 'string' && v.sequences[x.seqId]) return { kind: 'sequence', seqId: x.seqId };
  return null;
}

/** Endroit de repli : la première séquence de la version (ou le début du scénario). */
function fallbackAnchor(doc: ProjectDoc, versionId: ID | undefined): CommentAnchor {
  const v = versionView(doc, versionId);
  const seqId = v.sequenceIds.find((id) => v.sequences[id]);
  return seqId ? { kind: 'sequence', seqId } : { kind: 'script', start: 0, end: 0, quote: '' };
}

/** Tracés bornés : chemins SVG simples, en nombre et en longueur limités. */
export function checkMarks(m: unknown): CommentMarks | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const x = m as Record<string, unknown>;
  if ((x.surface !== 'script' && x.surface !== 'cut') || !Array.isArray(x.paths)) return undefined;
  const paths: string[] = [];
  let weight = 0;
  for (const p of x.paths) {
    if (paths.length >= LIMITS.paths) break;
    if (typeof p !== 'string' || p.length > LIMITS.path || !SAFE_PATH.test(p)) continue;
    if ((weight += p.length) > LIMITS.marks) break;
    paths.push(p);
  }
  return paths.length ? { surface: x.surface, paths } : undefined;
}

function checkFiles(f: unknown): string[] {
  if (!Array.isArray(f)) return [];
  return f
    .map(cleanRef)
    .filter((r): r is NonNullable<typeof r> => !!r)
    .slice(0, LIMITS.files)
    .map(driveKey);
}

const cleanAuthor = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, LIMITS.author) : '') || 'Relecteur';
const isoOr = (x: unknown, fallback: string) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : fallback);
const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) => (a ?? []).join('\n') === (b ?? []).join('\n');
const sameMarks = (a: CommentMarks | undefined, b: CommentMarks | undefined) => a?.surface === b?.surface && sameList(a?.paths, b?.paths);

/** Clés des images jointes à des commentaires Drive (à rapatrier). */
export function driveAttachmentKeys(remote: readonly DriveComment[]): string[] {
  const out = new Set<string>();
  for (const rc of remote) if (!rc.deleted) for (const k of checkFiles(decodeComment(rc.content ?? '').payload?.f)) out.add(k);
  return [...out];
}

/**
 * Reprend les commentaires Drive dans le projet (à appeler dans une modification immer). Renvoie
 * `true` si quelque chose a changé.
 */
export function mergeDriveComments(doc: ProjectDoc, remote: readonly DriveComment[], opts: MergeOptions = {}): boolean {
  const dismissed = new Set(opts.dismissed ?? []);
  const now = opts.now ?? new Date().toISOString();
  const list = remote.filter((r) => r && typeof r.id === 'string' && r.id).slice().sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? ''));
  let changed = false;
  const comments = () => (doc.comments ??= []);
  const find = (rid: string): { c: ReviewComment; r?: CommentReply } | null => {
    for (const c of doc.comments ?? []) {
      if (c.remoteId === rid) return { c };
      const r = c.replies.find((x) => x.remoteId === rid);
      if (r) return { c, r };
    }
    return null;
  };
  const items = () => (doc.comments ?? []).flatMap((c) => [c, ...c.replies]);
  const used = (id: string) => items().some((x) => x.id === id);
  // Identifiant de repli tiré du commentaire Drive : le même si la reprise est rejouée (historique).
  const freshId = (i: unknown, rid: string) => {
    if (typeof i === 'string' && ID_RE.test(i) && !used(i)) return i;
    const own = `d-${rid}`.slice(0, 64);
    return ID_RE.test(own) && !used(own) ? own : newId();
  };
  // Bornes : un lien ouvert en commentaire à tous ne doit pas gonfler le projet sans fin.
  let total = 0;
  const perAuthor = new Map<string, number>();
  for (const x of items())
    if (x.remoteId) {
      total++;
      perAuthor.set(x.author, (perAuthor.get(x.author) ?? 0) + 1);
    }
  const room = (author: string) => total < LIMITS.imported && (perAuthor.get(author) ?? 0) < LIMITS.perAuthor;
  const count = (author: string) => {
    total++;
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
  };

  for (const rc of list) {
    let found = find(rc.id);
    // Retiré par l'auteur du projet : traité comme une suppression dans Drive.
    if (rc.deleted || (found && dismissed.has(rc.id))) {
      if (!found) continue;
      if (found.r) found.c.replies = found.c.replies.filter((x) => x.remoteId !== rc.id);
      else if (!found.c.replies.length) doc.comments = comments().filter((x) => x.remoteId !== rc.id);
      else if (found.c.text !== WITHDRAWN || found.c.marks || found.c.attachments) {
        // Des réponses y sont attachées : le fil reste, le commentaire retiré s'efface.
        found.c.text = WITHDRAWN;
        delete found.c.marks;
        delete found.c.attachments;
      } else continue;
      changed = true;
      continue;
    }
    const decoded = decodeComment(rc.content ?? '');
    const p: TrailerPayload = { ...(decoded.payload ?? {}), ...(opts.extra?.[rc.id] ?? {}) };
    const text = decoded.text.slice(0, LIMITS.text).trim();
    const author = cleanAuthor(rc.author?.displayName);
    const versionId = resolveVersion(doc, p.v, opts.versionId);
    const marks = checkMarks(p.m);
    const attachments = checkFiles(p.f);
    // Envoyé d'ici sans réponse de Drive (connexion coupée) : le commentaire local est le même.
    if (!found && typeof p.i === 'string' && opts.pending?.has(p.i)) {
      const c = (doc.comments ?? []).find((x) => x.id === p.i && !x.remoteId);
      const r = c ? undefined : (doc.comments ?? []).flatMap((x) => x.replies.map((y) => ({ c: x, r: y }))).find((x) => x.r.id === p.i && !x.r.remoteId);
      if (c) {
        c.remoteId = rc.id;
        found = { c };
      } else if (r) {
        r.r.remoteId = rc.id;
        found = r;
      }
      if (found) changed = true;
    }
    if (found) {
      const t = found.r ?? found.c;
      if (t.author !== author) {
        t.author = author;
        changed = true;
      }
      // Envoi en cours ou manqué : la version locale (correction comprise) attend de partir.
      if (opts.pending?.has(t.id)) continue;
      if (t.text !== text) {
        t.text = text;
        changed = true;
      }
      if (!sameList(t.attachments, attachments)) {
        if (attachments.length) t.attachments = attachments;
        else delete t.attachments;
        changed = true;
      }
      if (!found.r && !sameMarks(found.c.marks, marks)) {
        if (marks) found.c.marks = marks;
        else delete found.c.marks;
        changed = true;
      }
      continue;
    }
    if (dismissed.has(rc.id)) continue;
    if (!text && !marks && !attachments.length) continue;
    // Doublon d'un commentaire déjà repris (même identifiant local, même compte : un envoi rejoué).
    if (typeof p.i === 'string' && items().some((x) => x.id === p.i && !!x.remoteId && x.author === author)) continue;
    if (!room(author)) continue;
    count(author);
    const at = isoOr(rc.createdTime, now);
    if (p.r || p.rr) {
      const parent = comments().find((c) => c.id === p.r) ?? (typeof p.rr === 'string' ? comments().find((c) => c.remoteId === p.rr) : undefined);
      if (parent) {
        parent.replies.push({ id: freshId(p.i, rc.id), author, text, at, ...(versionId ? { versionId } : {}), ...(attachments.length ? { attachments } : {}), remoteId: rc.id });
        changed = true;
        continue;
      }
      // Fil retiré entre-temps : la réponse devient un commentaire, rien ne se perd.
    }
    const anchor = checkAnchor(doc, versionId, p.a) ?? fallbackAnchor(doc, versionId);
    comments().push({
      id: freshId(p.i, rc.id),
      ...(versionId ? { versionId } : {}),
      anchor,
      author,
      text,
      at,
      replies: [],
      ...(attachments.length ? { attachments } : {}),
      ...(marks ? { marks } : {}),
      remoteId: rc.id,
    });
    changed = true;
  }
  return changed;
}

const idsOf = (list: readonly ReviewComment[] | undefined) => new Set((list ?? []).flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]));
const remotesOf = (list: readonly ReviewComment[] | undefined) => new Set((list ?? []).flatMap((c) => [c.remoteId, ...c.replies.map((r) => r.remoteId)]).filter((x): x is string => !!x));

/**
 * Chez un relecteur, un instantané republié remplace le précédent : ses commentaires font foi ; s'y
 * ajoutent ceux écrits ici (ou repris de Drive) que l'auteur n'a pas encore republiés. Ceux que
 * l'auteur a retirés depuis l'instantané précédent ne reviennent pas, ni les commentaires Drive qu'il
 * a écartés (`dismissed`), même relevés ici avant qu'il ne les écarte.
 */
export function mergeSnapshotComments(
  local: readonly ReviewComment[] | undefined,
  prev: readonly ReviewComment[] | undefined,
  next: readonly ReviewComment[] | undefined,
  dismissed: readonly string[] = [],
): ReviewComment[] {
  const out: ReviewComment[] = JSON.parse(JSON.stringify(next ?? [])) as ReviewComment[];
  const nextIds = idsOf(next);
  const nextRemote = remotesOf(next);
  const prevIds = idsOf(prev);
  const gone = new Set(dismissed);
  const known = (x: { id: string; remoteId?: string }) => nextIds.has(x.id) || (!!x.remoteId && nextRemote.has(x.remoteId));
  const fresh = (x: { id: string; remoteId?: string }) => !known(x) && !prevIds.has(x.id) && !(x.remoteId && gone.has(x.remoteId));
  for (const c of local ?? []) {
    if (!known(c)) {
      if (fresh(c)) out.push(JSON.parse(JSON.stringify({ ...c, replies: c.replies.filter((r) => !(r.remoteId && gone.has(r.remoteId))) })) as ReviewComment);
      continue;
    }
    const target = out.find((x) => x.id === c.id || (!!c.remoteId && x.remoteId === c.remoteId));
    if (!target) continue;
    for (const r of c.replies) if (fresh(r)) target.replies.push(JSON.parse(JSON.stringify(r)) as CommentReply);
  }
  return out;
}
