import { mergeKey } from './text';
import type { ColumnKey, ID, ProjectSettings } from './types';

export interface MergeRow {
  shotId: ID;
  blockId: ID;
  cells: Partial<Record<ColumnKey, string>>;
  mergeBreak?: readonly ColumnKey[];
  /** Ligne isolée (plan-séquence) : aucune cellule ne fusionne avec ses voisines, sauf la séquence. */
  isolated?: boolean;
  /** Plan-séquence : une sous-ligne par temps (et par liaison), alignées d'une colonne à l'autre. */
  lines?: SubLine[];
}

/** Sous-ligne d'un plan-séquence : « T1 », « T2 »… ou « ↳ » pour une liaison entre deux temps. */
export interface SubLine {
  tag: string;
  bridge?: boolean;
  cells: Partial<Record<ColumnKey, string>>;
}

/** Nombre de lignes d'affichage d'une ligne de découpage (1, ou une par temps et liaison). */
export const displayLines = (row: MergeRow | undefined) => Math.max(1, row?.lines?.length ?? 1);

/** Hauteur, en lignes d'affichage, d'une fusion qui couvre `span` lignes depuis `start`. */
export function displaySpan(rows: readonly MergeRow[], start: number, span: number): number {
  let n = 0;
  for (let i = start; i < start + span; i++) n += displayLines(rows[i]);
  return n;
}

export interface MergeSpan {
  startRow: number;
  span: number;
  value: string;
}

export type MergeMap = Map<ColumnKey, MergeSpan[]>;

export interface MergeOptions {
  neverMerge?: readonly ColumnKey[];
  tcMode: ProjectSettings['tcMode'];
  tcGranularity: ProjectSettings['tcGranularity'];
  /** Export sans aucune fusion : chaque ligne porte sa propre valeur. */
  noMerge?: boolean;
}

/**
 * Fusion verticale des cellules d'UNE séquence (§8.1). Aucune fusion ne traverse deux séquences :
 * l'appelant fournit les lignes d'une seule séquence.
 */
export function computeMerges(rows: readonly MergeRow[], columns: readonly ColumnKey[], opts: MergeOptions): MergeMap {
  const out: MergeMap = new Map();
  for (const col of columns) out.set(col, mergeColumn(rows, col, opts));
  return out;
}

function keyFor(row: MergeRow, col: ColumnKey, opts: MergeOptions): string {
  if (col === 'sequence' && !opts.noMerge) return '§';
  if (col === 'action') return `#${row.blockId}`;
  if (col === 'tc' && opts.tcMode === 'cumulatif') {
    return opts.tcGranularity === 'sequence' ? '§' : `#${row.blockId}`;
  }
  return mergeKey(row.cells[col] ?? '');
}

function mergeColumn(rows: readonly MergeRow[], col: ColumnKey, opts: MergeOptions): MergeSpan[] {
  const spans: MergeSpan[] = [];
  const never = opts.noMerge || col === 'number' || (opts.neverMerge?.includes(col) && col !== 'sequence');
  let prevKey: string | undefined;
  rows.forEach((row, i) => {
    const key = keyFor(row, col, opts);
    const last = spans[spans.length - 1];
    const forcedBreak = (row.mergeBreak?.includes(col) ?? false) || (col !== 'sequence' && (!!row.isolated || !!rows[i - 1]?.isolated));
    if (!never && last && key === prevKey && !forcedBreak) last.span += 1;
    else spans.push({ startRow: i, span: 1, value: row.cells[col] ?? '' });
    prevKey = key;
  });
  return spans;
}

/** Pour chaque ligne, indique si elle répète la valeur au-dessus (aperçu « 〃 », §4.3). */
export function repeatedFlags(spans: readonly MergeSpan[], rowCount: number): boolean[] {
  const flags = new Array<boolean>(rowCount).fill(false);
  for (const s of spans) for (let i = s.startRow + 1; i < s.startRow + s.span; i++) flags[i] = true;
  return flags;
}
