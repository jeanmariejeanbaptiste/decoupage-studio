import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addDecor, characterNumbers, characterStats, characterUsage, decorStats, decorUsage, deleteCharacter, deleteDecor, numberedCast, sequenceProgress, setSequenceDecorByName, usageDayLabel } from './registry';
import { assignShots, updateDay } from './schedule';
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

describe('registre : colonnes calculées depuis le plan de travail', () => {
  const doc = buildRav3();
  const byName = (n: string) => Object.values(doc.characters).find((c) => c.name === n)!.id;

  it('numéros des personnages : principaux d’abord, puis par nombre de séquences', () => {
    const nums = characterNumbers(doc);
    const principals = Object.values(doc.characters).filter((c) => c.kind === 'principal');
    expect(Math.max(...principals.map((c) => nums.get(c.id)!))).toBe(principals.length);
    expect([...nums.values()].sort((a, b) => a - b)).toEqual(Object.keys(doc.characters).map((_, i) => i + 1));
    const cast = numberedCast(doc, [byName('Maquilleuse'), byName('Candice')], nums);
    expect(cast).toBe(`${nums.get(byName('Candice'))} Candice, ${nums.get(byName('Maquilleuse'))} Maquilleuse`);
  });

  it('premier jour, nombre de jours et de séquences ; rien de planifié = aucun jour', () => {
    const [a, , , d] = doc.project.sequenceIds;
    expect(characterUsage(doc).get(byName('Candice'))!.days).toEqual([]);
    const next = produce(doc, (x) => {
      assignShots(x, x.sequences[d].shotIds, 3);
      assignShots(x, x.sequences[a].shotIds, 2);
      updateDay(x, 2, { date: '2026-11-16' });
    });
    const cu = characterUsage(next);
    expect(cu.get(byName('Admiratrice'))!.days[0]).toBe(2);
    for (const u of cu.values()) expect(u.days).toEqual([...u.days].sort((x, y) => x - y));
    const loge = next.sequences[d].decorId!;
    const du = decorUsage(next);
    expect(du.get(loge)).toEqual({ days: [3], sequenceIds: [d] });
    expect(usageDayLabel(next, du.get(loge))).toBe('J3');
    expect(usageDayLabel(next, du.get(next.sequences[a].decorId!))).toBe('J2 · 16 nov.');
    expect(usageDayLabel(next, undefined)).toBe('');
    const empty = produce(next, (x) => void addDecor(x, { name: 'Grenier' }));
    const grenier = Object.values(empty.decors).find((x) => x.name === 'Grenier')!.id;
    expect(decorUsage(empty).get(grenier)).toEqual({ days: [], sequenceIds: [] });
  });
});
