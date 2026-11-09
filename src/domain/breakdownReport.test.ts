import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addBreakdownItems } from './breakdown';
import { breakdownIndex, itemCountBySequence, sequenceCounts } from './breakdownReport';
import { computeTiming } from './timing';

describe('index du dépouillement', () => {
  const doc = produce(buildFiction(), (d) => {
    const [s1, s2, s3] = d.project.sequenceIds;
    addBreakdownItems(d, s1, 'accessoires', ['Valise']);
    addBreakdownItems(d, s2, 'accessoires', ['valise', 'Ticket']);
    addBreakdownItems(d, s3, 'effets', ['Pluie']);
    d.shots[d.sequences[s2].shotIds[0]].shootingDay = 2;
  });
  const [s1, s2, s3] = doc.project.sequenceIds;
  const index = breakdownIndex(doc, computeTiming(doc));

  it('un élément, toutes ses séquences (casse ignorée), sa durée et ses jours', () => {
    const valise = index.find((e) => e.item === 'Valise')!;
    expect(valise.cat).toBe('accessoires');
    expect(valise.seqIds).toEqual([s1, s2]);
    expect(valise.manualSeqIds).toEqual([s1, s2]);
    expect(valise.days).toEqual([2]);
    expect(valise.totalSec).toBeGreaterThan(0);
  });

  it('par catégorie dans l’ordre du dépouillement, éléments du découpage compris', () => {
    const cats = index.map((e) => e.cat);
    expect(cats.indexOf('personnages')).toBeLessThan(cats.indexOf('accessoires'));
    expect(cats.indexOf('accessoires')).toBeLessThan(cats.indexOf('effets'));
    const lea = index.find((e) => e.cat === 'personnages' && e.item === 'Léa');
    expect(lea?.seqIds.length).toBe(3);
    expect(lea?.manualSeqIds).toEqual([]);
  });

  it('comptes par séquence', () => {
    expect(sequenceCounts(index, s2).get('accessoires')).toBe(2);
    expect(sequenceCounts(index, s3).get('effets')).toBe(1);
  });

  it('total par séquence : éléments saisis et déduits, égal à la somme des comptes par catégorie', () => {
    const totals = itemCountBySequence(index);
    for (const id of [s1, s2, s3]) {
      const sum = [...sequenceCounts(index, id).values()].reduce((a, b) => a + b, 0);
      expect(totals.get(id)).toBe(sum);
    }
    // Léa vient des plans, Valise est saisie : la séquence 1 compte au moins les deux.
    expect(totals.get(s1)).toBeGreaterThanOrEqual(2);
  });
});
