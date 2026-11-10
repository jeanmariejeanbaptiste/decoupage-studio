import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { outlineMeasures, outlineOf, type OutlineSequence } from '../../../domain/outline';
import type { ProjectDoc } from '../../../domain/types';
import { useReadOnly } from '../../../store/share';
import { isShortcut } from '../../../store/shortcuts';
import { useIsMobile } from '../../../ui/useIsMobile';
import { useRevisionMarks } from '../../versions/useRevisionMarks';
import { moveStep, writeSequence } from './outlineActions';
import { setActive, setEditing, setInsertAfter, useOutlineUi } from './outlineUi';
import { OutlineList, type RowContext } from './OutlineList';
import { QuickAdd } from './QuickAdd';
import { focusRow } from './RowParts';
import s from './OutlineView.module.css';

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.closest('input, textarea, select, [contenteditable="true"]') !== null || t.closest('[role="dialog"]') !== null);

/**
 * Séquencier : l'ajout rapide, puis les séquences du texte, une ligne chacune. Chaque ligne porte `data-outline-n` : la page s'en sert pour `?seq=N`.
 */
export function OutlineView({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const [adding, setAdding] = useState(false);
  const phone = useIsMobile();
  const items = useMemo(() => outlineOf(doc.scenario ?? ''), [doc.scenario]);
  const seqs = useMemo(() => items.filter((x): x is OutlineSequence => x.kind === 'sequence'), [items]);
  const measures = outlineMeasures(doc);
  const marks = useRevisionMarks(doc);
  const markFrom = marks ? doc.versions?.find((v) => v.id === doc.versions?.find((x) => x.id === doc.activeVersionId)?.from)?.name : undefined;
  const ctx: RowContext = {
    doc,
    readOnly,
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
    if (plain && e.key === 'Enter') {
      e.preventDefault();
      return setEditing({ n: cur, field: 'phrase' });
    }
    if (plain && e.key === 'Escape') setActive(null);
  };

  return (
    <div className={s.view} data-testid="outline-view" onKeyDown={onKeyDown}>
      {/* Pas de barre d'ajout permanente : une séquence s'insère sous une ligne (menu, raccourci) ;
          séquencier vide, un seul « + Séquence » ouvre la saisie. */}
      {!readOnly &&
        (adding ? (
          // Ouverte, la saisie reste là pour enchaîner plusieurs séquences ; Échap la referme.
          <QuickAdd key={doc.project.id} doc={doc} after="end" autoFocus stacked={phone} onClose={() => setAdding(false)} />
        ) : (
          !seqs.length && (
            <button type="button" className={s.addFirst} onClick={() => setAdding(true)} data-testid="outline-add-first">
              <Plus size={15} strokeWidth={1.25} aria-hidden="true" />
              Séquence
            </button>
          )
        ))}
      {items.length > 0 && <OutlineList items={items} ctx={ctx} />}
    </div>
  );
}
