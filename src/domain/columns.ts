import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS, type ColumnKey } from './types';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Largeur relative à l'export (en %, §8.2). */
  width: number;
  optional: boolean;
}

export const COLUMN_DEFS: Readonly<Record<ColumnKey, ColumnDef>> = {
  sequence: { key: 'sequence', label: 'SÉQUENCE', width: 16, optional: false },
  number: { key: 'number', label: 'N°', width: 2.5, optional: false },
  subject: { key: 'subject', label: 'Sujet', width: 8, optional: false },
  value: { key: 'value', label: 'Valeur', width: 7, optional: false },
  angle: { key: 'angle', label: 'Angle', width: 14.5, optional: false },
  movement: { key: 'movement', label: 'Mouvement de caméra', width: 15.5, optional: false },
  focal: { key: 'focal', label: 'Focale', width: 6, optional: false },
  action: { key: 'action', label: 'Action', width: 23.5, optional: false },
  tc: { key: 'tc', label: 'TC MIN', width: 7, optional: false },
  aperture: { key: 'aperture', label: 'Ouverture', width: 5, optional: true },
  characters: { key: 'characters', label: 'Personnages', width: 9, optional: true },
  dialogue: { key: 'dialogue', label: 'Dialogue', width: 16, optional: true },
  sound: { key: 'sound', label: 'Son', width: 11, optional: true },
  light: { key: 'light', label: 'Lumière', width: 9, optional: true },
  grip: { key: 'grip', label: 'Machinerie', width: 10, optional: true },
  shotDuration: { key: 'shotDuration', label: 'Durée', width: 5, optional: true },
  shootingDay: { key: 'shootingDay', label: 'Jour', width: 4, optional: true },
  status: { key: 'status', label: 'Statut', width: 6, optional: true },
  notes: { key: 'notes', label: 'Image', width: 12, optional: true },
};

/**
 * Colonnes retirées du découpage : Personnages et Durée doublonnent Sujet et TC ; Lumière et
 * Machinerie n'ont pas leur place dans un découpage technique. Les données restent dans le projet.
 */
export const RETIRED_COLUMNS: readonly ColumnKey[] = ['characters', 'light', 'grip', 'shotDuration'];

/** Retire les colonnes abandonnées d'une liste enregistrée. */
export const activeColumns = (cols: readonly ColumnKey[]): ColumnKey[] => cols.filter((c) => !RETIRED_COLUMNS.includes(c));

/** Ordre canonique des colonnes : l'ouverture se range juste après la focale. */
export const ALL_COLUMNS: readonly ColumnKey[] = (() => {
  const all = activeColumns([...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS.filter((c) => c !== 'aperture')] as ColumnKey[]);
  all.splice(all.indexOf('focal') + 1, 0, 'aperture');
  return all;
})();

/** Largeurs relatives normalisées à 100 % pour un jeu de colonnes (§8.2). */
export function columnWidths(columns: readonly ColumnKey[]): Record<string, number> {
  const total = columns.reduce((acc, c) => acc + COLUMN_DEFS[c].width, 0) || 1;
  return Object.fromEntries(columns.map((c) => [c, (COLUMN_DEFS[c].width / total) * 100]));
}

/** La colonne TC reste toujours la dernière, quelles que soient les colonnes ajoutées. */
export function tcLast<T extends string>(cols: readonly T[]): T[] {
  return [...cols.filter((c) => c !== 'tc'), ...cols.filter((c) => c === 'tc')];
}

/**
 * Afficher une colonne dans la grille l'ajoute aux colonnes exportées (à sa place naturelle, après
 * la colonne exportée qui la précède), la masquer l'en retire.
 */
export function syncExportColumn(exportCols: readonly ColumnKey[], col: ColumnKey, shown: boolean): ColumnKey[] {
  if (!shown) return exportCols.filter((c) => c !== col);
  if (exportCols.includes(col)) return [...exportCols];
  const rank = ALL_COLUMNS.indexOf(col);
  let at = 0;
  exportCols.forEach((c, i) => {
    if (ALL_COLUMNS.indexOf(c) < rank) at = i + 1;
  });
  return tcLast([...exportCols.slice(0, at), col, ...exportCols.slice(at)]);
}

/** Colonnes figées en tête (SÉQUENCE, N°) et en fin (TC) : les autres se réordonnent entre elles. */
const PINNED: readonly ColumnKey[] = ['sequence', 'number', 'tc'];
export const isMovableColumn = (c: ColumnKey) => !PINNED.includes(c);

/** Déplace une colonne d'un cran vers la gauche (-1) ou la droite (+1), sans franchir les colonnes figées. */
export function moveColumn(cols: readonly ColumnKey[], col: ColumnKey, delta: -1 | 1): ColumnKey[] {
  const out = [...cols];
  const i = out.indexOf(col);
  const j = i + delta;
  if (i < 0 || !isMovableColumn(col) || j < 0 || j >= out.length || !isMovableColumn(out[j])) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Aligne l'ordre de l'export sur celui de la grille pour les colonnes présentes dans les deux. */
export function followOrder(exportCols: readonly ColumnKey[], gridCols: readonly ColumnKey[]): ColumnKey[] {
  const shared = gridCols.filter((c) => exportCols.includes(c));
  let k = 0;
  return tcLast(exportCols.map((c) => (gridCols.includes(c) ? shared[k++] : c)));
}
