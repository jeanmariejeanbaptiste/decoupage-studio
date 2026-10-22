import { BEAT_COLUMNS } from '../../domain/oneshot';
import { toggleOneShot } from '../../domain/oneshot';
import { Fragment, type CSSProperties, type MouseEvent } from 'react';
import { displayLines, displaySpan } from '../../domain/merge';
import { deleteSequenceOf, deleteShotById, rowOfShot } from './actions';
import { DroppableBody, DroppableRow, SeqHandle, ShotHandle } from './dnd';
import { editableText, setCellText } from '../../domain/cells';
import { addShot } from '../../domain/ops';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { sequenceNumber } from '../../domain/numbering';
import { formatGap } from '../../domain/timing';
import { focalTooltip } from '../../domain/focal';
import { hasAngleConflict } from '../../domain/vocabulary';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import type { CellPos, UiState } from '../../store/uiStore';
import { CellEditor, type CommitMove } from './CellEditor';
import { cellSpan, spanKind, type GridModel, type SeqModel } from './gridModel';
import type { Issue } from '../../domain/lint';
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
}

function IssueDot({ issues }: { issues: Issue[] | undefined }) {
  if (!issues?.length) return null;
  const warn = issues.some((i) => i.level === 'warn');
  return (
    <span
      className={[s.issueDot, warn ? s.issueWarn : s.issueInfo].join(' ')}
      title={issues.map((i) => `• ${i.message}`).join('\n')}
      aria-label={`${issues.length} vérification${issues.length > 1 ? 's' : ''}`}
      role="img"
      data-testid="issue-dot"
    />
  );
}

function onTcContextMenu(e: MouseEvent, shotId: string) {
  const d = useProjectStore.getState().doc;
  if (!d || d.project.settings.tcMode !== 'cumulatif' || !editableText(d, shotId, 'tc')) return;
  e.preventDefault();
  useUi.getState().set({
    menu: {
      x: e.clientX,
      y: e.clientY,
      items: [{ label: 'Revenir au calcul automatique', action: () => mutateDoc((x) => void setCellText(x, shotId, 'tc', '')) }],
    },
  });
}

/** Entrée discrète du plan-séquence : clic droit dans la marge du plan. */
function onGutterContextMenu(e: MouseEvent, shotId: string) {
  const d = useProjectStore.getState().doc;
  if (!d?.shots[shotId]) return;
  e.preventDefault();
  const on = !!d.shots[shotId].oneShot;
  useUi.getState().set({
    menu: {
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: on ? 'Revenir à un plan simple' : 'Transformer en plan-séquence',
          action: () => {
            mutateDoc((x) => toggleOneShot(x, shotId));
            const row = rowOfShot(d, shotId);
            if (row >= 0) useUi.getState().setSelection({ row, col: 'number' });
            if (!on) useUi.getState().set({ oneShotEditor: shotId });
          },
        },
      ],
    },
  });
}

export function SequenceBody({ doc, model, seq, rect, focus, editing, onCellMouseDown, onCellDoubleClick, onCommit, onCancel }: Props) {
  const sequence = doc.sequences[seq.seqId];
  const n = seq.rows.length;
  const columns = model.columns;
  const seqTiming = model.timing.sequences.get(seq.seqId);
  const color = sequence?.color;
  const seqNumber = sequenceNumber(doc, seq.seqId);

  if (n === 0) {
    return (
      <DroppableBody seqId={seq.seqId} className={s.seq}>
        <tr>
          <td className={s.gutter} />
          <td className={s.emptySeq} colSpan={columns.length}>
            <strong>{sequenceNumber(doc, seq.seqId)}, {sequence?.label.toUpperCase()}</strong> — <span className="hand">séquence vide</span>{' '}
            <button type="button" className={s.addInEmpty} onClick={() => mutateDoc((d) => void addShot(d, seq.seqId))}>
              Ajouter un plan
            </button>{' '}
            <button type="button" className={s.addInEmpty} onClick={() => void deleteSequenceOf(undefined, seq.seqId)}>
              Supprimer la séquence
            </button>
          </td>
        </tr>
        <tr className={s.spacer} aria-hidden="true">
          <td colSpan={columns.length + 1} />
        </tr>
      </DroppableBody>
    );
  }

  return (
    <DroppableBody seqId={seq.seqId} className={s.seq} style={color ? ({ '--seq-color': color } as CSSProperties) : undefined}>
      {seq.rows.map((r, i) => {
        const row = seq.firstRow + i;
        const shot = doc.shots[r.shotId];
        const lines = r.lines;
        // Plan-séquence : une vraie ligne par temps (et par liaison), alignée d'une colonne à l'autre.
        const beatTd = (col: ColumnKey, k: number) => {
          const l = lines![k];
          const pos = { row, col };
          const selected = !!rect && row >= rect.r0 && row <= rect.r1 && rect.cols.includes(col);
          const v = l.cells[col] ?? '';
          const first = col === BEAT_COLUMNS.find((x) => columns.includes(x));
          return (
            <td
              key={col}
              role="gridcell"
              aria-selected={selected}
              data-cell={k === 0 ? `${row}:${col}` : undefined}
              className={[s.cell, s[`c_${col}`], s.beatCell, k > 0 ? s.beatNext : '', k < lines!.length - 1 ? s.beatMore : '', l.bridge ? s.bridge : '', selected ? s.selected : '', k === 0 && focus?.row === row && focus.col === col ? s.focus : ''].join(' ')}
              title={l.bridge ? `Liaison : ${v}` : undefined}
              onMouseDown={(e) => e.button === 0 && onCellMouseDown(e, pos)}
              onDoubleClick={() => onCellDoubleClick(pos)}
            >
              {l.bridge ? (v ? `↳ ${v}` : '') : (
                <>
                  {first && <b className={s.beatTag}>{l.tag}</b>}
                  {v}
                </>
              )}
            </td>
          );
        };
        return (
          <Fragment key={r.shotId}>
          <DroppableRow shotId={r.shotId} className={[s.row, shot?.oneShot ? s.oneShot : ''].join(' ')} data-shot={r.shotId} data-testid="shot-row">
            <td className={s.gutter} rowSpan={lines ? displayLines(r) : undefined} onContextMenu={(e) => onGutterContextMenu(e, r.shotId)} title="Clic droit : plan-séquence">
              <ShotHandle shotId={r.shotId} label={`${seqNumber}.${i + 1}`} />
              <button type="button" className={s.rowDel} aria-label={`Supprimer le plan ${seqNumber}.${i + 1}`} title="Supprimer ce plan" onClick={() => deleteShotById(r.shotId)} tabIndex={-1} data-testid="delete-shot">
                ×
              </button>
              <IssueDot issues={model.issues.get(r.shotId)} />
            </td>
            {columns.map((col) => {
              if (lines && BEAT_COLUMNS.includes(col)) return beatTd(col, 0);
              const kind = spanKind(doc, col);
              let span = 1;
              let h = displayLines(r);
              if (kind !== 'row') {
                const sp = cellSpan(doc, model, row, col);
                if (sp.start !== row) return null;
                span = sp.end - sp.start + 1;
                h = displaySpan(seq.rows, sp.start - seq.firstRow, span);
              }
              const pos = { row, col };
              const selected = !!rect && row >= rect.r0 && row <= rect.r1 && rect.cols.includes(col);
              const isFocus = focus?.row === row && focus.col === col;
              const isEditing = editing?.pos.row === row && editing.pos.col === col;
              const repeated = seq.repeated[col]?.[i] ?? false;
              const text = r.cells[col] ?? '';
              const linked = col === 'action' && span > 1;
              const conflict = col === 'angle' && hasAngleConflict(shot.angle);
              const tip =
                col === 'focal'
                  ? focalTooltip(shot.focal, doc.project.settings.sensor, doc.project.settings.cropFactor)
                  : conflict
                    ? 'Deux axes ou deux hauteurs incompatibles'
                    : undefined;
              return (
                <td
                  key={col}
                  rowSpan={h > 1 ? h : undefined}
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
                    conflict ? s.conflict : '',
                  ].join(' ')}
                  title={tip || undefined}
                  onMouseDown={(e) => e.button === 0 && onCellMouseDown(e, pos)}
                  onContextMenu={col === 'tc' ? (e) => onTcContextMenu(e, r.shotId) : undefined}
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
                      <SeqHandle seqId={seq.seqId} label={`${seqNumber}`} />
                      <button
                        type="button"
                        className={s.seqDel}
                        aria-label={`Supprimer la séquence ${seqNumber}`}
                        title="Supprimer cette séquence"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => void deleteSequenceOf(undefined, seq.seqId)}
                        tabIndex={-1}
                        data-testid="delete-sequence"
                      >
                        ×
                      </button>
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
          </DroppableRow>
          {lines?.slice(1).map((_, k) => (
            <tr key={k} className={[s.row, s.oneShot, s.subRow].join(' ')}>
              {columns.filter((c) => BEAT_COLUMNS.includes(c)).map((c) => beatTd(c, k + 1))}
            </tr>
          ))}
          </Fragment>
        );
      })}
      <tr className={s.spacer} aria-hidden="true">
        <td colSpan={columns.length + 1} />
      </tr>
    </DroppableBody>
  );
}
