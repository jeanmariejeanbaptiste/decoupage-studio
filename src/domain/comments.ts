/**
 * Commentaires de relecture : posés sur le scénario (un passage) ou sur le découpage (une cellule,
 * une séquence), rattachés à la version du film où ils ont été écrits, avec leurs réponses.
 * Communs au projet (ils circulent avec le partage) ; l'auteur les consulte, y répond ou les retire.
 */
import { newId } from './factory';
import type { ColumnKey, ID, ProjectDoc } from './types';

export type CommentAnchor =
  /** Passage du scénario (positions dans la source, tenues à jour par les modifications) et sa citation. */
  | { kind: 'script'; start: number; end: number; quote: string }
  /** Cellule du découpage (colonne absente : le plan entier). */
  | { kind: 'shot'; shotId: ID; col?: ColumnKey }
  /** Séquence du découpage. */
  | { kind: 'sequence'; seqId: ID };

export interface CommentReply {
  id: ID;
  author: string;
  text: string;
  at: string;
  /** Version où la réponse a été écrite (« en V2, c'est changé »). */
  versionId?: ID;
  /** Schémas et images joints (clés des fichiers). */
  attachments?: string[];
}

/** Tracés à main levée sur la page (entourer, souligner, flécher), en coordonnées de la page sans zoom. */
export interface CommentMarks {
  surface: 'script' | 'cut';
  /** Chemins SVG. */
  paths: string[];
}

export interface ReviewComment {
  id: ID;
  /** Version du film où le commentaire a été posé. */
  versionId?: ID;
  anchor: CommentAnchor;
  author: string;
  text: string;
  at: string;
  replies: CommentReply[];
  resolved?: boolean;
  attachments?: string[];
  marks?: CommentMarks;
}

export interface CommentExtra {
  attachments?: string[];
  marks?: CommentMarks;
}

const hasContent = (text: string, x?: CommentExtra) => !!text.trim() || !!x?.attachments?.length || !!x?.marks?.paths.length;

export function addComment(doc: ProjectDoc, anchor: CommentAnchor, author: string, text: string, extra?: CommentExtra): ID | undefined {
  if (!hasContent(text, extra)) return undefined;
  const id = newId();
  (doc.comments ??= []).push({
    id,
    versionId: doc.activeVersionId,
    anchor,
    author: author.trim() || 'Anonyme',
    text: text.trim(),
    at: new Date().toISOString(),
    replies: [],
    ...(extra?.attachments?.length ? { attachments: extra.attachments } : {}),
    ...(extra?.marks?.paths.length ? { marks: extra.marks } : {}),
  });
  return id;
}

export function replyComment(doc: ProjectDoc, id: ID, author: string, text: string, attachments?: string[]): void {
  const c = doc.comments?.find((x) => x.id === id);
  if (!c || !hasContent(text, { attachments })) return;
  c.replies.push({ id: newId(), author: author.trim() || 'Anonyme', text: text.trim(), at: new Date().toISOString(), ...(doc.activeVersionId ? { versionId: doc.activeVersionId } : {}), ...(attachments?.length ? { attachments } : {}) });
}

/** Ajoute ou remplace les tracés d'un commentaire (l'auteur du commentaire les retouche). */
export function setCommentMarks(doc: ProjectDoc, id: ID, marks: CommentMarks | undefined): void {
  const c = doc.comments?.find((x) => x.id === id);
  if (!c) return;
  if (marks?.paths.length) c.marks = marks;
  else delete c.marks;
}

export function deleteComment(doc: ProjectDoc, id: ID): void {
  if (doc.comments) doc.comments = doc.comments.filter((c) => c.id !== id);
}

export function deleteReply(doc: ProjectDoc, id: ID, replyId: ID): void {
  const c = doc.comments?.find((x) => x.id === id);
  if (c) c.replies = c.replies.filter((r) => r.id !== replyId);
}

export function setResolved(doc: ProjectDoc, id: ID, resolved: boolean): void {
  const c = doc.comments?.find((x) => x.id === id);
  if (c) c.resolved = resolved || undefined;
}

/** Commentaires d'une version (la courante par défaut). Ceux d'avant les versions comptent pour la première. */
export function commentsOf(doc: ProjectDoc, versionId: ID | undefined = doc.activeVersionId): ReviewComment[] {
  const first = doc.versions?.[0]?.id;
  return (doc.comments ?? []).filter((c) => (c.versionId ?? first) === versionId || (!versionId && !c.versionId));
}

/** Un commentaire tel qu'il se lit dans la version courante : le sien, ou repris d'une version précédente. */
export interface ShownComment {
  c: ReviewComment;
  /** Endroit dans la version courante (retrouvé pour un commentaire repris). */
  anchor: CommentAnchor;
  /** Version d'origine, si le commentaire vient d'une version précédente. */
  from?: ID;
}

/** Passage d'une version précédente retrouvé dans le texte courant, par sa citation (au plus près de sa place). */
function carryScript(a: Extract<CommentAnchor, { kind: 'script' }>, oldLength: number, text: string): CommentAnchor | null {
  const quote = a.quote;
  if (!quote) return null;
  const expect = oldLength ? (a.start / oldLength) * text.length : 0;
  let best = -1;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) if (best < 0 || Math.abs(i - expect) < Math.abs(best - expect)) best = i;
  return best < 0 ? null : { kind: 'script', start: best, end: best + quote.length, quote };
}

/**
 * Commentaires visibles dans la version courante : les siens, puis ceux des versions précédentes encore
 * ouverts dont l'endroit existe toujours (même plan, même séquence, passage retrouvé) — de quoi montrer,
 * en V2, la réponse à ce que la V1 avait soulevé.
 */
export function shownComments(doc: ProjectDoc): ShownComment[] {
  const out: ShownComment[] = commentsOf(doc).map((c) => ({ c, anchor: c.anchor }));
  const list = doc.versions ?? [];
  const at = list.findIndex((v) => v.id === doc.activeVersionId);
  for (const v of list.slice(0, Math.max(0, at))) {
    for (const c of commentsOf(doc, v.id)) {
      if (c.resolved) continue;
      const a = c.anchor;
      const anchor =
        a.kind === 'script' ? carryScript(a, (v.slice?.scenario ?? '').length, doc.scenario ?? '') : a.kind === 'shot' ? (doc.shots[a.shotId] ? a : null) : doc.sequences[a.seqId] ? a : null;
      if (anchor) out.push({ c, anchor, from: v.id });
    }
  }
  return out;
}

/** Commentaires ouverts posés sur une cellule ou une séquence du découpage, dans la version courante. */
export function cutComments(doc: ProjectDoc): Map<string, ShownComment[]> {
  const out = new Map<string, ShownComment[]>();
  for (const s of shownComments(doc)) {
    if (s.c.resolved) continue;
    const a = s.anchor;
    const key = a.kind === 'shot' ? `${a.shotId}:${a.col ?? ''}` : a.kind === 'sequence' ? `seq:${a.seqId}` : '';
    if (key) out.set(key, [...(out.get(key) ?? []), s]);
  }
  return out;
}

/** Fichiers joints aux commentaires (pour ne jamais les perdre au ménage). */
export function commentAttachments(doc: ProjectDoc): string[] {
  return (doc.comments ?? []).flatMap((c) => [...(c.attachments ?? []), ...c.replies.flatMap((r) => r.attachments ?? [])]);
}

/** Les passages commentés suivent le texte quand il change (même règle que les passages liés). */
export function shiftCommentAnchors(doc: ProjectDoc, map: (p: number, side: 'start' | 'end') => number): void {
  for (const c of doc.comments ?? []) {
    if (c.anchor.kind !== 'script' || (c.versionId && c.versionId !== doc.activeVersionId && doc.versions?.length)) continue;
    const a = c.anchor;
    const empty = a.end <= a.start;
    a.start = map(a.start, 'start');
    a.end = empty ? a.start : Math.max(a.start, map(a.end, 'end'));
  }
}

/** Texte remplacé en entier (nouvelle version, import) : chaque passage commenté est retrouvé par sa citation. */
export function relinkComments(doc: ProjectDoc, before: string, after: string): void {
  for (const c of doc.comments ?? []) {
    if (c.anchor.kind !== 'script' || (c.versionId && c.versionId !== doc.activeVersionId && doc.versions?.length)) continue;
    const a = c.anchor;
    const quote = a.quote || before.slice(a.start, a.end);
    const expect = before.length ? (a.start / before.length) * after.length : 0;
    let best = -1;
    if (quote) for (let i = after.indexOf(quote); i >= 0; i = after.indexOf(quote, i + 1)) if (best < 0 || Math.abs(i - expect) < Math.abs(best - expect)) best = i;
    if (best >= 0) {
      a.start = best;
      a.end = best + quote.length;
    } else a.end = a.start = Math.min(Math.round(expect), after.length);
  }
}
