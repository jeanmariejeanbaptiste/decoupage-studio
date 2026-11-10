import { describe, expect, it } from 'vitest';
import { sheetChoices, sheetLayout, sheetPerPage } from './storyboardSheet';

describe('planches du storyboard', () => {
  it('16:9 : 1, 4, 9 en paysage ; 2, 6 en portrait', () => {
    expect(sheetChoices(16 / 9, 'landscape')).toEqual([1, 4, 9]);
    expect(sheetChoices(16 / 9, 'portrait')).toEqual([2, 6]);
  });
  it('formats verticaux : la logique se retourne', () => {
    expect(sheetChoices(9 / 16, 'portrait')).toEqual([6]);
    expect(sheetChoices(3 / 4, 'portrait')).toEqual([1, 4, 9]);
  });
  it('jamais vide, même pour un format extrême', () => {
    for (const r of [0.2, 0.5, 3, 5]) for (const o of ['landscape', 'portrait'] as const) expect(sheetChoices(r, o).length).toBeGreaterThan(0);
  });
  it('grille et marges : 16:9 portrait en 6 = 2 × 3, reste plus grand en bas qu’en haut', () => {
    const l = sheetLayout(6, 16 / 9, 'portrait');
    expect([l.cols, l.rows]).toEqual([2, 3]);
    expect(l.bottom).toBeGreaterThan(l.top);
    expect(l.top).toBeGreaterThan(0);
  });
  it('choix enregistré gardé s’il vaut encore, sinon le plus proche', () => {
    expect(sheetPerPage(4, [1, 4, 9])).toBe(4);
    expect(sheetPerPage(3, [1, 4, 9])).toBe(4);
    expect(sheetPerPage(4, [2, 6])).toBe(6);
    expect(sheetPerPage(undefined, [2, 6])).toBe(6);
  });
});
