import type { ColumnKey } from './types';

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
  characters: { key: 'characters', label: 'Personnages', width: 9, optional: true },
  dialogue: { key: 'dialogue', label: 'Dialogue', width: 16, optional: true },
  sound: { key: 'sound', label: 'Son', width: 7, optional: true },
  light: { key: 'light', label: 'Lumière', width: 9, optional: true },
  grip: { key: 'grip', label: 'Machinerie', width: 10, optional: true },
  shotDuration: { key: 'shotDuration', label: 'Durée', width: 5, optional: true },
  shootingDay: { key: 'shootingDay', label: 'Jour', width: 4, optional: true },
  status: { key: 'status', label: 'Statut', width: 6, optional: true },
  notes: { key: 'notes', label: 'Notes', width: 12, optional: true },
};

/** Largeurs relatives normalisées à 100 % pour un jeu de colonnes (§8.2). */
export function columnWidths(columns: readonly ColumnKey[]): Record<string, number> {
  const total = columns.reduce((acc, c) => acc + COLUMN_DEFS[c].width, 0) || 1;
  return Object.fromEntries(columns.map((c) => [c, (COLUMN_DEFS[c].width / total) * 100]));
}
