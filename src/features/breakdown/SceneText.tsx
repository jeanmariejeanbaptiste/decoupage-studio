import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { breakdownCategories, breakdownLabel, type BreakdownCategory } from '../../domain/breakdown';
import { isOutlinePhrase } from '../../domain/outline';
import { blocksFromSource, type BlockType } from '../../domain/screenplay';
import { categoryAbbr, cleanTag, marksIn, type TagMark } from '../../domain/tagging';
import type { ID, ProjectDoc } from '../../domain/types';
import s from './SceneText.module.css';

export interface Paragraph {
  key: string;
  type: BlockType;
  text: string;
}

/**
 * Paragraphes d'un passage du scénario (mis en forme comme un scénario). La phrase du séquencier
 * n'en fait pas partie : elle n'est pas étiquetable (le dépouillement l'affiche en résumé).
 */
export function paragraphsOf(source: string): Paragraph[] {
  const { blocks } = blocksFromSource(source);
  return blocks.flatMap((b, i) => (b.type === 'title' || b.type === 'pagebreak' || isOutlinePhrase(blocks, i) ? [] : [{ key: `${i}-${b.type}`, type: b.type, text: b.text }]));
}

/** Phrase du séquencier d'un passage qui commence à son en-tête. */
export function phraseOf(source: string): string | undefined {
  const { blocks } = blocksFromSource(source);
  return blocks.find((_b, i) => isOutlinePhrase(blocks, i))?.text.trim() || undefined;
}

interface Props {
  doc: ProjectDoc;
  seqId: ID;
  paragraphs: Paragraph[];
  /** Élément survolé dans la fiche : ses occurrences ressortent. */
  hot?: string | null;
  onTag: (cat: BreakdownCategory, item: string) => void;
  onUntag: (cat: BreakdownCategory, item: string) => void;
  readOnly?: boolean;
}

/**
 * Le texte de la séquence, actif : les éléments dépouillés y sont repérés ; une sélection ouvre le
 * choix de la catégorie ; une suggestion (soulignée) s'ajoute d'un clic.
 */
export function SceneText({ doc, seqId, paragraphs, hot, onTag, onUntag, readOnly }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; mark: TagMark } | null>(null);
  const cats = breakdownCategories(doc);
  const marks = useMemo(() => paragraphs.map((p) => marksIn(doc, seqId, p.text)), [doc, seqId, paragraphs]);
  const hotKey = hot?.toLocaleLowerCase('fr');

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
      const isHot = !!hotKey && m.item.toLocaleLowerCase('fr') === hotKey;
      out.push(
        <mark
          key={`m${i}`}
          className={[m.suggested ? s.sugg : s.tag, isHot ? s.hot : ''].join(' ')}
          title={m.suggested ? `Ajouter « ${m.item} » (${breakdownLabel(m.cat).toLowerCase()})` : `${breakdownLabel(m.cat)} · ${m.item}`}
          data-cat={categoryAbbr(m.cat)}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            if (readOnly || window.getSelection()?.toString()) return;
            if (m.suggested) onTag(m.cat, m.item);
            else setMenu({ ...at(e), mark: m });
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

  return (
    <div ref={root} className={s.text} onMouseUp={onMouseUp} data-testid="scene-text">
      {paragraphs.length === 0 && <p className={s.empty}>Aucun texte pour cette séquence.</p>}
      {paragraphs.map((p, i) => (
        <p key={p.key} className={s[`t_${p.type}`] ?? ''}>
          {render(p.text, marks[i])}
        </p>
      ))}
      {picker && (
        <div className={s.pop} style={{ left: picker.x, top: picker.y }} data-tag-pop role="menu" aria-label={`Ajouter « ${picker.text} » au dépouillement`}>
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
        <div className={s.pop} style={{ left: menu.x, top: menu.y }} data-tag-pop role="menu">
          <p className={s.popTitle}>
            {menu.mark.item} <em>{breakdownLabel(menu.mark.cat).toLowerCase()}</em>
          </p>
          <button
            type="button"
            role="menuitem"
            className={s.popRemove}
            onClick={() => {
              onUntag(menu.mark.cat, menu.mark.item);
              setMenu(null);
            }}
          >
            Retirer du dépouillement
          </button>
        </div>
      )}
    </div>
  );
}
