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

describe('ordre des colonnes', () => {
  const g: ColumnKey[] = ['sequence', 'number', 'subject', 'action', 'dialogue', 'sound', 'tc'];
  it('déplace une colonne sans franchir N° ni TC', async () => {
    const { moveColumn } = await import('./columns');
    expect(moveColumn(g, 'sound', -1)).toEqual(['sequence', 'number', 'subject', 'action', 'sound', 'dialogue', 'tc']);
    expect(moveColumn(g, 'subject', -1)).toEqual(g);
    expect(moveColumn(g, 'sound', 1)).toEqual(g);
  });
  it('reporte l’ordre de la grille sur l’export', async () => {
    const { followOrder } = await import('./columns');
    const exp: ColumnKey[] = ['sequence', 'number', 'subject', 'action', 'focal', 'dialogue', 'sound', 'tc'];
    const grid: ColumnKey[] = ['sequence', 'number', 'subject', 'sound', 'action', 'dialogue', 'tc'];
    expect(followOrder(exp, grid)).toEqual(['sequence', 'number', 'subject', 'sound', 'focal', 'action', 'dialogue', 'tc']);
  });
});
