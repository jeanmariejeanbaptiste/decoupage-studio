import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addDecor, characterStats, decorStats, deleteCharacter, deleteDecor, sequenceProgress, setSequenceDecorByName } from './registry';
import { computeTiming } from './timing';

describe('registre', () => {
  const doc = buildRav3();
  const byName = (n: string) => Object.values(doc.characters).find((c) => c.name === n)!.id;

  it('statistiques des personnages', () => {
    const st = characterStats(doc);
    expect(st.get(byName('Candice'))!.sequenceIds).toHaveLength(4);
    expect(st.get(byName('Vedette'))!.shotIds).toHaveLength(15);
    expect(st.get(byName('Maquilleuse'))!.shotIds).toHaveLength(0);
  });

  it('statistiques des décors et avancement', () => {
    const t = computeTiming(doc);
    const st = decorStats(doc, t);
    const loge = doc.sequences[doc.project.sequenceIds[3]].decorId!;
    expect(st.get(loge)).toEqual({ sequenceIds: [doc.project.sequenceIds[3]], totalSec: 16 });
    const s1 = doc.project.sequenceIds[0];
    const next = produce(doc, (d) => {
      d.shots[d.sequences[s1].shotIds[0]].status = 'tourné';
      d.shots[d.sequences[s1].shotIds[1]].status = 'abandonné';
    });
    expect(sequenceProgress(next, s1)).toEqual({ done: 1, total: 5 });
    expect(sequenceProgress(next, 'x')).toEqual({ done: 0, total: 0 });
  });

  it('crée, rattache et supprime décors et personnages', () => {
    const s1 = doc.project.sequenceIds[0];
    const next = produce(doc, (d) => {
      setSequenceDecorByName(d, s1, 'loge');
      setSequenceDecorByName(d, 'x', 'rien');
    });
    expect(next.sequences[s1].decorId).toBe(doc.sequences[doc.project.sequenceIds[3]].decorId);
    const created = produce(doc, (d) => setSequenceDecorByName(d, s1, 'Nouveau lieu'));
    expect(Object.keys(created.decors)).toHaveLength(8);
    const cleared = produce(doc, (d) => setSequenceDecorByName(d, s1, ' '));
    expect(cleared.sequences[s1].decorId).toBeUndefined();
    const removed = produce(doc, (d) => {
      deleteDecor(d, d.sequences[s1].decorId!);
      deleteCharacter(d, byName('Candice'));
      addDecor(d, { name: 'Parking' });
    });
    expect(removed.sequences[s1].decorId).toBeUndefined();
    expect(Object.values(removed.shots).some((s) => s.characterIds.includes(byName('Candice')))).toBe(false);
  });
});
