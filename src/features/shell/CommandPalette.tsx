import { formatCombo } from '../../domain/shortcuts';
import { useShortcuts } from '../../store/shortcuts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fold } from '../../domain/text';
import { useUi } from '../../store/uiStore';
import { navigate, useLocation } from '../../app/router';
import { listProjects } from '../../store/db';
import { openStoredProject } from '../../store/persistence';
import { availableCommands, orderCommands, projectCommands } from './commands';
import { useReturnFocus } from './useReturnFocus';
import s from './CommandPalette.module.css';

/** Palette de commandes (⌘K). */
export function CommandPalette() {
  const open = useUi((u) => u.paletteOpen);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const map = useShortcuts((x) => x.map);
  const set = useUi((u) => u.set);
  const { route } = useLocation();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const listRef = useRef<HTMLUListElement>(null);
  // Fermée sans commande (Échap, clic à côté) : le focus revient où il était (la grille, un champ…).
  const keepFocus = useReturnFocus();

  useEffect(() => {
    let live = true;
    void listProjects()
      .then((all) => live && setProjects(all))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(() => {
    const f = fold(q);
    const all = [
      ...availableCommands(),
      ...projectCommands(projects, (id) => void openStoredProject(id).then((ok) => ok && navigate('grid'))),
    ];
    if (!f) return orderCommands(all, route);
    return all.filter((c) => f.split(' ').every((w) => fold(`${c.group} ${c.label}`).includes(w)));
  }, [q, projects, route]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => set({ paletteOpen: false });
  const run = (i: number) => {
    const c = items[i];
    if (!c) return;
    keepFocus.current = false;
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
          aria-activedescendant={items.length ? `cmd-${active}` : undefined}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Home' || e.key === 'End') {
              // Sans recherche, Début et Fin parcourent la liste ; sinon ils restent au texte.
              if (q) return;
              e.preventDefault();
              setActive(e.key === 'Home' ? 0 : Math.max(0, items.length - 1));
            } else if (e.key === 'Tab') {
              // Le focus reste dans la palette.
              e.preventDefault();
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
              {c.shortcut && <kbd>{formatCombo(map[c.shortcut])}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
