import { useFlip } from '../../ui/useFlip';
import { BEAT_COLUMNS } from '../../domain/oneshot';
import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
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

    if (mod && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) newSequenceAfter();
      else newShotBelow();
      return;
    }
    if (mod && (k === 'd' || k === 'D')) {
      e.preventDefault();
      duplicateCurrent();
      return;
    }
    if (mod && e.shiftKey && k === 'ArrowDown') {
      e.preventDefault();
      fillDown();
      return;
    }
    if (mod && k === 'Backspace') {
      e.preventDefault();
      deleteCurrentShots();
      return;
    }
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      const delta = k === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey) moveCurrentSequence(delta);
      else moveCurrentShot(delta);
      return;
    }
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
      e.preventDefault();
      setSelection(moveCell(doc, model, sel.focus, e.shiftKey ? 'left' : 'right', true));
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
    if (k.length === 1 && !mod && !e.altKey && k !== '?') {
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
    pasteMatrix(matrix, sel.focus, columns);
  };

  const onCellMouseDown = (e: MouseEvent, pos: CellPos) => {
    if (useUi.getState().editing) return;
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
      <table className={s.table} role="grid" aria-rowcount={model.rows.length} aria-colcount={columns.length}>
        <colgroup>
          <col className={s.gutterCol} />
          {columns.map((c) => (
            <col key={c} className={s[`col_${c}`]} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={s.gutter} aria-hidden="true" />
            {columns.map((c) => (
              <th key={c} scope="col" className={[s.th, s[`th_${c}`]].join(' ')}>
                {COLUMN_DEFS[c].label}
              </th>
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
