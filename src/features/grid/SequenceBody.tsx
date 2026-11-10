import { SeqMeta } from './SeqMeta';
import { SeqTiming } from './SeqTiming';
import { Plus, Trash2 } from 'lucide-react';
import { BEAT_COLUMNS } from '../../domain/oneshot';
import { toggleOneShot } from '../../domain/oneshot';
import { Fragment, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { displayLines, displaySpan } from '../../domain/merge';
import {
  addFirstShot,
  deleteEmptySequence,
  deleteSequenceOf,
  deleteShotById,
  insertSequenceAt,
  insertShotAfter,
  insertShotAt,
  rowOfShot,
  shotsFromText,
} from './actions';
import { DroppableBody, DroppableRow, NumberHandle, SeqHandle } from './dnd';
import { editableText, setCellText } from '../../domain/cells';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { sequenceNumber } from '../../domain/numbering';
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
  if (!d || d.project.settings.tcMode === 'piste' || !editableText(d, shotId, 'tc')) return;
  e.preventDefault();
  useUi.getState().set({
    menu: {
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Revenir au calcul automatique',
          action: () => mutateDoc((x) => void setCellText(x, shotId, 'tc', '')),
        },
      ],
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

/** Colonne de suppression des plans : entre SÉQUENCE et N°, pour ne pas la confondre avec la séquence. */
function withGutter(cells: ReactNode[], gutter: ReactNode): ReactNode[] {
  const out = [...cells];
  out.splice(1, 0, gutter);
  return out;
}

export function SequenceBody({
  doc,
  model,
  seq,
  rect,
  focus,
  editing,
  onCellMouseDown,
  onCellDoubleClick,
  onCommit,
  onCancel,
}: Props) {
  const sequence = doc.sequences[seq.seqId];
  const n = seq.rows.length;
  const columns = model.columns;
  const seqTiming = model.timing.sequences.get(seq.seqId);
  const color = sequence?.color;
  const seqNumber = sequenceNumber(doc, seq.seqId);

  if (n === 0) {
    // Séquence sans plan (scénario importé) : même en-tête que les autres, puis une ligne fantôme —
    // le « + » à la place du N° et l'aperçu du texte ; « depuis le texte » au survol, à droite.
    const passages = seq.empty?.passages ?? 0;
    const excerpt = seq.empty?.excerpt ?? '';
    // Suppr / Retour arrière sur le « + » : la séquence vide s'en va (annulable).
    const onAddKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      void deleteEmptySequence(seq.seqId);
    };
    return (
      <DroppableBody seqId={seq.seqId} className={[s.seq, s.emptyBody].join(' ')} style={color ? ({ '--seq-color': color } as CSSProperties) : undefined}>
        <tr className={s.emptyRow} data-testid="empty-sequence" data-empty-seq={seq.seqId}>
          <td className={[s.cell, s.c_sequence].join(' ')} title={sequence?.label ? `${seqNumber}, ${sequence.label.toUpperCase()}` : undefined}>
            <div className={s.seqCell}>
              <SeqHandle seqId={seq.seqId} label={`${seqNumber}`} />
              <button
                type="button"
                className={s.seqDel}
                aria-label={`Supprimer la séquence ${seqNumber}`}
                title="Supprimer cette séquence"
                onClick={() => void deleteSequenceOf(undefined, seq.seqId)}
                tabIndex={-1}
                data-testid="delete-sequence"
              >
                <Trash2 size={13} strokeWidth={1.4} />
              </button>
              <span className={s.seqLabel}>
                {seqNumber}, {sequence?.label.toUpperCase() || <span className={s.placeholder}>libellé</span>}
              </span>
              <SeqMeta doc={doc} seqId={seq.seqId} />
              <SeqTiming doc={doc} seqId={seq.seqId} timing={model.timing} />
            </div>
          </td>
          <td className={s.gutter} aria-hidden="true" />
          <td className={s.emptyCell} colSpan={columns.length - 1} data-empty-cell>
            <div className={s.emptyLine}>
              <button
                type="button"
                className={s.emptyAdd}
                onClick={() => addFirstShot(seq.seqId)}
                onKeyDown={onAddKey}
                aria-label={`Ajouter un plan à la séquence ${seqNumber}`}
                data-testid="add-first-shot"
              >
                <span className={s.emptyPlus} aria-hidden="true">
                  <Plus size={14} strokeWidth={1.25} />
                </span>
                {excerpt && <span className={s.excerpt}>{excerpt}</span>}
              </button>
              {passages > 0 && (
                <button type="button" className={s.fromText} onClick={() => shotsFromText(seq.seqId)} data-testid="shots-from-text">
                  {passages} plan{passages > 1 ? 's' : ''} depuis le texte
                </button>
              )}
            </div>
          </td>
        </tr>
        <SeqAddRows
          span={columns.length + 1}
          label={`Insérer une séquence après la séquence ${seqNumber}`}
          onAdd={() => insertSequenceAt(doc.project.sequenceIds.indexOf(seq.seqId) + 1)}
        />
      </DroppableBody>
    );
  }

  return (
    <DroppableBody
      seqId={seq.seqId}
      className={s.seq}
      style={color ? ({ '--seq-color': color } as CSSProperties) : undefined}
    >
      <PlanAddRow
        span={columns.length + 1}
        label={`Ajouter un plan en tête de la séquence ${seqNumber}`}
        onAdd={() => insertShotAt(seq.seqId, 0)}
      />
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
              className={[
                s.cell,
                s[`c_${col}`],
                s.beatCell,
                k > 0 ? s.beatNext : '',
                k < lines!.length - 1 ? s.beatMore : '',
                l.bridge ? s.bridge : '',
                selected ? s.selected : '',
                k === 0 && focus?.row === row && focus.col === col ? s.focus : '',
              ].join(' ')}
              title={l.bridge ? `Liaison : ${v}` : undefined}
              onMouseDown={(e) => e.button === 0 && onCellMouseDown(e, pos)}
              onDoubleClick={() => onCellDoubleClick(pos)}
            >
              {l.bridge ? (
                v ? (
                  `↳ ${v}`
                ) : (
                  ''
                )
              ) : (
                <>
                  {first && <b className={s.beatTag}>{l.tag}</b>}
                  {v}
                </>
              )}
            </td>
          );
        };
        const cellTd = (col: ColumnKey) => {
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
                  // N° : numéro dérivé et verrouillé, la cellule sert de poignée ; jamais encadrée.
                  const selected =
                    col !== 'number' && !!rect && row >= rect.r0 && row <= rect.r1 && rect.cols.includes(col);
                  const isFocus = col !== 'number' && focus?.row === row && focus.col === col;
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
                            <Trash2 size={13} strokeWidth={1.4} />
                          </button>
                          <span className={s.seqLabel}>
                            {sequenceNumber(doc, seq.seqId)},{' '}
                            {sequence?.label.toUpperCase() || <span className={s.placeholder}>libellé</span>}
                          </span>
                          <SeqMeta doc={doc} seqId={seq.seqId} />
                          <SeqTiming doc={doc} seqId={seq.seqId} timing={model.timing} />
                        </div>
                      ) : col === 'tc' ? (
                        <span className={s.tc}>
                          {text}
                          {(kind === 'sequence'
                            ? seqTiming?.manual
                            : model.timing.blocks.get(shot.actionBlockId)?.manual &&
                              doc.project.settings.tcMode !== 'piste') && (
                            <span className={s.manual} title="Valeur saisie à la main">
                              ✎
                            </span>
                          )}
                        </span>
                      ) : col === 'number' ? (
                        <>
                          <NumberHandle
                            shotId={r.shotId}
                            label={`${seqNumber}.${text}`}
                            num={text}
                            onPick={() => {
                              const row = rowOfShot(doc, r.shotId);
                              if (row >= 0) useUi.getState().setSelection({ row, col: 'subject' }, { row, col: model.columns[model.columns.length - 1] });
                            }}
                          />
                          {/* Dans une interview (ses caméras, ses cadres) : rien à insérer. */}
                          {!(shot?.interview && doc.shots[seq.rows[i + 1]?.shotId]?.interview?.subjectId === shot.interview.subjectId) && (
                          <button
                            type="button"
                            className={s.rowAdd}
                            aria-label={`Insérer un plan après le plan ${seqNumber}.${text}`}
                            title="Insérer un plan ici"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => insertShotAfter(r.shotId)}
                            tabIndex={-1}
                            data-testid="insert-shot"
                          />
                          )}
                        </>
                      ) : (
                        <>
                          {repeated && text ? (
                            <span className={s.repeat} title={text}>
                              <span className={s.ditto} aria-hidden="true">
                                〃
                              </span>
                              <span className={s.faded}>{text}</span>
                            </span>
                          ) : (
                            text
                          )}
                        </>
                      )}
                    </td>
                  );
        };
        return (
          <Fragment key={r.shotId}>
            <DroppableRow
              shotId={r.shotId}
              className={[s.row, shot?.oneShot ? s.oneShot : '', shot?.interview ? s.itwRow : ''].join(' ')}
              data-shot={r.shotId}
              data-testid="shot-row"
            >
              {withGutter(
                columns.map(cellTd),
                <td
                  key="gutter"
                  className={s.gutter}
                  data-testid="shot-gutter"
                  rowSpan={lines ? displayLines(r) : undefined}
                  onContextMenu={(e) => onGutterContextMenu(e, r.shotId)}
                  title="Clic droit : plan-séquence"
                >
                  <button
                    type="button"
                    className={s.rowDel}
                    aria-label={`Supprimer le plan ${seqNumber}.${r.cells.number ?? i + 1}`}
                    title="Supprimer ce plan"
                    onClick={() => deleteShotById(r.shotId)}
                    tabIndex={-1}
                    data-testid="delete-shot"
                  >
                    <Trash2 size={13} strokeWidth={1.4} />
                  </button>
                  <IssueDot issues={model.issues.get(r.shotId)} />
                </td>,
              )}
            </DroppableRow>
            {lines?.slice(1).map((_, k) => (
              <tr key={k} className={[s.row, s.oneShot, s.subRow].join(' ')}>
                {columns.filter((c) => BEAT_COLUMNS.includes(c)).map((c) => beatTd(c, k + 1))}
              </tr>
            ))}
          </Fragment>
        );
      })}
      <PlanAddRow
        span={columns.length + 1}
        label={`Ajouter un plan en fin de séquence ${seqNumber}`}
        onAdd={() => insertShotAt(seq.seqId, n)}
      />
      <SeqAddRows
        span={columns.length + 1}
        label={`Insérer une séquence après la séquence ${seqNumber}`}
        onAdd={() => insertSequenceAt(doc.project.sequenceIds.indexOf(seq.seqId) + 1)}
      />
    </DroppableBody>
  );
}

/** Ligne fine « + plan » (tête et fin de séquence) : toute la largeur est le bouton. */
function PlanAddRow({ span, label, onAdd }: { span: number; label: string; onAdd: () => void }) {
  return (
    <tr className={s.planAddRow}>
      <td colSpan={span}>
        <button
          type="button"
          className={s.planAddBtn}
          onClick={onAdd}
          aria-label={label}
          title={label}
          tabIndex={-1}
          data-testid="add-plan-row"
        >
          + plan
        </button>
      </td>
    </tr>
  );
}

/** Écart entre séquences : mini marge, ligne-bouton « + séquence » sur toute la largeur, mini marge. */
export function SeqAddRows({
  span,
  label,
  onAdd,
  testId = 'insert-sequence',
}: {
  span: number;
  label: string;
  onAdd: () => void;
  testId?: string;
}) {
  return (
    <>
      <tr className={s.gapRow} aria-hidden="true">
        <td colSpan={span} />
      </tr>
      <tr className={s.seqAddRow}>
        <td colSpan={span}>
          <button
            type="button"
            className={s.seqAddBtn}
            onClick={onAdd}
            aria-label={label}
            title={label}
            tabIndex={-1}
            data-testid={testId}
          >
            + séquence
          </button>
        </td>
      </tr>
      <tr className={s.gapRow} aria-hidden="true">
        <td colSpan={span} />
      </tr>
    </>
  );
}
