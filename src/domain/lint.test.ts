import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { createProjectDoc } from './factory';
import { CHECK_LABELS, groupIssues, runChecks } from './lint';
import { addSequence, addShot } from './ops';
import { computeTiming } from './timing';
import type { ProjectDoc } from './types';

const check = (doc: ProjectDoc) => runChecks(doc, computeTiming(doc));
const codes = (doc: ProjectDoc) => check(doc).map((i) => i.code);

function docWith(shots: Array<Parameters<typeof addShot>[2]>, format: ProjectDoc['project']['format'] = 'fiction'): ProjectDoc {
  const doc = createProjectDoc({ title: 't', format });
  const seq = addSequence(doc, undefined, { label: 'S' }, false);
  for (const s of shots) addShot(doc, seq, s);
  return doc;
}

describe('contrôles de la scripte (§9)', () => {
  it('zoom sans focales', () => {
    expect(codes(docWith([{ init: { subject: 'x', value: 'Taille', movement: ['Zoom avant'], focal: { from: 24 } } }]))).toContain('zoom-focal');
    expect(codes(docWith([{ init: { subject: 'x', value: 'Taille', movement: ['Zoom avant'], focal: { from: 24, to: 70 } } }]))).not.toContain('zoom-focal');
  });
  it('valeur ou sujet manquant', () => {
    const c = codes(docWith([{}]));
    expect(c).toContain('missing-value');
    expect(c).toContain('missing-subject');
  });
  it('plans consécutifs identiques, sauf mouvements différents', () => {
    const base = { subject: 'Léa', value: 'Taille', angle: ['Face'], movement: ['Fixe'] };
    expect(codes(docWith([{ init: base }, { init: base }]))).toContain('jump-cut');
    expect(codes(docWith([{ init: base }, { init: { ...base, movement: ['Trav avant'] } }]))).not.toContain('jump-cut');
  });
  it('séquence vide et institutionnel sans plan large', () => {
    const empty = createProjectDoc({ title: 't', format: 'fiction' });
    addSequence(empty, undefined, { label: 'vide' }, false);
    expect(codes(empty)).toEqual(['empty-sequence']);
    const doc = docWith([{ init: { subject: 'a', value: 'Gros plan' } }, { init: { subject: 'a', value: 'Insert' } }], 'institutionnel');
    expect(codes(doc)).toEqual(expect.arrayContaining(['doc-open-wide', 'doc-close-wide']));
    const ok = docWith([{ init: { subject: 'a', value: 'Général' } }, { init: { subject: 'a', value: 'Moyen' } }], 'institutionnel');
    expect(codes(ok)).not.toContain('doc-open-wide');
    const single = docWith([{ init: { subject: 'a', value: 'Insert' } }], 'institutionnel');
    expect(check(single).find((i) => i.code === 'doc-close-wide')?.shotId).toBeUndefined();
  });
  it('écart estimé / calculé > 25 %', () => {
    const doc = docWith([{ init: { subject: 'a', value: 'Taille' }, action: { text: 'x', overrideSec: 60 } }]);
    doc.sequences[doc.project.sequenceIds[0]].estimatedSec = 30;
    expect(codes(doc)).toContain('estimate-gap');
    // Le lien ne répète pas le titre de la carte ; « % » ne passe pas seul à la ligne.
    const gap = check(doc).find((i) => i.code === 'estimate-gap')!;
    expect(gap.where).toBe('Séquence');
    expect(gap.message).toMatch(/\d\u202f% entre/);
    expect(CHECK_LABELS['estimate-gap']).toContain('25\u202f%');
  });
  it('rappels drone et sécurité ; un sujet qui n’est pas un personnage (insert, objet) n’est pas une erreur', () => {
    const c = codes(docWith([{ init: { subject: 'Affiche', value: 'Général', movement: ['Drone'] } }, { init: { subject: 'a', value: 'Taille', movement: ['Épaule'] } }]));
    expect(c).toEqual(expect.arrayContaining(['drone', 'stabilizer-safety']));
    expect(c).not.toContain('unknown-subject');
  });
  it('« ignorer ici » est mémorisé', () => {
    const doc = buildRav3();
    const issues = check(doc);
    const affiche = issues.find((i) => i.code === 'jump-cut')!;
    const next = produce(doc, (d) => {
      d.ignoredChecks.push(affiche.id);
    });
    expect(check(next).find((i) => i.id === affiche.id)).toBeUndefined();
    expect(check(next).length).toBe(issues.length - 1);
  });
  it('chaque contrôle désigne la cellule à montrer (le clic mène à la bonne colonne)', () => {
    const col = (doc: ProjectDoc, code: string) => check(doc).find((i) => i.code === code)?.col;
    const blank = docWith([{}]);
    expect(col(blank, 'missing-value')).toBe('value');
    expect(col(blank, 'missing-subject')).toBe('subject');
    expect(col(docWith([{ init: { subject: 'x', value: 'Taille', movement: ['Zoom avant'] } }]), 'zoom-focal')).toBe('focal');
    expect(col(docWith([{ init: { subject: 'x', value: 'Taille', movement: ['Drone'] } }]), 'drone')).toBe('movement');
    const base = { subject: 'Léa', value: 'Taille', angle: ['Face'], movement: ['Fixe'] };
    expect(col(docWith([{ init: base }, { init: base }]), 'jump-cut')).toBe('value');
    // Séquence sans plan : ni plan ni colonne, la séquence elle-même.
    const empty = createProjectDoc({ title: 't', format: 'fiction' });
    addSequence(empty, undefined, { label: 'vide' }, false);
    const [e] = check(empty);
    expect([e.shotId, e.col]).toEqual([undefined, undefined]);
  });
  it('les séquences sans plan forment une seule entrée (badge, résumé)', () => {
    const doc = docWith([{ init: { subject: 'x', value: 'Taille', movement: ['Zoom avant'] } }]);
    for (let k = 0; k < 5; k++) addSequence(doc, undefined, { label: `vide ${k}` }, false);
    const issues = check(doc);
    expect(issues.filter((i) => i.code === 'empty-sequence')).toHaveLength(5);
    const g = groupIssues(issues);
    expect(g.empty).toHaveLength(5);
    expect(g.rest.map((i) => i.code)).toEqual(['zoom-focal']);
    expect(g.count).toBe(2);
    expect(g.warn).toBe(2);
    expect(groupIssues(check(docWith([{ init: { subject: 'x', value: 'Taille' } }])))).toMatchObject({ count: 0, warn: 0, empty: [] });
  });
});
