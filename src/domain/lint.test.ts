import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { createProjectDoc } from './factory';
import { runChecks } from './lint';
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
  it('séquence vide et documentaire sans plan large', () => {
    const empty = createProjectDoc({ title: 't', format: 'fiction' });
    addSequence(empty, undefined, { label: 'vide' }, false);
    expect(codes(empty)).toEqual(['empty-sequence']);
    const doc = docWith([{ init: { subject: 'a', value: 'Gros plan' } }, { init: { subject: 'a', value: 'Insert' } }], 'documentaire');
    expect(codes(doc)).toEqual(expect.arrayContaining(['doc-open-wide', 'doc-close-wide']));
    const ok = docWith([{ init: { subject: 'a', value: 'Général' } }, { init: { subject: 'a', value: 'Moyen' } }], 'documentaire');
    expect(codes(ok)).not.toContain('doc-open-wide');
    const single = docWith([{ init: { subject: 'a', value: 'Insert' } }], 'documentaire');
    expect(check(single).find((i) => i.code === 'doc-close-wide')?.shotId).toBeUndefined();
  });
  it('écart estimé / calculé > 25 %', () => {
    const doc = docWith([{ init: { subject: 'a', value: 'Taille' }, action: { text: 'x', overrideSec: 60 } }]);
    doc.sequences[doc.project.sequenceIds[0]].estimatedSec = 30;
    expect(codes(doc)).toContain('estimate-gap');
  });
  it('rappels drone et sécurité, sujet inconnu', () => {
    const c = codes(docWith([{ init: { subject: 'Affiche', value: 'Général', movement: ['Drone'] } }, { init: { subject: 'a', value: 'Taille', movement: ['Épaule'] } }]));
    expect(c).toEqual(expect.arrayContaining(['drone', 'stabilizer-safety', 'unknown-subject']));
  });
  it('« ignorer ici » est mémorisé', () => {
    const doc = buildRav3();
    const issues = check(doc);
    const affiche = issues.find((i) => i.code === 'unknown-subject')!;
    expect(affiche.message).toContain('Affiche');
    const next = produce(doc, (d) => {
      d.ignoredChecks.push(affiche.id);
    });
    expect(check(next).find((i) => i.id === affiche.id)).toBeUndefined();
    expect(check(next).some((i) => i.code === 'jump-cut')).toBe(true);
  });
});
