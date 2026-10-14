import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { createProjectDoc } from './factory';
import {
  addCharacter,
  addSequence,
  addShot,
  addShotAfter,
  checkInvariants,
  consecutiveRun,
  deleteSequence,
  deleteShot,
  duplicateShot,
  linkAction,
  mergeCharacters,
  moveSequence,
  moveShot,
  normalizeBlocks,
  setShotSubject,
  unlinkAction,
} from './ops';
import { sequenceNumber, shotCode, shotNumber } from './numbering';
import type { ProjectDoc } from './types';

function fresh(): ProjectDoc {
  const doc = createProjectDoc({ title: 'Test', format: 'fiction' });
  const a = addSequence(doc, undefined, { label: 'A' }, false);
  const b = addSequence(doc, undefined, { label: 'B' }, false);
  for (let i = 0; i < 4; i++) addShot(doc, a, { action: { text: `a${i}` } });
  for (let i = 0; i < 3; i++) addShot(doc, b, { action: { text: `b${i}` } });
  return doc;
}

const seqA = (d: ProjectDoc) => d.sequences[d.project.sequenceIds[0]];
const seqB = (d: ProjectDoc) => d.sequences[d.project.sequenceIds[1]];

describe('opérations et invariants §3', () => {
  it('le seed RAV3 respecte les invariants', () => {
    expect(checkInvariants(buildRav3())).toEqual([]);
  });

  it('numérotation dérivée et recalculée après déplacement', () => {
    const doc = fresh();
    const [s1, s2] = seqA(doc).shotIds;
    expect(shotNumber(doc, s2)).toBe(2);
    const next = produce(doc, (d) => void moveShot(d, s2, seqA(d).id, 0));
    expect(shotNumber(next, s2)).toBe(1);
    expect(shotNumber(next, s1)).toBe(2);
    expect(shotCode(next, s1)).toBe('1.2');
    const moved = produce(next, (d) => moveSequence(d, seqB(d).id, 0));
    expect(sequenceNumber(moved, seqA(next).id)).toBe(2);
    expect(shotCode(moved, s1)).toBe('2.2');
    expect(checkInvariants(moved)).toEqual([]);
  });

  it('addShotAfter hérite du sujet, de la focale et de l’angle', () => {
    const doc = fresh();
    const first = seqA(doc).shotIds[0];
    const next = produce(doc, (d) => {
      Object.assign(d.shots[first], { subject: 'Léa', focal: { from: 35 }, angle: ['Face'], value: 'Taille' });
      addShotAfter(d, first);
    });
    const created = next.shots[seqA(next).shotIds[1]];
    expect(created).toMatchObject({ subject: 'Léa', focal: { from: 35 }, angle: ['Face'], value: '' });
    expect(next.blocks[created.actionBlockId].text).toBe('');
    expect(checkInvariants(next)).toEqual([]);
  });

  it('dupliquer conserve l’action liée', () => {
    const doc = fresh();
    const first = seqA(doc).shotIds[0];
    const next = produce(doc, (d) => void duplicateShot(d, first));
    const [x, y] = seqA(next).shotIds;
    expect(next.shots[x].actionBlockId).toBe(next.shots[y].actionBlockId);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('lier puis délier une action', () => {
    const doc = fresh();
    const ids = seqA(doc).shotIds;
    const linked = produce(doc, (d) => void linkAction(d, [ids[2], ids[1]]));
    expect(linked.shots[ids[1]].actionBlockId).toBe(linked.shots[ids[2]].actionBlockId);
    expect(linked.blocks[linked.shots[ids[1]].actionBlockId].text).toBe('a1 a2');
    expect(seqA(linked).actionBlockIds).toHaveLength(3);
    expect(checkInvariants(linked)).toEqual([]);
    const unlinked = produce(linked, (d) => unlinkAction(d, [ids[1]]));
    expect(unlinked.shots[ids[1]].actionBlockId).not.toBe(unlinked.shots[ids[2]].actionBlockId);
    expect(unlinked.blocks[unlinked.shots[ids[2]].actionBlockId].text).toBe('a1 a2');
    expect(checkInvariants(unlinked)).toEqual([]);
  });

  it('refuse de lier des plans non consécutifs ou de séquences différentes', () => {
    const doc = fresh();
    const a = seqA(doc).shotIds;
    const b = seqB(doc).shotIds;
    expect(consecutiveRun(doc, [a[0], a[2]])).toBeNull();
    expect(consecutiveRun(doc, [a[0], b[0]])).toBeNull();
    expect(consecutiveRun(doc, [])).toBeNull();
    expect(produce(doc, (d) => void linkAction(d, [a[0]]))).toEqual(doc);
  });

  it('un déplacement qui casse la contiguïté scinde le bloc', () => {
    const doc = fresh();
    const ids = seqA(doc).shotIds;
    let splits = 0;
    const next = produce(produce(doc, (d) => void linkAction(d, ids.slice(0, 3))), (d: ProjectDoc) => {
      splits = moveShot(d, ids[1], seqA(d).id, 4);
    });
    expect(splits).toBe(1);
    expect(checkInvariants(next)).toEqual([]);
    const order = seqA(next).shotIds;
    expect(order).toEqual([ids[0], ids[2], ids[3], ids[1]]);
    expect(next.shots[ids[0]].actionBlockId).toBe(next.shots[ids[2]].actionBlockId);
    expect(next.shots[ids[1]].actionBlockId).not.toBe(next.shots[ids[0]].actionBlockId);
  });

  it('un déplacement vers une autre séquence détache l’action', () => {
    const doc = produce(fresh(), (d) => void linkAction(d, seqA(d).shotIds.slice(0, 2)));
    const [s0, s1] = seqA(doc).shotIds;
    const next = produce(doc, (d) => void moveShot(d, s1, seqB(d).id, 1));
    expect(next.shots[s1].sequenceId).toBe(seqB(next).id);
    expect(next.blocks[next.shots[s1].actionBlockId].sequenceId).toBe(seqB(next).id);
    expect(next.blocks[next.shots[s1].actionBlockId].text).toBe('a0 a1');
    expect(next.shots[s0].actionBlockId).not.toBe(next.shots[s1].actionBlockId);
    expect(checkInvariants(next)).toEqual([]);
    // un plan seul emporte son bloc
    const s3 = seqA(next).shotIds[2];
    const block = next.shots[s3].actionBlockId;
    const after = produce(next, (d) => void moveShot(d, s3, seqB(d).id, 0));
    expect(after.shots[s3].actionBlockId).toBe(block);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('supprimer le dernier plan d’un bloc supprime le bloc', () => {
    const doc = fresh();
    const s = seqA(doc).shotIds[0];
    const block = doc.shots[s].actionBlockId;
    const next = produce(doc, (d) => deleteShot(d, s));
    expect(next.blocks[block]).toBeUndefined();
    expect(checkInvariants(next)).toEqual([]);
    expect(produce(next, (d) => deleteShot(d, 'absent'))).toBe(next);
  });

  it('supprimer une séquence emporte plans et blocs', () => {
    const doc = fresh();
    const next = produce(doc, (d) => deleteSequence(d, seqA(d).id));
    expect(Object.keys(next.shots)).toHaveLength(3);
    expect(Object.keys(next.blocks)).toHaveLength(3);
    expect(checkInvariants(next)).toEqual([]);
    expect(produce(next, (d) => deleteSequence(d, 'absent'))).toBe(next);
  });

  it('normalizeBlocks rapatrie un bloc étranger et supprime les orphelins', () => {
    const doc = fresh();
    const next = produce(doc, (d) => {
      const a0 = seqA(d).shotIds[0];
      const b0 = seqB(d).shotIds[0];
      d.shots[a0].actionBlockId = d.shots[b0].actionBlockId; // corruption volontaire
      normalizeBlocks(d, seqA(d).id);
      normalizeBlocks(d, 'absent');
    });
    expect(checkInvariants(next)).toEqual([]);
  });

  it('checkInvariants détecte les corruptions', () => {
    const doc = fresh();
    const broken = produce(doc, (d) => {
      const [a0, a1, a2] = seqA(d).shotIds;
      d.shots[a2].actionBlockId = d.shots[a0].actionBlockId;
      void a1;
      d.project.sequenceIds.push('fantome');
      d.blocks['orphelin'] = { id: 'orphelin', sequenceId: seqA(d).id, text: '' };
    });
    const errs = checkInvariants(broken);
    expect(errs.some((e) => e.includes('non contigu'))).toBe(true);
    expect(errs.some((e) => e.includes('manquante'))).toBe(true);
    expect(errs.some((e) => e.includes('orphelin'))).toBe(true);
  });

  it('reconnaît les personnages et fusionne les doublons', () => {
    const doc = fresh();
    const next = produce(doc, (d) => {
      const candice = addCharacter(d, { name: 'Candice' });
      const candi = addCharacter(d, { name: 'Candi' });
      const s = seqA(d).shotIds;
      setShotSubject(d, s[0], 'Main candice');
      setShotSubject(d, s[1], 'Candi');
      seqA(d).characterIds = [candi];
      mergeCharacters(d, candi, candice);
      setShotSubject(d, 'absent', 'x');
      mergeCharacters(d, candice, candice);
    });
    const [c] = Object.values(next.characters);
    expect(Object.keys(next.characters)).toHaveLength(1);
    expect(c.aliases).toContain('Candi');
    const s = seqA(next).shotIds;
    expect(next.shots[s[0]].characterIds).toEqual([c.id]);
    expect(next.shots[s[1]].characterIds).toEqual([c.id]);
    expect(seqA(next).characterIds).toEqual([c.id]);
  });

  it('addSequence insère à l’index et crée un plan par défaut', () => {
    const doc = fresh();
    const next = produce(doc, (d) => void addSequence(d, 1, { label: 'Milieu' }));
    expect(next.sequences[next.project.sequenceIds[1]].label).toBe('Milieu');
    expect(next.sequences[next.project.sequenceIds[1]].shotIds).toHaveLength(1);
    expect(checkInvariants(next)).toEqual([]);
    expect(() => produce(doc, (d) => void addShot(d, 'absent'))).toThrow();
    expect(() => produce(doc, (d) => void addShotAfter(d, 'absent'))).toThrow();
    expect(() => produce(doc, (d) => void duplicateShot(d, 'absent'))).toThrow();
  });
});
