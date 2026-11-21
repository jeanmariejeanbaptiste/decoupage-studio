import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { sequenceIdByNumber, sequenceNumber, shotCode } from './numbering';
import { addSequence, addShot } from './ops';
describe('numéros du scénario', () => {
  it('une séquence garde le numéro de sa scène, même s’il en manque entre deux ; les plans suivent', () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    const scenes = ['BUREAU', 'COULOIR', 'ACCUEIL', 'CAFÉTÉRIA', 'OPEN SPACE'];
    doc.scenario = scenes.map((l) => `INT. ${l} - JOUR\n\nTexte.\n`).join('\n');
    // Découpage : 1, 3 et 5 seulement, plus une séquence hors du scénario après la 3 (numéro bis).
    for (const l of ['BUREAU', 'ACCUEIL', 'RUE', 'OPEN SPACE']) {
      const id = addSequence(doc, undefined, { label: l }, false);
      addShot(doc, id);
      addShot(doc, id);
    }
    const ids = doc.project.sequenceIds;
    expect(ids.map((id) => sequenceNumber(doc, id))).toEqual([1, 3, '3A', 5]);
    expect(shotCode(doc, doc.sequences[ids[3]].shotIds[1])).toBe('5.2');
    expect(sequenceIdByNumber(doc, 5)).toBe(ids[3]);
    expect(shotCode(doc, doc.sequences[ids[2]].shotIds[0])).toBe('3A.1');
    expect(sequenceIdByNumber(doc, '3a')).toBe(ids[2]);
  });
  it('sans scénario : la position', () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    const a = addSequence(doc, undefined, { label: 'A' }, false);
    const b = addSequence(doc, undefined, { label: 'B' }, false);
    expect([sequenceNumber(doc, a), sequenceNumber(doc, b)]).toEqual([1, 2]);
  });
});
