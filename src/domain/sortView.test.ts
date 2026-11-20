import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { sequenceHeading, shotCode } from './numbering';
import { sortedDoc } from './sortView';
import { valueRank } from './vocabulary';

describe('découpage trié pour le tournage', () => {
  const doc = buildRav3();
  const codes = (d: ReturnType<typeof sortedDoc>) => d.project.sequenceIds.flatMap((sid) => d.sequences[sid].shotIds.map((id) => shotCode(d, id)));

  it('tout le film, du plus large au plus serré, numéros d’origine gardés', () => {
    const v = sortedDoc(doc, { criteria: [{ key: 'value' }], scope: 'film' });
    const ids = v.project.sequenceIds.flatMap((sid) => v.sequences[sid].shotIds);
    const ranks = ids.map((id) => valueRank(doc.shots[id].value)).map((r) => (r < 0 ? 999 : r));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // Mêmes plans, mêmes codes qu'avant le tri (seul l'ordre change).
    const before = doc.project.sequenceIds.flatMap((sid) => doc.sequences[sid].shotIds.map((id) => shotCode(doc, id)));
    expect([...codes(v)].sort()).toEqual([...before].sort());
    expect(codes(v)).not.toEqual(before);
    // Une séquence coupée par le tri garde son numéro d'origine.
    for (const sid of v.project.sequenceIds) expect(sequenceHeading(v, sid)).toBe(sequenceHeading(doc, v.sequences[sid].id.split('~')[0]));
  });

  it('par séquence et sur une sélection : chaque séquence garde ses plans, triés chez elle', () => {
    const pick = doc.project.sequenceIds.slice(1, 3);
    const v = sortedDoc(doc, { criteria: [{ key: 'value', desc: true }], scope: 'sequence', seqIds: pick });
    expect(v.project.sequenceIds).toEqual(pick);
    for (const sid of pick) expect([...v.sequences[sid].shotIds].sort()).toEqual([...doc.sequences[sid].shotIds].sort());
    expect(v.project.settings.exportColumns).not.toContain('tc');
  });

  it('plusieurs critères : fixes d’abord, puis par focale', () => {
    const v = sortedDoc(doc, { criteria: [{ key: 'movement' }, { key: 'focal' }], scope: 'film' });
    const ids = v.project.sequenceIds.flatMap((sid) => v.sequences[sid].shotIds);
    const firstMoving = ids.findIndex((id) => doc.shots[id].movement.some((m) => m && m !== 'Fixe'));
    expect(ids.slice(firstMoving).some((id) => !doc.shots[id].movement.length || doc.shots[id].movement.every((m) => m === 'Fixe'))).toBe(false);
  });
});
