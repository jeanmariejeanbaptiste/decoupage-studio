import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addInterviewee, addSetup, ensureInterview, maxSetupNumber, placeSetup, setSetupNumber, setupNumber, setupShotIds, syncInterviewShots } from './interview';
import { addSequence, addShot, addShotAfter, deleteShot, duplicateShot, moveShot } from './ops';
import { shotCode, shotNumberLabel } from './numbering';
import { buildSequenceRows, sequenceMerges } from './rows';
import { computeTiming } from './timing';
import { setCellText } from './cells';
import { runChecks } from './lint';
import type { ProjectDoc } from './types';

/** Projet institutionnel : une séquence de deux illustrations, un intervenant à deux caméras. */
function project() {
  const doc = createProjectDoc({ title: 'T', format: 'institutionnel' });
  const seq = addSequence(doc, undefined, { label: 'Atelier' }, false);
  const a = addShot(doc, seq, { init: { subject: 'Machines', value: 'Général' } });
  const b = addShot(doc, seq, { init: { subject: 'Mains', value: 'Insert' } });
  const itw = ensureInterview(doc);
  const subject = itw.subjects[0];
  subject.name = 'Marie Dupont';
  subject.role = 'directrice';
  const setup = subject.setups[0];
  return { doc, seq, a, b, subject, setup };
}

const order = (doc: ProjectDoc, seq: string) => doc.sequences[seq].shotIds.map((id) => shotNumberLabel(doc, id));

describe('interview placée dans le découpage', () => {
  it('un plan par caméra, un numéro commun et une lettre par caméra', () => {
    const { doc, seq, setup } = project();
    placeSetup(doc, setup.id, seq);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1', '2', '3A', '3B']);
    const [ca, cb] = setupShotIds(doc, setup.id);
    expect(shotCode(doc, ca)).toBe('1.3A');
    expect(doc.shots[ca]).toMatchObject({ subject: 'Marie Dupont', value: 'Rapproché', focal: { from: 50 } });
    expect(doc.shots[cb].actionBlockId).toBe(doc.shots[ca].actionBlockId);
    expect(doc.blocks[doc.shots[ca].actionBlockId].text).toBe('Interview — Marie Dupont, directrice · regard à gauche');
    expect(setup.sequenceId).toBe(seq);
  });

  it('la fiche reste la source : nom, caméras ajoutées ou retirées', () => {
    const { doc, seq, subject, setup } = project();
    placeSetup(doc, setup.id, seq);
    subject.name = 'Marie Martin';
    setup.cameras.push({ id: 'cam-c', name: 'C', value: 'Large', angle: 'Face', focal: '24-70' });
    setup.cameras[1].focal = '85';
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1', '2', '3A', '3B', '3C']);
    const ids = setupShotIds(doc, setup.id);
    expect(ids.map((id) => doc.shots[id].subject)).toEqual(['Marie Martin', 'Marie Martin', 'Marie Martin']);
    expect(doc.shots[ids[2]].focal).toEqual({ from: 24, to: 70 });
    setup.cameras.splice(0, 1);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1', '2', '3B', '3C']);
    // Idempotente : une seconde passe ne change rien.
    const before = JSON.stringify(doc);
    syncInterviewShots(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('supprimer une caméra du découpage retire tout le cadre, qui redevient une annexe', () => {
    const { doc, seq, setup } = project();
    placeSetup(doc, setup.id, seq);
    deleteShot(doc, setupShotIds(doc, setup.id)[1]);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1', '2']);
    expect(setup.sequenceId).toBeUndefined();
  });

  it('le cadre se déplace d’un bloc ; un plan inséré au milieu en ressort', () => {
    const { doc, seq, a, setup } = project();
    placeSetup(doc, setup.id, seq);
    const [ca] = setupShotIds(doc, setup.id);
    moveShot(doc, ca, seq, 0);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1A', '1B', '2', '3']);
    expect(doc.sequences[seq].shotIds[2]).toBe(a);
    const x = addShotAfter(doc, ca);
    syncInterviewShots(doc);
    expect(doc.sequences[seq].shotIds.indexOf(x)).toBe(2);
    // Vers une autre séquence : le groupe et son action suivent.
    const other = addSequence(doc, undefined, { label: 'Bureau' }, false);
    moveShot(doc, ca, other, 0);
    syncInterviewShots(doc);
    expect(order(doc, other)).toEqual(['1A', '1B']);
    expect(setup.sequenceId).toBe(other);
    expect(doc.blocks[doc.shots[ca].actionBlockId].sequenceId).toBe(other);
  });

  it('une copie devient un plan ordinaire ; la grille refuse de modifier un plan d’interview', () => {
    const { doc, seq, setup } = project();
    placeSetup(doc, setup.id, seq);
    const [ca] = setupShotIds(doc, setup.id);
    const copy = duplicateShot(doc, ca);
    syncInterviewShots(doc);
    expect(doc.shots[copy].interview).toBeUndefined();
    expect(setupShotIds(doc, setup.id)).toHaveLength(2);
    expect(setCellText(doc, ca, 'value', 'Large')).toBe(false);
    expect(doc.shots[ca].value).toBe('Rapproché');
  });

  it('nouvelle séquence, lignes et fusions : rien ne franchit le cadre', () => {
    const { doc, setup } = project();
    placeSetup(doc, setup.id, 'new');
    const seq = setup.sequenceId!;
    expect(doc.sequences[seq].label).toBe('Interview Marie Dupont');
    const rows = buildSequenceRows(doc, computeTiming(doc), seq, ['sequence', 'number', 'subject', 'value', 'movement']);
    expect(rows.map((r) => r.cells.number)).toEqual(['1A', '1B']);
    expect(rows[1].group).toBe(setup.id);
    // Un plan ordinaire « Fixe » sous le cadre ne fusionne pas avec ses caméras.
    addShot(doc, seq, { init: { subject: 'Marie Dupont', value: 'Rapproché', movement: ['Fixe'] } });
    const { merges } = sequenceMerges(doc, computeTiming(doc), seq, ['sequence', 'number', 'subject', 'movement']);
    expect(merges.get('movement')!.map((m) => m.span)).toEqual([2, 1]);
    expect(merges.get('sequence')!.map((m) => m.span)).toEqual([3]);
  });

  it('les règles d’ouverture et de fermeture sur un plan large ignorent l’interview', () => {
    const { doc, seq, b, setup } = project();
    doc.shots[b].value = 'Ensemble';
    placeSetup(doc, setup.id, seq);
    const codes = runChecks(doc, computeTiming(doc)).map((i) => i.code);
    expect(codes).not.toContain('doc-close-wide');
  });

  it('le numéro du plan se choisit : avant le plan qui le portait, ou en fin de séquence', () => {
    const { doc, seq, setup } = project();
    placeSetup(doc, setup.id, seq);
    syncInterviewShots(doc);
    expect(setupNumber(doc, setup.id)).toBe(3);
    setSetupNumber(doc, setup.id, 1);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1A', '1B', '2', '3']);
    setSetupNumber(doc, setup.id, 2);
    expect(order(doc, seq)).toEqual(['1', '2A', '2B', '3']);
    expect(maxSetupNumber(doc, setup.id, seq)).toBe(3);
  });

  it('multicam : chaque caméra peut filmer un autre intervenant', () => {
    const { doc, seq, setup } = project();
    const paulId = addInterviewee(doc);
    const paul = doc.interview!.subjects.find((x) => x.id === paulId)!;
    paul.name = 'Paul Durand';
    paul.role = 'technicien';
    setup.cameras[1].filmsId = paulId;
    placeSetup(doc, setup.id, seq);
    syncInterviewShots(doc);
    const [a, b] = setupShotIds(doc, setup.id);
    expect(doc.shots[a].subject).toBe('Marie Dupont');
    expect(doc.shots[b].subject).toBe('Paul Durand');
    expect(doc.blocks[doc.shots[a].actionBlockId].text).toContain('Marie Dupont, directrice et Paul Durand, technicien');
  });

  it('une interview ne se coupe pas : rien entre deux cadres d’un même intervenant', () => {
    const { doc, seq, subject, setup } = project();
    placeSetup(doc, setup.id, seq);
    setup.cameras.splice(1);
    syncInterviewShots(doc);
    // Un plan ordinaire ajouté en fin de séquence, puis un second cadre placé : il rejoint le premier.
    addShot(doc, seq, { init: { subject: 'Couloir' } });
    const second = addSetup(doc, subject.id)!;
    placeSetup(doc, second, seq);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1', '2', '3A', '4A', '5']);
    // Un plan glissé entre les deux cadres en ressort, juste après l’interview.
    const loose = doc.sequences[seq].shotIds[4];
    moveShot(doc, loose, seq, 3);
    syncInterviewShots(doc);
    expect(order(doc, seq)).toEqual(['1', '2', '3A', '4A', '5']);
    expect(doc.sequences[seq].shotIds[4]).toBe(loose);
    // Un numéro choisi au milieu de la séquence emporte l’interview entière à cet endroit.
    setSetupNumber(doc, second, 1);
    syncInterviewShots(doc);
    expect(doc.sequences[seq].shotIds.slice(0, 2).map((id) => doc.shots[id].interview?.setupId)).toEqual([second, setup.id]);
    const before = JSON.stringify(doc);
    syncInterviewShots(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
