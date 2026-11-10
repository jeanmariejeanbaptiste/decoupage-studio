import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { checkLineCount, checkPlace, checkRows, checkTarget, sequenceName } from './checkTarget';
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
  addShot(doc, seq, { init: { subject: 'Léa', value: 'Taille', angle: ['Plongée', 'Contre-plongée'], movement: ['Épaule'] }, action: { text: 'x', overrideSec: 60 } });
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
    for (const d of [doc, inst]) for (const i of check(d)) expect(checkTarget(d, i).page).toMatch(/^(grid|seq-head|interview)$/);
  });

  it('plan : la cellule où se règle le contrôle', () => {
    const doc = everyCheck();
    const [, , blank, aerial, shoulder] = doc.sequences[doc.project.sequenceIds[1]].shotIds;
    expect(checkTarget(doc, find(doc, 'missing-value'))).toEqual({ page: 'grid', sequenceId: doc.project.sequenceIds[1], shotId: blank, cols: ['value'], edit: true });
    expect(checkTarget(doc, find(doc, 'missing-subject'))).toMatchObject({ shotId: blank, cols: ['subject'] });
    expect(checkTarget(doc, find(doc, 'zoom-focal'))).toMatchObject({ shotId: aerial, cols: ['focal'] });
    expect(checkTarget(doc, find(doc, 'drone'))).toMatchObject({ shotId: aerial, cols: ['movement'] });
    expect(checkTarget(doc, find(doc, 'stabilizer-safety'))).toMatchObject({ shotId: shoulder, cols: ['movement'] });
    expect(checkTarget(doc, find(doc, 'angle-conflict'))).toMatchObject({ shotId: shoulder, cols: ['angle'] });
    expect(find(doc, 'angle-conflict').detail).toBe('Plongée, Contre-plongée');
  });

  it('une seule cellule à remplir s’ouvre en saisie ; pas un rappel, une série ni une colonne masquée', () => {
    const doc = everyCheck();
    for (const code of ['missing-value', 'missing-subject', 'zoom-focal', 'angle-conflict'] as const) expect(checkTarget(doc, find(doc, code))).toMatchObject({ edit: true });
    for (const code of ['drone', 'stabilizer-safety', 'jump-cut'] as const) expect(checkTarget(doc, find(doc, code))).not.toHaveProperty('edit');
    const [row] = checkRows(doc, [find(doc, 'jump-cut')]);
    expect(row.target).not.toHaveProperty('edit');
    doc.project.settings.gridColumns = doc.project.settings.gridColumns.filter((c) => c !== 'value');
    expect(checkTarget(doc, find(doc, 'missing-value'))).not.toHaveProperty('edit');
  });

  it('plan-séquence : ses colonnes de cadrage ne s’écrivent pas dans la grille, la cellule est seulement sélectionnée', () => {
    const doc = everyCheck();
    const issue = find(doc, 'missing-value');
    doc.shots[issue.shotId!].oneShot = { beats: [] } as unknown as NonNullable<ProjectDoc['shots'][string]['oneShot']>;
    expect(checkTarget(doc, issue)).toMatchObject({ page: 'grid', cols: ['value'] });
    expect(checkTarget(doc, issue)).not.toHaveProperty('edit');
  });

  it('saute : toutes les colonnes comparées, dans l’ordre de la grille ; le plan voisin est nommé', () => {
    const doc = everyCheck();
    const jump = find(doc, 'jump-cut');
    expect(checkTarget(doc, jump)).toMatchObject({ cols: ['subject', 'value', 'angle', 'movement'] });
    expect(jump.message).toMatch(/^Identique au plan 2\.1 /);
    expect(checkPlace(doc, jump)).toBe('2.2');
    // Une seule ligne pour la paire : les deux plans.
    const [row] = checkRows(doc, [jump]);
    const [a, b] = doc.sequences[doc.project.sequenceIds[1]].shotIds;
    expect(row).toMatchObject({ place: '2.1\u2009–\u20092.2', detail: '2 plans', target: { page: 'grid', shotId: a, lastShotId: b } });
  });

  it('sautes consécutives : une série par suite de plans identiques, une ligne chacune', () => {
    const doc = buildRav3();
    const jumps = check(doc).filter((i) => i.code === 'jump-cut');
    const rows = checkRows(doc, jumps);
    expect(rows.length).toBeLessThan(jumps.length);
    expect(rows.reduce((n, r) => n + r.issues.length, 0)).toBe(jumps.length);
    const loge = rows.find((r) => r.place.startsWith('4.1'))!;
    expect(loge.place).toBe('4.1\u2009–\u20094.6');
    expect(loge.detail).toBe('6 plans');
    expect(loge.issues).toHaveLength(5);
    // Le compteur du menu compte les lignes de la page, pas les contrôles.
    expect(checkLineCount(doc, check(doc))).toBe(rows.length + check(doc).filter((i) => i.code !== 'jump-cut').length);

    // Deux séries séparées par un plan différent : deux lignes.
    const d = createProjectDoc({ title: 't', format: 'fiction' });
    const seq = addSequence(d, undefined, { label: 'Parc' }, false);
    const same = { subject: 'Léa', value: 'Taille', angle: ['Face'], movement: ['Fixe'] };
    for (const init of [same, same, { ...same, value: 'Gros plan' }, { ...same, value: 'Gros plan' }, { ...same, value: 'Gros plan' }]) addShot(d, seq, { init });
    const r2 = checkRows(d, check(d).filter((i) => i.code === 'jump-cut'));
    expect(r2.map((r) => [r.place, r.detail])).toEqual([
      ['1.1\u2009–\u20091.2', '2 plans'],
      ['1.3\u2009–\u20091.5', '3 plans'],
    ]);
  });

  it('colonne masquée : repli sur une autre colonne du contrôle, sinon la ligne entière (aucune cellule sans rapport)', () => {
    const doc = everyCheck();
    doc.project.settings.gridColumns = doc.project.settings.gridColumns.filter((c) => c !== 'focal' && c !== 'value');
    expect(checkTarget(doc, find(doc, 'zoom-focal'))).toMatchObject({ cols: ['movement'] });
    expect(checkTarget(doc, find(doc, 'missing-value'))).toMatchObject({ page: 'grid', shotId: find(doc, 'missing-value').shotId, cols: [] });
    expect(checkTarget(doc, find(doc, 'jump-cut'))).toMatchObject({ cols: ['subject', 'angle', 'movement'] });
  });

  it('séquence sans plan : la séquence dans le découpage ; écart de durée : l’en-tête de la séquence', () => {
    const doc = everyCheck();
    const [empty, park] = doc.project.sequenceIds;
    expect(checkTarget(doc, find(doc, 'empty-sequence'))).toEqual({ page: 'grid', sequenceId: empty, cols: [] });
    expect(checkPlace(doc, find(doc, 'empty-sequence'))).toBe('1');
    expect(checkTarget(doc, find(doc, 'estimate-gap'))).toEqual({ page: 'seq-head', sequenceId: park, field: 'estimate' });
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

  it('plan d’interview (institutionnel) : sa caméra dans la fiche, où il se règle', () => {
    const doc = institutional(['Plan général']);
    const seqId = doc.project.sequenceIds[0];
    const shotId = addShot(doc, seqId, { init: { subject: 'Directrice', value: '', angle: ['Face', 'Dos'] } });
    doc.shots[shotId].interview = { subjectId: 'sub', setupId: 'set', cameraId: 'cam' };
    const issues = check(doc).filter((i) => i.shotId === shotId);
    const target = (code: CheckCode) => checkTarget(doc, issues.find((i) => i.code === code)!);
    expect(target('missing-value')).toEqual({ page: 'interview', sequenceId: seqId, shotId, subjectId: 'sub', setupId: 'set', cameraId: 'cam', field: 'value' });
    expect(target('angle-conflict')).toMatchObject({ page: 'interview', field: 'angle' });
    // Hors institutionnel, le lien ne change rien : la grille.
    doc.project.format = 'fiction';
    expect(checkTarget(doc, issues.find((i) => i.code === 'missing-value')!)).toMatchObject({ page: 'grid', cols: ['value'] });
  });

  it('séquence sans libellé : INT/EXT et décor, sinon rien', () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    const a = addSequence(doc, undefined, { label: '' }, false);
    expect(sequenceName(doc, a)).toBe('');
    doc.sequences[a].intExt = 'EXT';
    doc.decors.d = { id: 'd', name: 'Parvis de la gare' } as ProjectDoc['decors'][string];
    doc.sequences[a].decorId = 'd';
    expect(sequenceName(doc, a)).toBe('EXT PARVIS DE LA GARE');
    doc.sequences[a].label = 'Arrivée';
    expect(sequenceName(doc, a)).toBe('ARRIVÉE');
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
