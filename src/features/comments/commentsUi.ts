import { create } from 'zustand';
import type { CommentAnchor } from '../../domain/comments';
import type { ID } from '../../domain/types';
import { useCloud } from '../../store/cloud';
import { useProjectStore } from '../../store/projectStore';
import { useShare } from '../../store/share';

interface CommentsUi {
  /** Bulle ouverte : l'endroit commenté et sa position à l'écran. */
  popover: { anchor: CommentAnchor; x: number; y: number } | null;
  /** Fenêtre des commentaires d'une version (sa version), fermée si absent. */
  panel: ID | '' | null;
  /** Endroit à montrer (après « Voir ») : la page concernée l'affiche et ouvre sa bulle. */
  focus: CommentAnchor | null;
}

export const useCommentsUi = create<CommentsUi>(() => ({ popover: null, panel: null, focus: null }));
export const focusComment = (anchor: CommentAnchor) => useCommentsUi.setState({ focus: anchor, panel: null, popover: null });
export const clearFocus = () => useCommentsUi.setState({ focus: null });

export const openComment = (anchor: CommentAnchor, x: number, y: number) => useCommentsUi.setState({ popover: { anchor, x, y } });
export const closeComment = () => useCommentsUi.setState({ popover: null });
export const openCommentsPanel = (versionId: ID | '') => useCommentsUi.setState({ panel: versionId, popover: null });
export const closeCommentsPanel = () => useCommentsUi.setState({ panel: null });

/** Nom de l'auteur : le prénom donné en rejoignant un partage, sinon le compte Google, sinon la réalisation. */
export function authorName(): string {
  if (useShare.getState().role === 'guest') {
    try {
      const n = localStorage.getItem('ds-guest-name');
      if (n?.trim()) return n.trim();
    } catch {
      /* stockage indisponible */
    }
    return 'Invité';
  }
  const u = useCloud.getState().user;
  return u?.name || useProjectStore.getState().doc?.project.director || 'Moi';
}

/** Deux endroits commentés sont-ils le même ? (un passage : s'ils se chevauchent) */
export function sameAnchor(a: CommentAnchor, b: CommentAnchor): boolean {
  if (a.kind === 'script' && b.kind === 'script') return a.start < Math.max(b.end, b.start + 1) && b.start < Math.max(a.end, a.start + 1);
  if (a.kind === 'shot' && b.kind === 'shot') return a.shotId === b.shotId && (a.col ?? '') === (b.col ?? '');
  if (a.kind === 'sequence' && b.kind === 'sequence') return a.seqId === b.seqId;
  return false;
}
