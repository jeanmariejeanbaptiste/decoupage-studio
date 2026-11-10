import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { deleteSequence, mergeCharacters } from './ops';
import { addDecor, characterNumbers, characterStats, characterUsage, decorStats, decorUsage, deleteCharacter, deleteDecor, numberedCast, sequenceProgress, setSequenceDecorByName, setSequenceEstimate, usageDayLabel, usageInOtherVersions } from './registry';
import { createVersion, switchVersion } from './versions';
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

  it('durée estimée d’une séquence : saisie tolérante, vide la retire, invalide ne change rien', () => {
    const s1 = doc.project.sequenceIds[0];
    const ok = produce(doc, (d) => void expect(setSequenceEstimate(d, s1, '1:10')).toBe(true));
    expect(ok.sequences[s1].estimatedSec).toBe(70);
    expect(produce(doc, (d) => void setSequenceEstimate(d, s1, '90s')).sequences[s1].estimatedSec).toBe(90);
    const cleared = produce(ok, (d) => void expect(setSequenceEstimate(d, s1, '  ')).toBe(true));
    expect(cleared.sequences[s1]).not.toHaveProperty('estimatedSec');
    const bad = produce(ok, (d) => void expect(setSequenceEstimate(d, s1, 'bientôt')).toBe(false));
    expect(bad.sequences[s1].estimatedSec).toBe(70);
    expect(produce(doc, (d) => void expect(setSequenceEstimate(d, 'x', '1:00')).toBe(false))).toBe(doc);
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

describe('registre : fiches communes aux versions', () => {
  const base = buildFiction();
  const parvis = base.project.sequenceIds[2];
  const decorId = base.sequences[parvis].decorId!;
  // V2 sans la séquence du parvis : V1 la garde, avec son décor et ses personnages.
  const doc = produce(base, (d) => {
    createVersion(d);
    deleteSequence(d, parvis);
  });
  const v1 = doc.versions![0];
  const all = (x: typeof doc) => {
    const sl = x.versions![0].slice!;
    return [...Object.values(sl.shots).flatMap((s) => s.characterIds), ...Object.values(sl.sequences).flatMap((q) => q.characterIds)];
  };

  it('un décor que seule une autre version emploie n’est pas « inutilisé »', () => {
    expect(decorUsage(doc).get(decorId)?.sequenceIds).toEqual([]);
    expect(usageInOtherVersions(doc, 'decor').get(decorId)).toEqual([v1.name]);
    expect(usageInOtherVersions(base, 'decor').size).toBe(0);
  });

  it('supprimer un décor ne laisse aucun identifiant orphelin dans les versions rangées', () => {
    const next = produce(doc, (d) => deleteDecor(d, decorId));
    expect(next.versions![0].slice!.sequences[parvis].decorId).toBeUndefined();
    const back = produce(next, (d) => switchVersion(d, v1.id));
    expect(Object.values(back.sequences).some((q) => q.decorId === decorId)).toBe(false);
  });

  it('supprimer ou fusionner un personnage suit aussi dans les versions rangées', () => {
    const charId = all(doc)[0];
    expect(charId).toBeDefined();
    expect(usageInOtherVersions(doc, 'character').get(charId)).toEqual([v1.name]);
    const other = Object.keys(doc.characters).find((id) => id !== charId)!;
    expect(all(produce(doc, (d) => deleteCharacter(d, charId)))).not.toContain(charId);
    const merged = all(produce(doc, (d) => mergeCharacters(d, charId, other)));
    expect(merged).not.toContain(charId);
    expect(merged).toContain(other);
  });
});
