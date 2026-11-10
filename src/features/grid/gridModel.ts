import { tcLast } from '../../domain/columns';
import { isEditable } from '../../domain/cells';
import { runChecks, type Issue } from '../../domain/lint';
import type { MergeMap, MergeRow } from '../../domain/merge';
import { repeatedFlags } from '../../domain/merge';
import { sequenceMerges } from '../../domain/rows';
import { computeTiming, type Timing } from '../../domain/timing';
import { parseFountain, type ScriptElement } from '../../domain/fountain';
import { sequenceExcerpt, sequencePassages } from '../../domain/scriptToShot';
import type { ColumnKey, ID, ProjectDoc } from '../../domain/types';

export interface FlatRow {
  seqId: ID;
  shotId: ID;
  seqIndex: number;
  shotIndex: number;
  rowIndex: number;
}

export interface SeqModel {
  seqId: ID;
  firstRow: number;
  rows: MergeRow[];
  merges: MergeMap;
  repeated: Partial<Record<ColumnKey, boolean[]>>;
  /** Séquence sans plan : aperçu de son texte et nombre de plans que ce texte donnerait. */
  empty?: { excerpt: string; passages: number };
}

export interface GridModel {
  issues: Map<ID, Issue[]>;
  columns: ColumnKey[];
  rows: FlatRow[];
  seqs: SeqModel[];
  bySeq: Map<ID, SeqModel>;
  timing: Timing;
}

/** Scénario lu une fois par texte, et seulement s'il sert (séquences sans plan). */
let parsed: { source: string; elements: ScriptElement[] } | null = null;
function parsedScript(source: string): ScriptElement[] {
  if (parsed?.source !== source) parsed = { source, elements: parseFountain(source) };
  return parsed.elements;
}

export function buildGridModel(doc: ProjectDoc): GridModel {
  const timing = computeTiming(doc);
  const columns = tcLast(doc.project.settings.gridColumns);
  const rows: FlatRow[] = [];
  const seqs: SeqModel[] = [];
  const script = () => parsedScript(doc.scenario ?? '');
  doc.project.sequenceIds.forEach((seqId, seqIndex) => {
    const seq = doc.sequences[seqId];
    if (!seq) return;
    const firstRow = rows.length;
    seq.shotIds.forEach((shotId, shotIndex) => rows.push({ seqId, shotId, seqIndex, shotIndex, rowIndex: rows.length }));
    const { rows: mrows, merges } = sequenceMerges(doc, timing, seqId, columns);
    const repeated: SeqModel['repeated'] = {};
    for (const c of columns) repeated[c] = repeatedFlags(merges.get(c) ?? [], mrows.length);
    const empty = seq.shotIds.length ? undefined : { excerpt: sequenceExcerpt(doc, seqId, script()), passages: sequencePassages(doc, seqId, script()).length };
    seqs.push({ seqId, firstRow, rows: mrows, merges, repeated, empty });
  });
  const issues = new Map<ID, Issue[]>();
  for (const issue of runChecks(doc, timing)) {
    if (!issue.shotId) continue;
    issues.set(issue.shotId, [...(issues.get(issue.shotId) ?? []), issue]);
  }
  return { issues, columns, rows, seqs, bySeq: new Map(seqs.map((s) => [s.seqId, s])), timing };
}

export type SpanKind = 'sequence' | 'block' | 'row';

export function spanKind(doc: ProjectDoc, col: ColumnKey): SpanKind {
  if (col === 'sequence') return 'sequence';
  if (col === 'action' || col === 'dialogue') return 'block';
  if (col === 'tc') {
    const s = doc.project.settings;
    if (s.tcMode === 'duree') return 'row';
    return s.tcMode === 'cumulatif' && s.tcGranularity === 'sequence' ? 'sequence' : 'block';
  }
  return 'row';
}

/** Étendue (lignes globales inclusives) de la cellule qui contient `row` dans la colonne `col`. */
export function cellSpan(doc: ProjectDoc, model: GridModel, row: number, col: ColumnKey): { start: number; end: number } {
  const r = model.rows[row];
  if (!r) return { start: row, end: row };
  const kind = spanKind(doc, col);
  if (kind === 'row' && !doc.shots[r.shotId]?.interview) return { start: row, end: row };
  const seq = model.bySeq.get(r.seqId)!;
  const last = seq.firstRow + seq.rows.length - 1;
  if (kind === 'sequence') return { start: seq.firstRow, end: last };
  // Cadre d'interview : ses caméras forment une seule bande, d'un bout à l'autre de la ligne.
  const group = doc.shots[r.shotId]?.interview?.setupId;
  if (group) {
    let start = row;
    let end = row;
    while (start > seq.firstRow && doc.shots[model.rows[start - 1].shotId]?.interview?.setupId === group) start--;
    while (end < last && doc.shots[model.rows[end + 1].shotId]?.interview?.setupId === group) end++;
    return { start, end };
  }
  const block = doc.shots[r.shotId]?.actionBlockId;
  let start = row;
  let end = row;
  while (start > seq.firstRow && doc.shots[model.rows[start - 1].shotId]?.actionBlockId === block) start--;
  while (end < last && doc.shots[model.rows[end + 1].shotId]?.actionBlockId === block) end++;
  return { start, end };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export function moveCell(
  doc: ProjectDoc,
  model: GridModel,
  pos: { row: number; col: ColumnKey },
  dir: Direction,
  skipReadonly = false,
): { row: number; col: ColumnKey } {
  const cols = model.columns;
  const maxRow = model.rows.length - 1;
  if (maxRow < 0) return pos;
  const span = cellSpan(doc, model, pos.row, pos.col);
  if (dir === 'down') return { row: Math.min(maxRow, span.end + 1 > maxRow ? span.start : span.end + 1), col: pos.col };
  if (dir === 'up') {
    if (span.start === 0) return { row: span.start, col: pos.col };
    return { row: cellSpan(doc, model, span.start - 1, pos.col).start, col: pos.col };
  }
  const i = cols.indexOf(pos.col);
  const step = dir === 'left' ? -1 : 1;
  let ni = i + step;
  while (skipReadonly && ni > 0 && ni < cols.length - 1 && !isEditable(cols[ni])) ni += step;
  ni = Math.max(0, Math.min(cols.length - 1, ni));
  if (skipReadonly && !isEditable(cols[ni])) ni = i;
  const col = cols[ni];
  return { row: cellSpan(doc, model, pos.row, col).start, col };
}

/** Rectangle de sélection (lignes et colonnes) entre deux positions. */
export function selectionRect(model: GridModel, a: { row: number; col: ColumnKey }, b: { row: number; col: ColumnKey }) {
  const ci = [model.columns.indexOf(a.col), model.columns.indexOf(b.col)].sort((x, y) => x - y);
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row),
    cols: model.columns.slice(ci[0], ci[1] + 1),
  };
}
