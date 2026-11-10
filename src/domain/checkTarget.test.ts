import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { checkPlace, checkTarget } from './checkTarget';
import { createProjectDoc } from './factory';
import { CHECK_LABELS, CHECK_NOTES, groupChecks, runChecks, type CheckCode, type Issue } from './lint';
import { addSequence, addShot } from './ops';
import { computeTiming } from './timing';
import type { ProjectDoc } from './types';

const check = (doc: ProjectDoc) => runChecks(doc, computeTiming(doc));
const find = (doc: ProjectDoc, code: CheckCode) => check(doc).find((i) => i.code === code)!;

/** Un projet où chaque contrôle se déclenche au moins une fois. */
function everyCheck(): ProjectDoc {
  const doc = createProjectDoc({ title: 't', format: 'fiction' });
  addSequence(doc, undefined, { label: 'Entreprise / accueil' }, false);
  const seq = addSequence(doc, undefined, { label: 'Parc' }, false);
  const same = { subject: 'Léa', value: 'Taille', angle: ['Face'], movement: ['Fixe'] };
  addShot(doc, seq, { init: same });
  addShot(doc, seq, { init: same });
  addShot(doc, seq, { init: { subject: '', value: '' } });
  addShot(doc, seq, { init: { subject: 'Ville', value: 'Général', movement: ['Drone', 'Zoom avant'], focal: { from: 24 } } });
  addShot(doc, seq, { init: { subject: 'Léa', value: 'Taille', movement: ['Épaule'] }, action: { text: 'x', overrideSec: 60 } });
  doc.sequences[seq].estimatedSec = 10;
  return doc;
}

function institutional(values: string[]): ProjectDoc {
  const doc = createProjectDoc({ title: 't', format: 'institutionnel' });
  const seq = addSequence(doc, undefined, { label: 'Atelier' }, false);
  for (const value of values) addShot(doc, seq, { init: { subject: 'a', value } });
  return doc;
}

describe('vérifications : chaque contrôle mène à l’endroit exact', () => {
  it('tous les types de contrôle ont une destination', () => {
    const doc = everyCheck();
    const codes = new Set(check(doc).map((i) => i.code));
    const inst = institutional(['Gros plan', 'Insert']);
    for (const i of check(inst)) codes.add(i.code);
    expect([...codes].sort()).toEqual((Object.keys(CHECK_LABELS) as CheckCode[]).sort());
    for (const d of [doc, inst]) for (const i of check(d)) expect(checkTarget(d, i).page).toMatch(/^(grid|registry)$/);
  });

  it('plan : la cellule où se règle le contrôle', () => {
    const doc = everyCheck();
    const [, , blank, aerial, shoulder] = doc.sequences[doc.project.sequenceIds[1]].shotIds;
    expect(checkTarget(doc, find(doc, 'missing-value'))).toEqual({ page: 'grid', sequenceId: doc.project.sequenceIds[1], shotId: blank, cols: ['value'] });
    expect(checkTarget(doc, find(doc, 'missing-subject'))).toMatchObject({ shotId: blank, cols: ['subject'] });
    expect(checkTarget(doc, find(doc, 'zoom-focal'))).toMatchObject({ shotId: aerial, cols: ['focal'] });
    expect(checkTarget(doc, find(doc, 'drone'))).toMatchObject({ shotId: aerial, cols: ['movement'] });
    expect(checkTarget(doc, find(doc, 'stabilizer-safety'))).toMatchObject({ shotId: shoulder, cols: ['movement'] });
  });

  it('saute : toutes les colonnes comparées, dans l’ordre de la grille ; le plan voisin est nommé', () => {
    const doc = everyCheck();
    const jump = find(doc, 'jump-cut');
    expect(checkTarget(doc, jump)).toMatchObject({ cols: ['subject', 'value', 'angle', 'movement'] });
    expect(jump.detail).toBe('Identique au plan 2.1');
    expect(checkPlace(doc, jump)).toBe('2.2');
  });

  it('colonne masquée : repli sur une colonne visible, jamais de sélection vide', () => {
    const doc = everyCheck();
    doc.project.settings.gridColumns = doc.project.settings.gridColumns.filter((c) => c !== 'focal' && c !== 'value');
    expect(checkTarget(doc, find(doc, 'zoom-focal'))).toMatchObject({ cols: ['movement'] });
    expect(checkTarget(doc, find(doc, 'missing-value'))).toMatchObject({ cols: ['subject'] });
    expect(checkTarget(doc, find(doc, 'jump-cut'))).toMatchObject({ cols: ['subject', 'angle', 'movement'] });
  });

  it('séquence sans plan : la séquence dans le découpage ; écart de durée : la ligne du registre', () => {
    const doc = everyCheck();
    const [empty, park] = doc.project.sequenceIds;
    expect(checkTarget(doc, find(doc, 'empty-sequence'))).toEqual({ page: 'grid', sequenceId: empty, cols: [] });
    expect(checkPlace(doc, find(doc, 'empty-sequence'))).toBe('1');
    expect(checkTarget(doc, find(doc, 'estimate-gap'))).toEqual({ page: 'registry', tab: 'sequences', sequenceId: park });
    expect(checkPlace(doc, find(doc, 'estimate-gap'))).toBe('2');
  });

  it('institutionnel : ouverture et fermeture visent leur plan, même quand la séquence n’en a qu’un', () => {
    const doc = institutional(['Gros plan', 'Insert']);
    const [a, b] = doc.sequences[doc.project.sequenceIds[0]].shotIds;
    expect(checkTarget(doc, find(doc, 'doc-open-wide'))).toMatchObject({ shotId: a, cols: ['value'] });
    expect(checkTarget(doc, find(doc, 'doc-close-wide'))).toMatchObject({ shotId: b, cols: ['value'] });
    const single = institutional(['Insert']);
    const [only] = single.sequences[single.project.sequenceIds[0]].shotIds;
    const close = find(single, 'doc-close-wide');
    expect(close.shotId).toBeUndefined();
    expect(checkTarget(single, close)).toMatchObject({ shotId: only, cols: ['value'] });
    expect(checkPlace(single, close)).toBe('1.1');
  });

  it('plan disparu entre le calcul et le clic : la séquence', () => {
    const doc = everyCheck();
    const issue: Issue = { ...find(doc, 'missing-value'), shotId: 'gone' };
    expect(checkTarget(doc, issue)).toMatchObject({ page: 'grid', cols: [] });
    expect(checkTarget(doc, issue)).not.toHaveProperty('shotId');
  });

  it('regroupement par type : avertissements puis rappels, ordre du découpage à l’intérieur', () => {
    const doc = buildRav3();
    const issues = check(doc);
    const groups = groupChecks(issues);
    expect(groups.reduce((n, g) => n + g.issues.length, 0)).toBe(issues.length);
    expect(new Set(groups.map((g) => g.code)).size).toBe(groups.length);
    const firstInfo = groups.findIndex((g) => g.level === 'info');
    if (firstInfo >= 0) expect(groups.slice(firstInfo).every((g) => g.level === 'info')).toBe(true);
    for (const g of groups) expect(g.issues.map((i) => issues.indexOf(i))).toEqual([...g.issues.map((i) => issues.indexOf(i))].sort((x, y) => x - y));
    // Un rappel se lit une fois en tête du groupe, sans répéter le titre.
    expect(CHECK_NOTES.drone).not.toMatch(/^Drone/);
  });
});
