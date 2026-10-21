import { describe, expect, it } from 'vitest';
import { cleanCuts, paginate, sliceMerges } from './pagination';
import type { MergeMap } from './merge';

describe('pagination de l’impression', () => {
  it('garde les séquences entières quand elles tiennent', () => {
    const pages = paginate([[30, 30], [30, 30], [30]], 120, { gap: 5 });
    expect(pages).toEqual([[{ seq: 0, from: 0, to: 2 }], [{ seq: 1, from: 0, to: 2 }, { seq: 2, from: 0, to: 1 }]]);
  });
  it('coupe une séquence trop longue sur une coupure propre et ne coupe jamais une ligne', () => {
    const rows = [Array(10).fill(20)];
    const cuts = [[true, false, false, true, false, false, true, false, false, true, true]];
    const pages = paginate(rows, 110, { cuttable: cuts });
    expect(pages.map((p) => [p[0].from, p[0].to])).toEqual([[0, 3], [3, 6], [6, 10]]);
    // Tient compte du titre en page 1, et d'une ligne plus haute qu'une page.
    expect(paginate([[50], [500]], 100, { firstOffset: 60 })).toEqual([[{ seq: 0, from: 0, to: 1 }], [{ seq: 1, from: 0, to: 1 }]]);
  });
  it('restreint les fusions à une page', () => {
    const m: MergeMap = new Map([['value', [{ startRow: 0, span: 4, value: 'Taille' }]]]);
    expect(sliceMerges(m, ['value'], 2, 5).get('value')).toEqual([{ startRow: 0, span: 2, value: 'Taille' }]);
    expect(cleanCuts(m, ['value'], 4)).toEqual([true, false, false, false, true]);
  });
});
