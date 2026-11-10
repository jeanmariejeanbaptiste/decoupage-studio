import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ID } from '../../../domain/types';

/** Appui long sur la poignée avant que la rangée se soulève ; au-delà de ce glissement, on défile. */
const HOLD_MS = 280;
const SLOP = 8;

export interface RowDrag {
  id: ID;
  /** Place visée : séquence et rang parmi les plans qui y restent. */
  seqId: ID;
  at: number;
  /** Haut de la rangée soulevée, à l'écran. */
  top: number;
}

interface Pending {
  id: ID;
  seqId: ID;
  index: number;
  x: number;
  y: number;
  /** Écart entre le doigt et le haut de la rangée. */
  grab: number;
  timer: number;
}

/**
 * Réorganiser la vue d'ensemble : appui long sur la poignée à six points, la rangée se soulève et
 * suit le doigt ; un creux montre où elle tombera, dans sa séquence ou dans une autre (même vide).
 * Les cibles sont lues dans la page : en-têtes `[data-drop-seq]` et rangées `[data-drop-shot]`.
 * Glisser avant la fin de l'appui fait défiler la liste comme d'habitude.
 */
export function useRowDrag(root: RefObject<HTMLElement>, onDrop: (id: ID, seqId: ID, at: number) => void) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const pending = useRef<Pending | null>(null);
  const live = useRef<{ origin: { seqId: ID; at: number }; grab: number; y: number } | null>(null);
  const dragRef = useRef<RowDrag | null>(null);
  dragRef.current = drag;
  const frame = useRef(0);

  const targetAt = useCallback(
    (y: number): { seqId: ID; at: number } | null => {
      const els = root.current?.querySelectorAll<HTMLElement>('[data-drop-seq], [data-drop-shot]');
      if (!els?.length) return null;
      let seq: ID | null = null;
      let count = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const head = el.dataset.dropSeq;
        if (head) {
          if (y < mid) return { seqId: seq ?? head, at: seq ? count : 0 };
          seq = head;
          count = 0;
        } else {
          if (y < mid && seq) return { seqId: seq, at: count };
          count++;
        }
      }
      return seq ? { seqId: seq, at: count } : null;
    },
    [root],
  );

  const move = useCallback(
    (clientY: number) => {
      const l = live.current;
      if (!l) return;
      l.y = clientY;
      const top = clientY - l.grab;
      const t = targetAt(top + 23);
      setDrag((d) => (d ? { ...d, top, ...(t ?? {}) } : d));
    },
    [targetAt],
  );

  // Bord de l'écran : la liste défile d'elle-même pendant qu'on tient la rangée.
  const autoScroll = useCallback(() => {
    const l = live.current;
    if (!l) return;
    const scroller = (root.current?.closest('main') as HTMLElement | null) ?? document.scrollingElement;
    const h = window.innerHeight;
    const v = l.y < 120 ? -Math.ceil((120 - l.y) / 10) : l.y > h - 120 ? Math.ceil((l.y - (h - 120)) / 10) : 0;
    if (v && scroller) {
      scroller.scrollTop += v;
      move(l.y);
    }
    frame.current = requestAnimationFrame(autoScroll);
  }, [move, root]);

  const start = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    live.current = { origin: { seqId: p.seqId, at: p.index }, grab: p.grab, y: p.y };
    navigator.vibrate?.(8);
    setDrag({ id: p.id, seqId: p.seqId, at: p.index, top: p.y - p.grab });
    frame.current = requestAnimationFrame(autoScroll);
  }, [autoScroll]);

  const end = useCallback(
    (commit: boolean) => {
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = null;
      cancelAnimationFrame(frame.current);
      const d = dragRef.current;
      const l = live.current;
      live.current = null;
      setDrag(null);
      if (commit && d && l && (d.seqId !== l.origin.seqId || d.at !== l.origin.at)) onDrop(d.id, d.seqId, d.at);
    },
    [onDrop],
  );

  useEffect(() => {
    const pointMove = (x: number, y: number, e: Event) => {
      const p = pending.current;
      if (p) {
        if (Math.hypot(x - p.x, y - p.y) > SLOP) end(false);
        return;
      }
      if (!live.current) return;
      if (e.cancelable) e.preventDefault();
      move(y);
    };
    const touchMove = (e: TouchEvent) => pointMove(e.touches[0].clientX, e.touches[0].clientY, e);
    const mouseMove = (e: PointerEvent) => e.pointerType === 'mouse' && pointMove(e.clientX, e.clientY, e);
    const up = () => (pending.current || live.current) && end(!!live.current);
    const cancel = () => end(false);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', cancel);
    window.addEventListener('pointermove', mouseMove);
    const mouseUp = (e: PointerEvent) => e.pointerType === 'mouse' && up();
    window.addEventListener('pointerup', mouseUp);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && live.current && end(false);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', cancel);
      window.removeEventListener('pointermove', mouseMove);
      window.removeEventListener('pointerup', mouseUp);
      window.removeEventListener('keydown', key);
      cancelAnimationFrame(frame.current);
    };
  }, [end, move]);

  /** Poignée d'une rangée : appui long au doigt ou à la souris. */
  const grip = (id: ID, seqId: ID, index: number) => {
    const begin = (x: number, y: number, el: HTMLElement) => {
      if (pending.current || live.current) return;
      const row = el.closest<HTMLElement>('[data-drop-shot]');
      const grab = row ? y - row.getBoundingClientRect().top : 18;
      pending.current = { id, seqId, index, x, y, grab, timer: window.setTimeout(start, HOLD_MS) };
    };
    return {
      onTouchStart: (e: React.TouchEvent<HTMLElement>) => begin(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget),
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => e.pointerType === 'mouse' && begin(e.clientX, e.clientY, e.currentTarget),
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  };

  return { drag, grip };
}
