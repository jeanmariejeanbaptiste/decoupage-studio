import { describe, expect, it } from 'vitest';
import { TRUBY_STEPS, stepLabel } from './truby';

describe('étapes de Truby', () => {
  it('compte vingt-deux étapes dans l’ordre, dont sept clés', () => {
    expect(TRUBY_STEPS).toHaveLength(22);
    expect(TRUBY_STEPS.map((s) => s.n)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    expect(TRUBY_STEPS.filter((s) => s.key).map((s) => s.n)).toEqual([3, 5, 7, 10, 19, 20, 22]);
    expect(TRUBY_STEPS[3].label).toBe('Événement déclencheur');
    expect(TRUBY_STEPS[21].label).toBe('Nouvel équilibre');
  });

  it('donne le libellé d’un numéro, d’un texte numérique, et rend tel quel une valeur inconnue', () => {
    expect(stepLabel(9)).toBe('Première révélation et décision');
    expect(stepLabel('9')).toBe('Première révélation et décision');
    expect(stepLabel(23)).toBe('23');
    expect(stepLabel('climax')).toBe('climax');
  });
});
