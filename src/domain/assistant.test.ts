import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { applyProposal, buildUserPrompt, parseProposal, proposalSchema, sequenceSourceText } from './assistant';
import { checkInvariants } from './ops';

describe('assistant de découpage', () => {
  const doc = buildFiction();
  const seq = doc.project.sequenceIds[2];

  it('impose le vocabulaire du §5 dans le schéma', () => {
    const s = JSON.stringify(proposalSchema());
    expect(s).toContain('"Gros plan"');
    expect(s).toContain('"Hauteur regard"');
    expect(s).toContain('"Trav circulaire"');
  });

  it('construit la demande à partir du scénario lié', () => {
    expect(sequenceSourceText(doc, seq)).toContain('Marc attend sous la pluie');
    expect(buildUserPrompt(doc, seq)).toContain('PARVIS DE LA GARE (EXT · NUIT)');
    const noScenario = produce(doc, (d) => void (d.scenario = undefined));
    expect(sequenceSourceText(noScenario, seq)).toContain('Léa le rejoint.');
    expect(sequenceSourceText(doc, 'x')).toBe('');
  });

  it('écarte tout terme hors vocabulaire', () => {
    const shots = parseProposal({
      shots: [
        { subject: 'Marc', value: 'Gros plan', angle: ['Face', 'Hauteur regard', 'Bizarre'], movement: ['Trav avant'], focal: 85, action: 'Il attend.' },
        { subject: 'Marc', value: 'Plan mystère', angle: [], movement: [], focal: 50, action: 'x' },
        { subject: 3, value: 'taille', angle: 'Face', movement: [1], focal: -1, action: null },
      ],
    });
    expect(shots).toEqual([
      { subject: 'Marc', value: 'Gros plan', angle: ['Face', 'Hauteur regard'], movement: ['Trav avant'], focal: 85, action: 'Il attend.' },
      { subject: '', value: 'Taille', angle: [], movement: [], focal: 35, action: '' },
    ]);
    expect(() => parseProposal({})).toThrow();
  });

  it('insère les plans proposés en liant les actions identiques', () => {
    const shots = parseProposal({
      shots: [
        { subject: 'Marc', value: 'Ensemble', angle: ['Face'], movement: ['Fixe'], focal: 24, action: 'Marc attend.' },
        { subject: 'Marc', value: 'Gros plan', angle: ['Face'], movement: ['Fixe'], focal: 85, action: 'Marc attend.' },
        { subject: 'Léa', value: 'Moyen', angle: ['Profil gauche'], movement: ['Suivi'], focal: 35, action: 'Léa arrive.' },
      ],
    });
    const next = produce(doc, (d) => void applyProposal(d, seq, shots));
    const s = next.sequences[seq];
    expect(s.shotIds).toHaveLength(6);
    const [a, b, c] = s.shotIds.slice(3).map((id) => next.shots[id]);
    expect(a.actionBlockId).toBe(b.actionBlockId);
    expect(c.actionBlockId).not.toBe(b.actionBlockId);
    expect(checkInvariants(next)).toEqual([]);
  });
});
