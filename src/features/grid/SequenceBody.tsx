import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { editableText } from '../../domain/cells';
import { sequenceNumber } from '../../domain/numbering';
import { formatGap } from '../../domain/timing';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import type { CellPos, UiState } from '../../store/uiStore';
import { CellEditor, type CommitMove } from './CellEditor';
import { cellSpan, spanKind, type GridModel, type SeqModel } from './gridModel';
import s from './Grid.module.css';

interface Props {
  doc: ProjectDoc;
  model: GridModel;
  seq: SeqModel;
  rect: { r0: number; r1: number; cols: ColumnKey[] } | null;
  focus: CellPos | null;
  editing: UiState['editing'];
  onCellMouseDown: (e: MouseEvent, pos: CellPos) => void;
  onCellDoubleClick: (pos: CellPos) => void;
  onCommit: (text: string, move: CommitMove) => void;
  onCancel: () => void;
  rowGutter?: (row: number) => ReactNode;
  seqHandle?: ReactNode;
}

export function SequenceBody({ doc, model, seq, rect, focus, editing, onCellMouseDown, onCellDoubleClick, onCommit, onCancel, rowGutter, seqHandle }: Props) {
  const sequence = doc.sequences[seq.seqId];
  const n = seq.rows.length;
  const columns = model.columns;
  const seqTiming = model.timing.sequences.get(seq.seqId);
  const color = sequence?.color;

  if (n === 0) {
    return (
      <tbody className={s.seq} data-seq={seq.seqId}>
        <tr>
          <td className={s.gutter} />
          <td className={s.emptySeq} colSpan={columns.length}>
            <strong>{sequenceNumber(doc, seq.seqId)}, {sequence?.label.toUpperCase()}</strong> — <span className="hand">séquence vide</span>
          </td>
        </tr>
        <tr className={s.spacer} aria-hidden="true">
          <td colSpan={columns.length + 1} />
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className={s.seq} data-seq={seq.seqId} style={color ? ({ '--seq-color': color } as CSSProperties) : undefined}>
      {seq.rows.map((r, i) => {
        const row = seq.firstRow + i;
        const shot = doc.shots[r.shotId];
        return (
          <tr key={r.shotId} className={s.row} data-shot={r.shotId} data-testid="shot-row">
            <td className={s.gutter}>{rowGutter?.(row)}</td>
            {columns.map((col) => {
              const kind = spanKind(doc, col);
              let span = 1;
              if (kind !== 'row') {
                const sp = cellSpan(doc, model, row, col);
                if (sp.start !== row) return null;
                span = sp.end - sp.start + 1;
              }
              const pos = { row, col };
              const selected = !!rect && row >= rect.r0 && row <= rect.r1 && rect.cols.includes(col);
              const isFocus = focus?.row === row && focus.col === col;
              const isEditing = editing?.pos.row === row && editing.pos.col === col;
              const repeated = seq.repeated[col]?.[i] ?? false;
              const text = r.cells[col] ?? '';
              const linked = col === 'action' && span > 1;
              return (
                <td
                  key={col}
                  rowSpan={span > 1 ? span : undefined}
                  role="gridcell"
                  aria-selected={selected}
                  data-cell={`${row}:${col}`}
                  className={[
                    s.cell,
                    s[`c_${col}`],
                    selected ? s.selected : '',
                    isFocus ? s.focus : '',
                    isEditing ? s.editing : '',
                    linked ? s.linked : '',
                  ].join(' ')}
                  onMouseDown={(e) => onCellMouseDown(e, pos)}
                  onDoubleClick={() => onCellDoubleClick(pos)}
                >
                  {isEditing ? (
                    <CellEditor
                      doc={doc}
                      shotId={r.shotId}
                      col={col}
                      initial={editableText(doc, r.shotId, col)}
                      replace={editing?.initial}
                      onCommit={onCommit}
                      onCancel={onCancel}
                    />
                  ) : col === 'sequence' ? (
                    <div className={s.seqCell}>
                      {seqHandle}
                      <span className={s.seqLabel}>
                        {sequenceNumber(doc, seq.seqId)}, {sequence?.label.toUpperCase() || <span className={s.placeholder}>libellé</span>}
                      </span>
                      {sequence?.intExt || sequence?.effect ? (
                        <span className={s.seqMeta}>{[sequence.intExt, sequence.effect].filter(Boolean).join(' · ')}</span>
                      ) : null}
                      {seqTiming?.gap && (
                        <span className={[s.gap, s[`gap_${seqTiming.gap.level}`]].join(' ')} title="Écart entre durée calculée et durée estimée">
                          {formatGap(seqTiming.gap)}
                        </span>
                      )}
                    </div>
                  ) : col === 'tc' ? (
                    <span className={s.tc}>
                      {text}
                      {(kind === 'sequence' ? seqTiming?.manual : model.timing.blocks.get(shot.actionBlockId)?.manual && doc.project.settings.tcMode === 'cumulatif') && (
                        <span className={s.manual} title="Valeur saisie à la main">✎</span>
                      )}
                    </span>
                  ) : col === 'number' ? (
                    <span className={s.num}>{text}</span>
                  ) : (
                    <>
                      {repeated && text ? (
                        <span className={s.repeat} title={text}>
                          <span className={s.ditto} aria-hidden="true">〃</span>
                          <span className={s.faded}>{text}</span>
                        </span>
                      ) : (
                        text
                      )}
                      {linked && <span className={s.linkTag}>lié · {span} plans</span>}
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
      <tr className={s.spacer} aria-hidden="true">
        <td colSpan={columns.length + 1} />
      </tr>
    </tbody>
  );
}
