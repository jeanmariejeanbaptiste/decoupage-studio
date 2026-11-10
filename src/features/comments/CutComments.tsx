import { useEffect, useRef, type ReactNode } from 'react';
import { cutComments, type CommentAnchor } from '../../domain/comments';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { useShare } from '../../store/share';
import { MarkLayer } from './MarkLayer';
import { clearFocus, openComment, sameAnchor, useCommentsUi } from './commentsUi';

/** Endroit du découpage sous un élément de l'aperçu : la séquence, ou la cellule d'un plan. */
function anchorAt(el: Element | null): { anchor: CommentAnchor; cell: HTMLElement } | null {
  const cell = el?.closest<HTMLElement>('td[data-col]');
  if (!cell) return null;
  const col = cell.dataset.col as ColumnKey;
  if (col === 'sequence') {
    const seqId = cell.closest<HTMLElement>('tbody[data-seq]')?.dataset.seq;
    return seqId ? { anchor: { kind: 'sequence', seqId }, cell } : null;
  }
  const shotId = cell.closest<HTMLElement>('tr[data-shot]')?.dataset.shot;
  return shotId ? { anchor: { kind: 'shot', shotId, col }, cell } : null;
}

function cellOf(root: HTMLElement, a: CommentAnchor): HTMLElement | null {
  if (a.kind === 'sequence') return root.querySelector<HTMLElement>(`tbody[data-seq="${CSS.escape(a.seqId)}"] td[data-col="sequence"]`);
  if (a.kind === 'shot') return root.querySelector<HTMLElement>(`tr[data-shot="${CSS.escape(a.shotId)}"] td[data-col="${a.col ?? 'number'}"]`);
  return null;
}

/**
 * Relecture de l'aperçu du découpage : les cellules commentées portent une marque ; un clic sur l'une
 * d'elles ouvre sa bulle (lire, répondre). Un relecteur invité commente aussi une cellule d'un clic ;
 * pour l'auteur, l'aperçu reste un aperçu. Les tracés des commentaires s'y superposent.
 */
export function CutComments({ doc, children }: { doc: ProjectDoc; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  // Seul un relecteur invité ouvre un commentaire d'un clic ; l'auteur lit et répond aux cellules déjà commentées.
  const canStart = useShare((x) => x.role === 'guest' && x.mode !== 'read');
  const focus = useCommentsUi((u) => u.focus);
  const marks = cutComments(doc);

  // Marques posées sur les cellules (l'aperçu n'a pas à les connaître) ; reposées quand l'aperçu se
  // repagine et recrée ses cellules.
  const marksRef = useRef(marks);
  marksRef.current = marks;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = () => {
      el.querySelectorAll('[data-commented]').forEach((n) => {
        n.removeAttribute('data-commented');
        n.removeAttribute('title');
      });
      for (const list of marksRef.current.values()) {
        const cell = cellOf(el, list[0].anchor);
        if (!cell) continue;
        cell.setAttribute('data-commented', String(list.length));
        cell.setAttribute('title', `${list.length} commentaire${list.length > 1 ? 's' : ''}`);
      }
    };
    apply();
    let frame = 0;
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    obs.observe(el, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  // « Voir » depuis la fenêtre des commentaires : la cellule s'affiche, sa bulle s'ouvre.
  useEffect(() => {
    if (!focus || focus.kind === 'script') return;
    const t = setTimeout(() => {
      const cell = root.current && cellOf(root.current, focus);
      clearFocus();
      if (!cell) return;
      cell.scrollIntoView({ block: 'center' });
      const r = cell.getBoundingClientRect();
      openComment(focus, r.left, r.bottom);
    }, 150);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div
      ref={root}
      style={{ position: 'relative' }}
      data-comment-trigger
      onClick={(e) => {
        const hit = anchorAt(e.target as Element);
        if (!hit) return;
        const commented = [...marks.values()].some((l) => sameAnchor(l[0].anchor, hit.anchor));
        if (!commented && !canStart) return;
        if (useCommentsUi.getState().drawing) return;
        const r = hit.cell.getBoundingClientRect();
        openComment(hit.anchor, r.left, r.bottom);
      }}
    >
      {children}
      <MarkLayer surface="cut" />
    </div>
  );
}
