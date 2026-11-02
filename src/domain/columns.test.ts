import { describe, expect, it } from 'vitest';
import { syncExportColumn } from './columns';
import type { ColumnKey } from './types';

describe('colonnes exportées suivant la grille', () => {
  const base: ColumnKey[] = ['sequence', 'number', 'subject', 'action', 'tc'];
  it('ajoute une colonne affichée à sa place naturelle, le TC restant à la fin', () => {
    const out = syncExportColumn(base, 'dialogue', true);
    expect(out.indexOf('dialogue')).toBeGreaterThan(out.indexOf('action'));
    expect(out.at(-1)).toBe('tc');
    expect(out).toHaveLength(6);
  });
  it('n’ajoute pas deux fois et retire une colonne masquée', () => {
    expect(syncExportColumn(base, 'subject', true)).toEqual(base);
    expect(syncExportColumn(base, 'subject', false)).toEqual(['sequence', 'number', 'action', 'tc']);
  });
});
