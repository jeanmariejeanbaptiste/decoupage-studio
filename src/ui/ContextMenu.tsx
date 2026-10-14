import { useEffect, useRef } from 'react';
import { useUi } from '../store/uiStore';
import s from './ContextMenu.module.css';

/** Menu contextuel unique (clic droit). */
export function ContextMenuHost() {
  const menu = useUi((u) => u.menu);
  const set = useUi((u) => u.set);
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector('button')?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return;
      set({ menu: null });
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu, set]);
  if (!menu) return null;
  return (
    <ul ref={ref} className={s.menu} role="menu" style={{ left: menu.x, top: menu.y }}>
      {menu.items.map((it) => (
        <li key={it.label} role="none">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              set({ menu: null });
              it.action();
            }}
          >
            {it.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
