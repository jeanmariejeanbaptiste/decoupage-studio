import { useEffect, useMemo, useRef, useState } from 'react';
import { fold } from '../../domain/text';
import { useUi } from '../../store/uiStore';
import { availableCommands } from './commands';
import s from './CommandPalette.module.css';

/** Palette de commandes (⌘K). */
export function CommandPalette() {
  const open = useUi((u) => u.paletteOpen);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const set = useUi((u) => u.set);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(() => {
    const f = fold(q);
    return availableCommands().filter((c) => !f || f.split(' ').every((w) => fold(`${c.group} ${c.label}`).includes(w)));
  }, [q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => set({ paletteOpen: false });
  const run = (i: number) => {
    const c = items[i];
    if (!c) return;
    close();
    c.run();
  };
  return (
    <div className={s.backdrop} onMouseDown={close}>
      <div className={s.palette} role="dialog" aria-modal="true" aria-label="Palette de commandes" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className={s.input}
          placeholder="Rechercher une commande…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={`cmd-${active}`}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(active);
            } else if (e.key === 'Escape') close();
          }}
        />
        <ul id="palette-list" ref={listRef} className={s.list} role="listbox">
          {items.length === 0 && <li className={s.none}>Aucune commande</li>}
          {items.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? s.active : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(i)}
            >
              <span className={s.group}>{c.group}</span>
              <span className={s.label}>{c.label}</span>
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
