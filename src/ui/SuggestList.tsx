import { Fragment, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import s from './SuggestList.module.css';

export interface Suggestion {
  label: string;
  hint?: string;
  /** Valeur insérée (par défaut : `label`). */
  value?: string;
  /** Rubrique : un intitulé discret sépare les groupes successifs. */
  group?: string;
  /** Petit pictogramme devant le libellé. */
  icon?: ReactNode;
  /** Remplace le dernier jeton saisi au lieu de s'y ajouter (« Face » → « Face → Dos »). */
  replaceLast?: boolean;
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
  const hasItems = items.length > 0;
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
  }, [anchor, hasItems]);
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
        <Fragment key={`${item.label}-${i}`}>
          {item.group && item.group !== items[i - 1]?.group && (
            <li role="presentation" className={s.group}>
              {item.group}
            </li>
          )}
          <li
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={[i === active ? s.active : '', item.icon ? s.withIcon : ''].join(' ')}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover(i)}
          >
            {item.icon && <i className={s.icon}>{item.icon}</i>}
            <span>{item.label}</span>
            {item.hint && <em>{item.hint}</em>}
          </li>
        </Fragment>
      ))}
    </ul>,
    document.body,
  );
}
