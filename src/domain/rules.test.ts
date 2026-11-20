import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { setCellText } from './cells';
import { cellText } from './rows';
import { effectiveShot, ruleFor } from './rules';
import { computeTiming } from './timing';

describe('règles si… alors…', () => {
  it('remplit une cellule vide, jamais une cellule saisie ; la plus précise gagne', () => {
    const doc = buildFiction();
    const [seqA, seqB] = doc.project.sequenceIds;
    const a = doc.shots[doc.sequences[seqA].shotIds[0]];
    const b = doc.shots[doc.sequences[seqB].shotIds[0]];
    setCellText(doc, a.id, 'focal', '');
    setCellText(doc, b.id, 'focal', '');
    setCellText(doc, a.id, 'value', 'Insert');
    doc.rules = [
      { id: 'd', then: { col: 'focal', value: '35' } },
      { id: 'i', when: { col: 'value', value: 'insert' }, then: { col: 'focal', value: '100' } },
      { id: 's', seqId: seqB, then: { col: 'focal', value: '24' } },
    ];
    expect(ruleFor(doc, a, 'focal')?.id).toBe('i');
    expect(ruleFor(doc, b, 'focal')?.id).toBe('s');
    const t = computeTiming(doc);
    expect(cellText(doc, t, a, 'focal', 0)).toBe('100mm');
    expect(effectiveShot(doc, a).shot.focal.from).toBe(100);
    // Saisie : la règle s'efface.
    setCellText(doc, a.id, 'focal', '50');
    expect(ruleFor(doc, a, 'focal')).toBeUndefined();
    // Règle désactivée : plus rien.
    doc.rules.find((r) => r.id === 's')!.off = true;
    expect(ruleFor(doc, b, 'focal')?.id).toBe('d');
  });
  it('angles et mouvements : la condition se lit jeton par jeton', () => {
    const doc = buildFiction();
    const sh = doc.shots[doc.sequences[doc.project.sequenceIds[0]].shotIds[1]];
    setCellText(doc, sh.id, 'movement', 'Steadicam, Trav arrière');
    setCellText(doc, sh.id, 'sound', '');
    doc.rules = [{ id: 'm', when: { col: 'movement', value: 'steadicam' }, then: { col: 'sound', value: 'Perche' } }];
    expect(ruleFor(doc, sh, 'sound')?.id).toBe('m');
  });
});

import { freeze } from 'immer';
describe('règles sur un document figé', () => {
  it('se calculent sans écrire dans le document', () => {
    const doc = buildFiction();
    const sh = doc.shots[doc.sequences[doc.project.sequenceIds[0]].shotIds[0]];
    setCellText(doc, sh.id, 'sound', '');
    doc.rules = [{ id: 'x', then: { col: 'sound', value: 'Ambiance' } }];
    const frozen = freeze(doc, true);
    expect(effectiveShot(frozen, frozen.shots[sh.id]).shot.sound).toBe('Ambiance');
    expect(frozen.shots[sh.id].sound).toBeFalsy();
  });
});
