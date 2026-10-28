import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Animation « FLIP » : quand des éléments changent de place d'un rendu à l'autre (glisser-déposer),
 * ils glissent de leur ancienne position vers la nouvelle au lieu de sauter.
 */
export function useFlip(root: RefObject<HTMLElement>, selector: string, keyAttr: string, active: boolean) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const next = new Map<string, number>();
    for (const n of el.querySelectorAll<HTMLElement>(selector)) {
      const key = n.getAttribute(keyAttr);
      if (!key) continue;
      const top = n.getBoundingClientRect().top;
      next.set(key, top);
      const prev = last.current.get(key);
      if (active && prev !== undefined && Math.abs(prev - top) > 1) {
        n.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    last.current = next;
  });
}
