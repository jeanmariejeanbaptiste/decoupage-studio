import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import s from './SuggestList.module.css';

export interface Suggestion {
  label: string;
  hint?: string;
  /** Valeur insérée (par défaut : `label`). */
  value?: string;
}

interface Props {
  anchor: RefObject<HTMLElement>;
  items: readonly Suggestion[];
  active: number;
  onPick: (item: Suggestion) => void;
  onHover: (i: number) => void;
  id: string;
}

/** Popover de suggestions positionné sous l'élément d'ancrage (porté dans <body>). */
export function SuggestList({ anchor, items, active, onPick, onHover, id }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const update = () => setRect(anchor.current?.getBoundingClientRect() ?? null);
    update();
    // L'ancre est parfois rattachée après ce composant (liste placée dans l'élément d'ancrage) : nouvelle mesure à l'image suivante.
    const raf = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
    // Mesure aussi quand la liste s'ouvre : au montage, le champ d'ancrage n'existe pas toujours encore.
  }, [anchor, items.length > 0]);
  if (!rect || items.length === 0) return null;
  const below = window.innerHeight - rect.bottom > 220;
  const style = {
    left: Math.min(rect.left, window.innerWidth - 260),
    minWidth: Math.max(rect.width, 180),
    ...(below ? { top: rect.bottom + 2 } : { bottom: window.innerHeight - rect.top + 2 }),
  };
  return createPortal(
    <ul className={s.list} style={style} role="listbox" id={id} data-testid="suggestions">
      {items.map((item, i) => (
        <li
          key={`${item.label}-${i}`}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          className={i === active ? s.active : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span>{item.label}</span>
          {item.hint && <em>{item.hint}</em>}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
