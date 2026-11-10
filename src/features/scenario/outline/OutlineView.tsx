import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { outlineMeasures, outlineOf, plotsOf, type OutlineSequence } from '../../../domain/outline';
import type { ProjectDoc } from '../../../domain/types';
import { mutateDoc } from '../../../store/projectStore';
import { useReadOnly } from '../../../store/share';
import { isShortcut } from '../../../store/shortcuts';
import { useIsMobile } from '../../../ui/useIsMobile';
import { useRevisionMarks } from '../../versions/useRevisionMarks';
import { useCommitDraft } from '../ResearchPanels';
import { moveStep, writeSequence } from './outlineActions';
import { plotKeys } from './outlineModel';
import { setActive, setEditing, setInsertAfter, useOutlineUi } from './outlineUi';
import { OutlineList, type RowContext } from './OutlineList';
import { OutlineWeave } from './OutlineWeave';
import { QuickAdd } from './QuickAdd';
import { focusRow } from './RowParts';
import s from './OutlineView.module.css';

type Research = NonNullable<ProjectDoc['research']>;

/** Champ du film (logline, synopsis) : sans cadre, hauteur à la mesure du texte, validé en quittant le champ. */
function FilmField({ field, label, className, value, readOnly }: { field: 'logline' | 'synopsis'; label: string; className: string; value: string; readOnly: boolean }) {
  const [draft, setDraft, commit] = useCommitDraft(value, (v) => mutateDoc((d) => void Object.assign((d.research ??= {}) as Research, { [field]: v.trim() || undefined })), readOnly);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  if (readOnly && !value.trim()) return null;
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={draft}
      readOnly={readOnly}
      placeholder={readOnly ? '' : label}
      aria-label={label}
      onChange={(e) => setDraft(field === 'logline' ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (field === 'logline' && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      data-testid={`outline-${field}`}
    />
  );
}

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.closest('input, textarea, select, [contenteditable="true"]') !== null || t.closest('[role="dialog"]') !== null);

/**
 * Séquencier : la logline et le synopsis du film, l'ajout rapide, puis les séquences du texte (Liste)
 * ou leur tissage par intrigue. Chaque ligne porte `data-outline-n` : la page s'en sert pour `?seq=N`.
 */
export function OutlineView({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const phone = useIsMobile();
  const chosen = useOutlineUi((u) => (phone ? 'list' : u.mode));
  const hidden = useOutlineUi((u) => u.hidden);
  const items = useMemo(() => outlineOf(doc.scenario ?? ''), [doc.scenario]);
  const seqs = useMemo(() => items.filter((x): x is OutlineSequence => x.kind === 'sequence'), [items]);
  const measures = outlineMeasures(doc);
  const marks = useRevisionMarks(doc);
  const declared = plotsOf(doc);
  const keys = useMemo(() => plotKeys(declared, seqs), [declared, seqs]);
  const plots = useMemo(() => keys.map((k) => declared.find((p) => p.key === k) ?? { key: k, name: `Intrigue ${k}` }), [keys, declared]);
  const many = plots.length > 1;
  // Séquencier vide : l'en-tête du film et l'ajout rapide, quelle que soit la vue.
  const mode = seqs.length ? chosen : 'list';
  const markFrom = marks ? doc.versions?.find((v) => v.id === doc.versions?.find((x) => x.id === doc.activeVersionId)?.from)?.name : undefined;
  const ctx: RowContext = {
    doc,
    readOnly,
    plots,
    plotShown: (p) => many || p !== plots[0]?.key,
    dimmed: (p) => hidden.includes(p),
    measures,
    marks,
    markFrom,
    count: seqs.length,
  };

  // Projet ouvert ou changé : rien d'actif, aucune édition en cours ; `?seq=N` rend la ligne N active.
  useEffect(() => {
    const seq = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seq'));
    useOutlineUi.setState({ active: seq > 0 ? seq : null, editing: null, insertAfter: null });
  }, [doc.project.id]);
  // Ligne active disparue (annulation, suppression) : la dernière.
  const active = useOutlineUi((u) => u.active);
  useEffect(() => {
    if (active !== null && active > seqs.length) setActive(seqs.length || null);
  }, [active, seqs.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isField(e.target) || !seqs.length) return;
    const cur = useOutlineUi.getState().active;
    const go = (n: number) => {
      e.preventDefault();
      const to = Math.max(1, Math.min(seqs.length, n));
      setActive(to);
      focusRow(to);
    };
    const plain = !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
    if (plain && e.key === 'ArrowDown') return go(cur === null ? 1 : cur + 1);
    if (plain && e.key === 'ArrowUp') return go(cur === null ? 1 : cur - 1);
    if (cur === null) return;
    if (isShortcut(e, 'outlineWrite')) {
      e.preventDefault();
      return writeSequence(cur);
    }
    if (readOnly) return;
    const up = isShortcut(e, 'outlineMoveUp');
    if (up || isShortcut(e, 'outlineMoveDown')) {
      e.preventDefault();
      moveStep(cur, up ? -1 : 1);
      return focusRow(useOutlineUi.getState().active ?? cur);
    }
    if (isShortcut(e, 'outlineInsert')) {
      e.preventDefault();
      return setInsertAfter(cur);
    }
    if (plain && e.key === 'Enter' && mode === 'list') {
      e.preventDefault();
      return setEditing({ n: cur, field: 'phrase' });
    }
    if (plain && e.key === 'Escape') setActive(null);
  };

  const r = doc.research ?? {};
  return (
    <div className={[s.view, mode === 'plots' ? s.wide : ''].join(' ')} data-testid="outline-view" onKeyDown={onKeyDown}>
      {mode === 'list' && (
        <>
          <header className={s.film}>
            <FilmField field="logline" label="Logline" className={s.logline} value={r.logline ?? ''} readOnly={readOnly} />
            <FilmField field="synopsis" label="Synopsis" className={s.synopsis} value={r.synopsis ?? ''} readOnly={readOnly} />
          </header>
          {!readOnly && <QuickAdd key={doc.project.id} doc={doc} after="end" autoFocus={!seqs.length} stacked={phone} />}
          {items.length > 0 && <OutlineList items={items} ctx={ctx} />}
        </>
      )}
      {mode === 'plots' && (
        <OutlineWeave
          items={items}
          ctx={ctx}
          keys={keys.filter((k) => !hidden.includes(k))}
        />
      )}
    </div>
  );
}
