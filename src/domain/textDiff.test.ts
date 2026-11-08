import { describe, expect, it } from 'vitest';
import { equalRuns, offsetMapper, shiftOffset } from './textDiff';

describe('correspondance des positions', () => {
  it('Myers : suites de lignes communes', () => {
    expect(equalRuns(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])).toEqual([
      { a: 0, b: 0, n: 1 },
      { a: 2, b: 2, n: 2 },
    ]);
    expect(equalRuns(['a', 'b'], ['a', 'b'])).toEqual([{ a: 0, b: 0, n: 2 }]);
    expect(equalRuns([], ['x'])).toEqual([]);
  });

  it('ajout juste avant un passage : le passage suit son texte', () => {
    expect(shiftOffset(10, 10, 0, 5, 'start')).toBe(15);
    expect(shiftOffset(10, 10, 0, 5, 'end')).toBe(10);
    const before = 'Fin de scène.\n\nINT. GARE - JOUR\n\nTexte.';
    const after = 'Fin de scène.\n\nElle s’arrête.\n\nINT. GARE - JOUR\n\nTexte.';
    const map = offsetMapper(before, after);
    const at = before.indexOf('INT.');
    expect(after.slice(map(at, 'start'), map(at, 'start') + 4)).toBe('INT.');
    const end = before.indexOf('scène.') + 6;
    expect(map(end, 'end')).toBe(end);
  });

  it('deux modifications éloignées ne déplacent pas les passages intacts', () => {
    const before = 'Un chat dort.\n\nLéa le rejoint.\n\nMarc part.\n\nFin.';
    const after = 'Un chien dort.\n\nLéa le rejoint.\n\nMarc s’en va.\n\nFin.';
    const map = offsetMapper(before, after);
    const a = before.indexOf('Léa');
    const b = a + 'Léa le rejoint.'.length;
    expect(after.slice(map(a, 'start'), map(b, 'end'))).toBe('Léa le rejoint.');
    const f = before.indexOf('Fin.');
    expect(after.slice(map(f, 'start'), map(f, 'start') + 4)).toBe('Fin.');
  });

  it('modification dans un passage : bornes recalées dans la ligne', () => {
    const before = 'Elle hésite, puis glisse le ticket.';
    const after = 'Elle hésite longtemps, puis glisse le ticket.';
    const map = offsetMapper(before, after);
    expect(map(before.length, 'end')).toBe(after.length);
    expect(map(0, 'start')).toBe(0);
  });
});
