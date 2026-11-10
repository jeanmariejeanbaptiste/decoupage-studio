import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addBreakdownItems } from './breakdown';
import { cleanTag, findTerm, foldKeepLength, marksIn, marksWith, sceneRangeOf, tagContext } from './tagging';

describe('dépouillement depuis le texte', () => {
  it('replie sans changer la longueur', () => {
    expect(foldKeepLength('Élève À LA Gare')).toBe('eleve a la gare');
    expect(foldKeepLength('œuvre')).toHaveLength(5);
  });

  it('trouve un terme en mot entier, pluriel compris', () => {
    const t = 'Deux valises. Une Valise cabossée ; les valisettes non.';
    expect(findTerm(t, 'valise').map(([a, b]) => t.slice(a, b))).toEqual(['valises', 'Valise']);
    expect(findTerm(t, 'valise cabossée')).toEqual([[18, 33]]);
  });

  it('nettoie une sélection', () => {
    expect(cleanTag(' « une valise cabossée », ')).toBe('Une valise cabossée');
    expect(cleanTag('...')).toBe('');
  });

  it('passage de la scène et repères', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[1];
    const r = sceneRangeOf(doc, seqId)!;
    const text = doc.scenario!.slice(r.start, r.end);
    expect(text.startsWith('INT. GARE — CONSIGNE')).toBe(true);
    addBreakdownItems(doc, seqId, 'accessoires', ['Ticket']);
    const marks = marksIn(doc, seqId, text);
    expect(marks.some((m) => m.item === 'Ticket' && !m.suggested)).toBe(true);
    expect(marks.some((m) => m.item === 'Valise' && m.suggested)).toBe(true);
  });
});

describe('repères : déduits ou saisis', () => {
  it('un personnage nommé par les plans est déduit ; un élément saisi se retire', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    addBreakdownItems(doc, seqId, 'accessoires', ['Valise']);
    const marks = marksIn(doc, seqId, 'Léa porte une valise.');
    expect(marks.find((m) => m.item === 'Léa')).toMatchObject({ cat: 'personnages', derived: true });
    expect(marks.find((m) => m.item === 'Valise')?.derived).toBeUndefined();
    // Un personnage ajouté à la séquence (pas à ses plans) se retire d'ici.
    addBreakdownItems(doc, seqId, 'personnages', ['Marc']);
    expect(marksIn(doc, seqId, 'Marc arrive.').find((m) => m.item === 'Marc')?.derived).toBeUndefined();
  });

  it('le contexte d’une séquence sert tous ses paragraphes', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[2];
    const ctx = tagContext(doc, seqId);
    for (const t of ['Marc attend sous la pluie.', 'Une cigarette éteinte.']) expect(marksWith(ctx, t)).toEqual(marksIn(doc, seqId, t));
  });
});
