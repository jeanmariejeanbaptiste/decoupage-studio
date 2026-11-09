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
}

export function addComment(doc: ProjectDoc, anchor: CommentAnchor, author: string, text: string): ID | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const id = newId();
  (doc.comments ??= []).push({ id, versionId: doc.activeVersionId, anchor, author: author.trim() || 'Anonyme', text: t, at: new Date().toISOString(), replies: [] });
  return id;
}

export function replyComment(doc: ProjectDoc, id: ID, author: string, text: string): void {
  const c = doc.comments?.find((x) => x.id === id);
  if (!c || !text.trim()) return;
  c.replies.push({ id: newId(), author: author.trim() || 'Anonyme', text: text.trim(), at: new Date().toISOString() });
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

/** Commentaires ouverts posés sur une cellule ou une séquence du découpage de la version courante. */
export function cutComments(doc: ProjectDoc): Map<string, ReviewComment[]> {
  const out = new Map<string, ReviewComment[]>();
  for (const c of commentsOf(doc)) {
    if (c.resolved) continue;
    const key = c.anchor.kind === 'shot' ? `${c.anchor.shotId}:${c.anchor.col ?? ''}` : c.anchor.kind === 'sequence' ? `seq:${c.anchor.seqId}` : '';
    if (key) out.set(key, [...(out.get(key) ?? []), c]);
  }
  return out;
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
