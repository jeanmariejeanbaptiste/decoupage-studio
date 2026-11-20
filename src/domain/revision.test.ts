import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { reviseScenario } from './revision';
import { checkInvariants } from './ops';

describe('nouvelle version du scénario, intitulés inchangés', () => {
  it('actions reformulées : mêmes séquences, mêmes plans, rien de dupliqué', () => {
    const doc = buildFiction();
    const seqs = [...doc.project.sequenceIds];
    const shots = seqs.map((id) => [...doc.sequences[id].shotIds]);
    const v2 = (doc.scenario ?? '')
      .replace('Le hall bruisse, les annonces se succèdent.', 'Dans le hall, les annonces s’enchaînent sans arrêt.')
      .replace('Léa pose la valise sur le comptoir.', 'Léa dépose sa valise sur le comptoir, essoufflée.');
    const r = reviseScenario(doc, v2);
    expect(doc.scenario).toBe(v2);
    expect(doc.project.sequenceIds).toEqual(seqs);
    expect(seqs.map((id) => doc.sequences[id].shotIds)).toEqual(shots);
    expect(r).toMatchObject({ kept: 3, added: 0, removed: 0, created: 0 });
    expect(checkInvariants(doc)).toEqual([]);
  });
});
