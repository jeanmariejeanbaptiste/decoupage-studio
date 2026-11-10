import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import s from './Popover.module.css';

/**
 * Menu flottant du Séquencier, porté dans <body> sous son ancre : se ferme au clic dehors, à Échap
 * et au défilement de la page ; le focus va au premier élément, puis revient à l'ancre.
 */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  width,
  label,
  testId,
}: {
  anchor: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const w = width ?? 240;
    const left = Math.max(8, Math.min(align === 'end' ? a.right - w : a.left, window.innerWidth - w - 8));
    const below = window.innerHeight - a.bottom - 12;
    const above = a.top - 12;
    setPos(below >= 260 || below >= above ? { left, top: a.bottom + 4, maxHeight: below } : { left, bottom: window.innerHeight - a.top + 4, maxHeight: above });
  }, [anchor, align, width]);
  useEffect(() => {
    const el = ref.current;
    const back = anchor.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input, button'))?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
      back?.focus();
    };
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      close.current();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, pos === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pos) return null;
  return createPortal(
    <div ref={ref} className={s.pop} role="dialog" aria-label={label} style={{ ...pos, width }} data-testid={testId}>
      {children}
    </div>,
    document.body,
  );
}

/** Ligne de menu : ↑ / ↓ passent d'une ligne à l'autre dans le menu. */
export function menuKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...(e.currentTarget.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('[data-item]:not([disabled])') ?? [])];
  if (!all.length) return;
  e.preventDefault();
  const i = all.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'ArrowDown' ? all[(i + 1) % all.length] : all[(i <= 0 ? all.length : i) - 1];
  next.focus();
}
