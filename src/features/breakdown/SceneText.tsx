import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { breakdownCategories, breakdownLabel, isCharacterCategory, type BreakdownCategory } from '../../domain/breakdown';
import { blocksFromSource, type BlockType } from '../../domain/screenplay';
import { categoryAbbr, cleanTag, marksWith, tagContext, type TagMark } from '../../domain/tagging';
import { fold } from '../../domain/text';
import type { EquipmentLine } from '../../domain/equipment';
import type { EquipmentCategory, ID, ProjectDoc } from '../../domain/types';
import s from './SceneText.module.css';

export interface Paragraph {
  key: string;
  type: BlockType;
  text: string;
}

/** Paragraphes d'un passage du scénario (mis en forme comme un scénario). */
export function paragraphsOf(source: string): Paragraph[] {
  return blocksFromSource(source)
    .blocks.filter((b) => b.type !== 'title' && b.type !== 'pagebreak')
    .map((b, i) => ({ key: `${i}-${b.type}`, type: b.type, text: b.text }));
}

interface Props {
  doc: ProjectDoc;
  seqId: ID;
  paragraphs: Paragraph[];
  /** Élément survolé dans la fiche : ses occurrences ressortent. */
  hot?: string | null;
  onTag: (cat: BreakdownCategory, item: string) => void;
  onUntag: (cat: BreakdownCategory, item: string) => void;
  /** Range un élément saisi dans une autre catégorie. */
  onMove?: (from: BreakdownCategory, to: BreakdownCategory, item: string) => void;
  readOnly?: boolean;
  /** Matériel du film déjà calculé (scénario entier : une fois pour toutes les séquences). */
  eq?: Record<EquipmentCategory, EquipmentLine[]>;
}

/** Repères de chaque paragraphe (le contexte de la séquence est calculé une fois). Lecture seule : sans suggestions. */
export function paragraphMarks(doc: ProjectDoc, seqId: ID, paragraphs: readonly Paragraph[], readOnly?: boolean, eq?: Record<EquipmentCategory, EquipmentLine[]>): TagMark[][] {
  const ctx = tagContext(doc, seqId, eq);
  return paragraphs.map((p) => {
    const ms = marksWith(ctx, p.text);
    return readOnly ? ms.filter((m) => !m.suggested) : ms;
  });
}

/** Grille d'un menu : les flèches passent d'une entrée à l'autre (deux colonnes), Début et Fin aux extrémités. */
function menuKeys(e: ReactKeyboardEvent<HTMLElement>, cols: number) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  const same = (a: number, b: number) => !!items[a] && !!items[b] && items[a].parentElement === items[b].parentElement;
  let next: number | undefined;
  if (i < 0 && e.key.startsWith('Arrow')) next = 0;
  else if (e.key === 'ArrowRight') next = i + 1;
  else if (e.key === 'ArrowLeft') next = i - 1;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    next = i + dir * cols;
    // Hors de la grille (« Retirer » au-dessus des catégories) : l'entrée voisine hors de ce bloc.
    if (!same(i, next)) {
      next = i + dir;
      while (same(i, next)) next += dir;
    }
  } else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next !== undefined && !items[next]) next = i;
  if (next === undefined) return;
  e.preventDefault();
  items[next]?.focus();
}

/**
 * Le texte de la séquence, actif : les éléments dépouillés y sont repérés ; une sélection ouvre le
 * choix de la catégorie ; une suggestion (soulignée) s'ajoute d'un clic.
 */
export function SceneText({ doc, seqId, paragraphs, hot, onTag, onUntag, onMove, readOnly, eq }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; mark: TagMark } | null>(null);
  const cats = breakdownCategories(doc);
  const marks = useMemo(() => paragraphMarks(doc, seqId, paragraphs, readOnly, eq), [doc, seqId, paragraphs, readOnly, eq]);
  const hotKey = hot ? fold(hot) : '';
  const open = !!picker || !!menu;

  // Le menu ouvert reçoit le focus (la sélection est déjà retenue dans picker.text).
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!picker && !menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-tag-pop]')) {
        setPicker(null);
        setMenu(null);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Le focus revient au texte s'il était dans le menu.
        if (pop.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true });
        setPicker(null);
        setMenu(null);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [picker, menu]);

  const at = (e: { clientX: number; clientY: number }) => {
    const box = root.current!.getBoundingClientRect();
    return { x: Math.min(e.clientX - box.left, box.width - 220), y: e.clientY - box.top + 14 };
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (readOnly) return;
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed && root.current?.contains(sel.anchorNode) ? cleanTag(sel.toString()) : '';
    if (!text || text.length > 80) return;
    setMenu(null);
    setPicker({ ...at(e), text });
  };

  const render = (text: string, ms: TagMark[]): ReactNode[] => {
    const out: ReactNode[] = [];
    let pos = 0;
    ms.forEach((m, i) => {
      if (m.start > pos) out.push(<Fragment key={`t${i}`}>{text.slice(pos, m.start)}</Fragment>);
      const isHot = !!hotKey && fold(m.item) === hotKey;
      // Déduit du découpage (plans, matériel) : se retire là où il est né, pas d'ici.
      const fixed = !m.suggested && m.derived;
      out.push(
        <mark
          key={`m${i}`}
          className={[m.suggested ? s.sugg : s.tag, fixed ? s.fixed : '', isHot ? s.hot : ''].join(' ')}
          title={m.suggested ? `Ajouter « ${m.item} » (${breakdownLabel(m.cat).toLowerCase()})` : fixed ? `${breakdownLabel(m.cat)} · ${m.item} · déduit du découpage` : `${breakdownLabel(m.cat)} · ${m.item}`}
          data-cat={categoryAbbr(m.cat)}
          onClick={(e) => {
            if (readOnly || fixed || window.getSelection()?.toString()) return;
            if (m.suggested) onTag(m.cat, m.item);
            else {
              setPicker(null);
              setMenu({ ...at(e), mark: m });
            }
          }}
          data-testid={m.suggested ? 'tag-suggestion' : 'tag-mark'}
        >
          {text.slice(m.start, m.end)}
        </mark>,
      );
      pos = m.end;
    });
    if (pos < text.length) out.push(<Fragment key="end">{text.slice(pos)}</Fragment>);
    return out;
  };

  const close = () => {
    setPicker(null);
    setMenu(null);
  };
  const others = menu && !isCharacterCategory(menu.mark.cat) && onMove ? cats.filter((c) => c !== menu.mark.cat && !isCharacterCategory(c)) : [];

  return (
    <div ref={root} className={s.text} onMouseUp={onMouseUp} tabIndex={-1} data-testid="scene-text">
      {paragraphs.length === 0 && <p className={s.empty}>Aucun texte pour cette séquence.</p>}
      {paragraphs.map((p, i) => (
        <p key={p.key} className={s[`t_${p.type}`] ?? ''}>
          {render(p.text, marks[i])}
        </p>
      ))}
      {picker && (
        <div ref={pop} className={s.pop} style={{ left: picker.x, top: picker.y }} data-tag-pop role="menu" aria-label={`Ajouter « ${picker.text} » au dépouillement`} onKeyDown={(e) => menuKeys(e, 2)}>
          <p className={s.popTitle}>{picker.text}</p>
          <div className={s.popGrid}>
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitem"
                onClick={() => {
                  onTag(c, picker.text);
                  setPicker(null);
                  window.getSelection()?.removeAllRanges();
                }}
                data-testid={`tag-as-${c}`}
              >
                {breakdownLabel(c)}
              </button>
            ))}
          </div>
        </div>
      )}
      {menu && (
        <div ref={pop} className={s.pop} style={{ left: menu.x, top: menu.y }} data-tag-pop role="menu" aria-label={menu.mark.item} onKeyDown={(e) => menuKeys(e, others.length ? 2 : 1)}>
          <p className={s.popTitle}>
            {menu.mark.item} <em>{breakdownLabel(menu.mark.cat).toLowerCase()}</em>
          </p>
          <button
            type="button"
            role="menuitem"
            className={s.popRemove}
            onClick={() => {
              onUntag(menu.mark.cat, menu.mark.item);
              close();
            }}
          >
            Retirer du dépouillement
          </button>
          {others.length > 0 && (
            <div className={[s.popGrid, s.popMove].join(' ')}>
              {others.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitem"
                  aria-label={`Ranger dans ${breakdownLabel(c)}`}
                  onClick={() => {
                    onMove?.(menu.mark.cat, c, menu.mark.item);
                    close();
                  }}
                  data-testid={`move-to-${c}`}
                >
                  {breakdownLabel(c)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
