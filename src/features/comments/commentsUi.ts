import { create } from 'zustand';
import type { CommentAnchor, CommentMarks } from '../../domain/comments';
import type { ID } from '../../domain/types';
import { useCloud } from '../../store/cloud';
import { useProjectStore } from '../../store/projectStore';
import { reviewerName } from '../../store/review';
import { useShare } from '../../store/share';

interface CommentsUi {
  /** Bulle ouverte : l'endroit commenté et sa position à l'écran. */
  popover: { anchor: CommentAnchor; x: number; y: number } | null;
  /** Fenêtre des commentaires d'une version (sa version), fermée si absent. */
  panel: ID | '' | null;
  /** Endroit à montrer (après « Voir ») : la page concernée l'affiche et ouvre sa bulle. */
  focus: CommentAnchor | null;
  /** Commentaire en cours d'écriture : texte, schémas et images joints, tracés sur la page. */
  draft: { text: string; attachments: string[]; marks?: CommentMarks };
  /** Tracé sur la page en cours (la bulle s'efface le temps de dessiner). */
  drawing: CommentMarks['surface'] | null;
  /** Planche à dessin ouverte : pour le commentaire en cours, ou pour une réponse. */
  sketch: { target: 'draft' } | { target: 'reply'; id: ID; onDone: (key: string) => void } | null;
}

const EMPTY_DRAFT = { text: '', attachments: [] as string[] };
export const useCommentsUi = create<CommentsUi>(() => ({ popover: null, panel: null, focus: null, draft: EMPTY_DRAFT, drawing: null, sketch: null }));
export const resetDraft = () => useCommentsUi.setState({ draft: EMPTY_DRAFT, drawing: null });
export const patchDraft = (p: Partial<CommentsUi['draft']>) => useCommentsUi.setState((s) => ({ draft: { ...s.draft, ...p } }));
export const focusComment = (anchor: CommentAnchor) => useCommentsUi.setState({ focus: anchor, panel: null, popover: null });
export const clearFocus = () => useCommentsUi.setState({ focus: null });

export const openComment = (anchor: CommentAnchor, x: number, y: number) => useCommentsUi.setState({ popover: { anchor, x, y }, draft: EMPTY_DRAFT, drawing: null });
export const closeComment = () => useCommentsUi.setState({ popover: null, drawing: null });
export const openCommentsPanel = (versionId: ID | '') => useCommentsUi.setState({ panel: versionId, popover: null });
export const closeCommentsPanel = () => useCommentsUi.setState({ panel: null });

/**
 * Nom de l'auteur : le prénom donné en rejoignant un partage (relecture en ligne : celui du compte
 * Google, qui signe le commentaire), sinon le compte Google, sinon le réalisateur, sinon « Réalisation »
 * (lu tel quel par les invités : jamais « Moi »).
 */
export function authorName(): string {
  if (useShare.getState().role === 'guest' && useShare.getState().via === 'drive') return reviewerName();
  if (useShare.getState().role === 'guest') {
    // Nom sous lequel l'hôte l'a accueilli (« Nina 2 » si une autre Nina était déjà là).
    const self = useShare.getState().selfName?.trim();
    if (self) return self;
    try {
      const n = localStorage.getItem('ds-guest-name');
      if (n?.trim()) return n.trim();
    } catch {
      /* stockage indisponible */
    }
    return 'Invité';
  }
  const u = useCloud.getState().user;
  return u?.name || useProjectStore.getState().doc?.project.director || 'Réalisation';
}

/** Deux endroits commentés sont-ils le même ? (un passage : s'ils se chevauchent) */
export function sameAnchor(a: CommentAnchor, b: CommentAnchor): boolean {
  if (a.kind === 'script' && b.kind === 'script') return a.start < Math.max(b.end, b.start + 1) && b.start < Math.max(a.end, a.start + 1);
  if (a.kind === 'shot' && b.kind === 'shot') return a.shotId === b.shotId && (a.col ?? '') === (b.col ?? '');
  if (a.kind === 'sequence' && b.kind === 'sequence') return a.seqId === b.seqId;
  return false;
}
