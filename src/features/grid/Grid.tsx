import { useFlip } from '../../ui/useFlip';
import { useEvenRowSpans } from './useEvenRowSpans';
import { isShortcut } from '../../store/shortcuts';
import { BEAT_COLUMNS } from '../../domain/oneshot';
import { Fragment, useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { editableText, isEditable, parseTsv, toTsv } from '../../domain/cells';
import { COLUMN_DEFS } from '../../domain/columns';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { redo, undo } from '../../store/projectStore';
import { useUi, type CellPos } from '../../store/uiStore';
import {
  clearSelection,
  commitCell,
  deleteCurrentShots,
  duplicateCurrent,
  fillDown,
  moveCurrentSequence,
  moveCurrentShot,
  newSequenceAfter,
  newShotBelow,
  pasteMatrix, insertSequenceAt } from './actions';
import type { CommitMove } from './CellEditor';
import { cellSpan, moveCell, selectionRect, type GridModel } from './gridModel';
import { SeqAddRows, SequenceBody } from './SequenceBody';
import s from './Grid.module.css';

interface Props {
  doc: ProjectDoc;
  model: GridModel;
  /** Glissement en cours : les lignes glissent vers leur nouvelle place. */
  animate?: boolean;
}

const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function Grid({ doc, model, animate = false }: Props) {
  const selection = useUi((u) => u.selection);
  const editing = useUi((u) => u.editing);
  const setSelection = useUi((u) => u.setSelection);
  const setEditing = useUi((u) => u.setEditing);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  useEvenRowSpans(tableRef);
  useFlip(wrapRef, 'tr[data-shot]', 'data-shot', animate);
  const columns = model.columns;

  // Garde la sélection dans les bornes après suppression / changement de projet.
  useEffect(() => {
    if (!selection) {
      if (model.rows.length) setSelection({ row: 0, col: columns.includes('subject') ? 'subject' : columns[0] });
      return;
    }
    const max = model.rows.length - 1;
    const fix = (p: CellPos): CellPos => ({ row: Math.max(0, Math.min(p.row, max)), col: columns.includes(p.col) ? p.col : columns[0] });
    if (max < 0) setSelection(null);
    else if (selection.focus.row > max || selection.anchor.row > max || !columns.includes(selection.focus.col))
      setSelection(fix(selection.anchor), fix(selection.focus));
  }, [model.rows.length, columns, selection, setSelection]);

  const focusGrid = useCallback(() => wrapRef.current?.focus({ preventScroll: true }), []);

  // Safari n'envoie « copier » et « coller » à un élément non modifiable que si ces événements
  // préalables sont interceptés : ⌘C / ⌘V fonctionnent alors comme dans Chrome.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const allow = (e: Event) => {
      if (!useUi.getState().editing) e.preventDefault();
    };
    for (const t of ['beforecopy', 'beforepaste', 'beforecut']) el.addEventListener(t, allow);
    return () => {
      for (const t of ['beforecopy', 'beforepaste', 'beforecut']) el.removeEventListener(t, allow);
    };
  }, []);

  // Fait défiler la cellule active dans la vue.
  useEffect(() => {
    if (!selection) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${selection.focus.row}:${selection.focus.col}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selection]);

  const startEdit = (pos: CellPos, initial?: string) => {
    if (!isEditable(pos.col) || !model.rows[pos.row]) return;
    const sid = model.rows[pos.row].shotId;
    if (doc.shots[sid]?.oneShot && BEAT_COLUMNS.includes(pos.col)) {
      setSelection({ row: pos.row, col: pos.col });
      useUi.getState().set({ oneShotEditor: sid });
      return;
    }
    const anchor = { row: cellSpan(doc, model, pos.row, pos.col).start, col: pos.col };
    setSelection(anchor);
    setEditing({ pos: anchor, initial });
  };

  const onCommit = (text: string, move: CommitMove) => {
    const e = useUi.getState().editing;
    if (!e) return;
    const shotId = model.rows[e.pos.row]?.shotId;
    setEditing(null);
    if (shotId) commitCell(shotId, e.pos.col, text);
    if (move !== 'none') {
      // Le modèle courant suffit : les lignes ne changent pas lors d'une simple édition.
      const next = moveCell(doc, model, e.pos, move, true);
      setSelection(next);
    }
    if (move !== 'none') focusGrid();
  };

  const onCancel = () => {
    setEditing(null);
    focusGrid();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const sel = useUi.getState().selection;
    const k = e.key;

    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (isShortcut(e, 'undo')) return run(undo);
    if (isShortcut(e, 'redo') || (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y'))) return run(redo);
    if (isShortcut(e, 'newShot')) return run(newShotBelow);
    if (isShortcut(e, 'newSequence')) return run(newSequenceAfter);
    if (isShortcut(e, 'duplicate')) return run(duplicateCurrent);
    if (isShortcut(e, 'fillDown')) return run(fillDown);
    if (isShortcut(e, 'deleteShot')) return run(deleteCurrentShots);
    if (isShortcut(e, 'moveShotUp')) return run(() => moveCurrentShot(-1));
    if (isShortcut(e, 'moveShotDown')) return run(() => moveCurrentShot(1));
    if (isShortcut(e, 'moveSequenceUp')) return run(() => moveCurrentSequence(-1));
    if (isShortcut(e, 'moveSequenceDown')) return run(() => moveCurrentSequence(1));
    if (!sel) {
      if (ARROWS[k] && model.rows.length) {
        e.preventDefault();
        setSelection({ row: 0, col: columns[0] });
      }
      return;
    }
    if (ARROWS[k]) {
      e.preventDefault();
      const next = moveCell(doc, model, sel.focus, ARROWS[k]);
      if (e.shiftKey) setSelection(sel.anchor, next);
      else setSelection(next);
      return;
    }
    if (k === 'Tab') {
      const next = moveCell(doc, model, sel.focus, e.shiftKey ? 'left' : 'right', true);
      // Aux extrémités de la grille, Tab en sort (navigation au clavier dans la page).
      if (next.row === sel.focus.row && next.col === sel.focus.col) return;
      e.preventDefault();
      setSelection(next);
      return;
    }
    if (k === 'Enter' || k === 'F2') {
      e.preventDefault();
      startEdit(sel.focus);
      return;
    }
    if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      clearSelection(selectionRect(model, sel.anchor, sel.focus).cols);
      return;
    }
    if (k === 'Escape') {
      setSelection(sel.focus);
      return;
    }
    // Caractère imprimable (y compris avec Option sur Mac : « œ … [ { | ~ ») : la saisie commence.
    if (k.length === 1 && !mod && k !== '?' && !(e.altKey && /^[a-z0-9]$/i.test(k))) {
      e.preventDefault();
      startEdit(sel.focus, k);
    }
  };

  const onCopy = (e: ClipboardEvent) => {
    const sel = useUi.getState().selection;
    if (editing || !sel) return;
    const rect = selectionRect(model, sel.anchor, sel.focus);
    const matrix: string[][] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row = model.rows[r];
      matrix.push(rect.cols.map((c) => (row ? editableText(doc, row.shotId, c) || (model.bySeq.get(row.seqId)?.rows[row.shotIndex]?.cells[c] ?? '') : '')));
    }
    e.clipboardData.setData('text/plain', toTsv(matrix));
    e.preventDefault();
  };

  const onPaste = (e: ClipboardEvent) => {
    const sel = useUi.getState().selection;
    if (editing || !sel) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const matrix = parseTsv(text.replace(/\n$/, ''));
    if (matrix.length === 1 && matrix[0].length === 1 && sel.anchor.row !== sel.focus.row) {
      // Une valeur collée sur une sélection verticale : remplissage.
      const rect = selectionRect(model, sel.anchor, sel.focus);
      pasteMatrix(Array.from({ length: rect.r1 - rect.r0 + 1 }, () => matrix[0]), { row: rect.r0, col: rect.cols[0] }, columns);
      return;
    }
    // Collage à partir du coin haut gauche de la sélection, quel que soit le sens où elle a été tirée.
    const rect = selectionRect(model, sel.anchor, sel.focus);
    pasteMatrix(matrix, { row: rect.r0, col: rect.cols[0] }, columns);
  };

  const onCellMouseDown = (e: MouseEvent, pos: CellPos) => {
    const ed = useUi.getState().editing;
    if (ed) {
      // Clic dans la cellule en cours d'édition : on laisse faire le champ.
      if (ed.pos.row === pos.row && ed.pos.col === pos.col) return;
      // Clic ailleurs : la saisie est validée, puis la cellule cliquée est sélectionnée.
      (document.activeElement as HTMLElement | null)?.blur();
    }
    const sel = useUi.getState().selection;
    if (e.shiftKey && sel) {
      e.preventDefault();
      setSelection(sel.anchor, pos);
    } else setSelection(pos);
    focusGrid();
  };

  const rect = useMemo(() => (selection ? selectionRect(model, selection.anchor, selection.focus) : null), [model, selection]);

  return (
    <div
      ref={wrapRef}
      className={s.wrap}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      data-testid="grid"
      aria-label="Grille de découpage"
    >
      <table ref={tableRef} className={s.table} role="grid" aria-rowcount={model.rows.length} aria-colcount={columns.length}>
        <colgroup>
          {columns.map((c, i) => (
            <Fragment key={c}>
              {i === 1 && <col className={s.gutterCol} />}
              <col className={s[`col_${c}`]} />
            </Fragment>
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <Fragment key={c}>
                {i === 1 && <th className={[s.th, s.gutter].join(' ')} aria-hidden="true" />}
                <th scope="col" className={[s.th, s[`th_${c}`]].join(' ')}>
                  {COLUMN_DEFS[c].label}
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        {model.seqs.length > 0 && (
          <tbody>
            <SeqAddRows span={columns.length + 1} label="Insérer une séquence en tête" onAdd={() => insertSequenceAt(0)} testId="insert-sequence-first" />
          </tbody>
        )}
        {model.seqs.map((seq) => (
          <SequenceBody
            key={seq.seqId}
            doc={doc}
            model={model}
            seq={seq}
            rect={rect}
            focus={selection?.focus ?? null}
            editing={editing}
            onCellMouseDown={onCellMouseDown}
            onCellDoubleClick={(pos) => startEdit(pos)}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        ))}
      </table>
    </div>
  );
}

export type GridColumn = ColumnKey;
