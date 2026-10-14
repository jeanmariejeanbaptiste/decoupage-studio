import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { computeMerges, repeatedFlags, type MergeRow, type MergeSpan } from './merge';
import { sequenceMerges } from './rows';
import { computeTiming } from './timing';
import { DEFAULT_COLUMNS, type ColumnKey } from './types';

/** « 1-3,4,5-6 » : blocs attendus, numérotation 1-based. */
function blocks(spans: readonly MergeSpan[]): string {
  return spans.map((s) => (s.span === 1 ? `${s.startRow + 1}` : `${s.startRow + 1}-${s.startRow + s.span}`)).join(',');
}

const singles = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}`).join(',');

const EXPECTED: Array<{ label: string; n: number; cols: Partial<Record<ColumnKey, string>> }> = [
  {
    label: '1, CHAMBRE ADMIRATRICE',
    n: 6,
    cols: { subject: '1-4,5,6', value: singles(6), angle: '1,2-3,4,5,6', movement: '1,2-3,4,5,6', focal: '1-6', action: '1-3,4,5,6', tc: '1-6' },
  },
  {
    label: '2, PARC DES COQUELICOTS',
    n: 8,
    cols: { subject: '1,2-8', value: singles(8), angle: '1,2-3,4-5,6-8', movement: '1,2-5,6-7,8', focal: '1-8', action: '1-3,4-5,6-8', tc: '1-3,4-8' },
  },
  {
    label: '3, JARDIN SQY',
    n: 4,
    cols: { subject: '1-4', value: singles(4), angle: '1-3,4', movement: '1-4', focal: '1-4', action: '1-4', tc: '1-4' },
  },
  {
    label: '4, LOGE',
    n: 6,
    cols: { subject: '1-6', value: '1-6', angle: '1-6', movement: '1-6', focal: '1-6', action: singles(6), tc: '1-6' },
  },
  {
    label: '5, ROND POINT SQY',
    n: 4,
    cols: { subject: '1-4', value: singles(4), angle: '1-3,4', movement: '1-4', focal: '1-4', action: '1-4', tc: '1-4' },
  },
  {
    label: '6, ESCALIERS SQY',
    n: 10,
    cols: { subject: '1-10', value: singles(10), angle: '1-4,5-10', movement: '1-4,5-8,9-10', focal: '1-10', action: '1-8,9-10', tc: '1-10' },
  },
  {
    label: '7, SALLE DE CONCERT',
    n: 15,
    cols: {
      subject: '1-9,10-15',
      value: '1,2,3,4,5,6,7,8,9,10-11,12-13,14,15',
      angle: '1-2,3,4-6,7,8,9,10-11,12-15',
      movement: '1,2,3,4-6,7-10,11,12-15',
      focal: '1-2,3,4-6,7,8-9,10-15',
      action: '1-3,4-7,8,9,10-15',
      tc: '1-15',
    },
  },
];

describe('computeMerges — seed RAV3, colonne par colonne', () => {
  const doc = buildRav3();
  const timing = computeTiming(doc);
  doc.project.sequenceIds.forEach((seqId, i) => {
    const exp = EXPECTED[i];
    it(`séquence ${exp.label}`, () => {
      const { rows, merges } = sequenceMerges(doc, timing, seqId, DEFAULT_COLUMNS);
      expect(rows).toHaveLength(exp.n);
      expect(merges.get('sequence')![0]).toEqual({ startRow: 0, span: exp.n, value: exp.label });
      expect(blocks(merges.get('number')!)).toBe(singles(exp.n));
      for (const [col, want] of Object.entries(exp.cols)) {
        expect(blocks(merges.get(col as ColumnKey)!), `${exp.label} / ${col}`).toBe(want);
      }
    });
  });

  it('rend les valeurs exactes de la référence', () => {
    const [s1, s2, , , s5, , s7] = doc.project.sequenceIds;
    const m1 = sequenceMerges(doc, timing, s1, DEFAULT_COLUMNS).merges;
    expect(m1.get('angle')!.map((s) => s.value)).toEqual([
      'Face, Hauteur regard',
      '3/4 Face, Hauteur regard',
      '3/4 Dos',
      'Plongé',
      'Hauteur regard, Profil',
    ]);
    expect(m1.get('movement')![0].value).toBe('Tilt haut, trav avant');
    expect(m1.get('focal')![0].value).toBe('16mm');
    expect(m1.get('tc')![0].value).toBe('0:00 - 0:35');
    const m2 = sequenceMerges(doc, timing, s2, DEFAULT_COLUMNS).merges;
    expect(m2.get('tc')!.map((s) => s.value)).toEqual(['0:00 - 0:51', 'TOUT']);
    expect(m2.get('angle')![0].value).toBe('-');
    const m5 = sequenceMerges(doc, timing, s5, DEFAULT_COLUMNS).merges;
    expect(m5.get('movement')![0].value).toBe('Trav circulaire + suivi');
    const m7 = sequenceMerges(doc, timing, s7, DEFAULT_COLUMNS).merges;
    expect(m7.get('angle')![0].value).toBe('Dos, contre plongée');
    expect(m7.get('movement')![1].value).toBe('Trav. avant, Trav. circulaire');
    expect(m7.get('action')![3].value).toBe('Dernière parole "ma vedette"');
    expect(m7.get('tc')![0].value).toBe('2:00 - 3:01');
  });
});

describe('computeMerges — règles générales', () => {
  const row = (blockId: string, cells: Partial<Record<ColumnKey, string>>, mergeBreak?: ColumnKey[]): MergeRow => ({
    shotId: Math.random().toString(),
    blockId,
    cells,
    mergeBreak,
  });
  const rows = [
    row('a', { subject: 'Léa', action: 'X', tc: '0:10', sound: 'IN' }),
    row('b', { subject: ' léa ', action: 'X', tc: '0:10', sound: 'IN' }),
    row('b', { subject: 'Léa', action: 'X', tc: '0:20', sound: 'IN' }, ['subject']),
  ];
  it('fusionne ACTION par identité de bloc, pas par texte', () => {
    const m = computeMerges(rows, ['action'], { tcMode: 'cumulatif', tcGranularity: 'sequence' });
    expect(blocks(m.get('action')!)).toBe('1,2-3');
  });
  it('respecte la coupure de fusion forcée et la normalisation', () => {
    const m = computeMerges(rows, ['subject'], { tcMode: 'cumulatif', tcGranularity: 'sequence' });
    expect(blocks(m.get('subject')!)).toBe('1-2,3');
  });
  it('fusionne TC selon la granularité ou la valeur', () => {
    const opts = { tcMode: 'cumulatif', tcGranularity: 'sequence' } as const;
    expect(blocks(computeMerges(rows, ['tc'], opts).get('tc')!)).toBe('1-3');
    expect(blocks(computeMerges(rows, ['tc'], { ...opts, tcGranularity: 'action' }).get('tc')!)).toBe('1,2-3');
    expect(blocks(computeMerges(rows, ['tc'], { ...opts, tcMode: 'piste' }).get('tc')!)).toBe('1-2,3');
  });
  it('« ne jamais fusionner » par colonne, sauf SÉQUENCE', () => {
    const m = computeMerges(rows, ['sound', 'sequence'], { tcMode: 'piste', tcGranularity: 'action', neverMerge: ['sound', 'sequence'] });
    expect(blocks(m.get('sound')!)).toBe('1,2,3');
    expect(blocks(m.get('sequence')!)).toBe('1-3');
  });
  it('signale les lignes répétées pour l’aperçu 〃', () => {
    expect(repeatedFlags([{ startRow: 0, span: 2, value: 'a' }, { startRow: 2, span: 1, value: 'b' }], 3)).toEqual([false, true, false]);
  });
});
