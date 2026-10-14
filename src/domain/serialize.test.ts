import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { checkInvariants } from './ops';
import { fileNameFor, parseProjectFile, ProjectFileError, serializeDoc } from './serialize';

describe('fichier .decoupage', () => {
  it.each([['RAV3', buildRav3], ['fiction', buildFiction]])('aller-retour sans perte (%s)', (_n, build) => {
    const doc = build();
    doc.ignoredChecks.push('x:y');
    doc.validatedSteps.push(4);
    const back = parseProjectFile(serializeDoc(doc));
    expect(back).toEqual(doc);
    expect(checkInvariants(back)).toEqual([]);
  });

  it('accepte un JSON de projet nu et complète les champs manquants', () => {
    const doc = buildRav3();
    const partial = JSON.parse(JSON.stringify(doc));
    delete partial.ignoredChecks;
    delete partial.customVocabulary;
    delete partial.project.settings.neverMerge;
    const firstShot = Object.keys(partial.shots)[0];
    delete partial.shots[firstShot].angle;
    const back = parseProjectFile(JSON.stringify(partial));
    expect(back.ignoredChecks).toEqual([]);
    expect(back.customVocabulary.movement).toEqual([]);
    expect(back.project.settings.neverMerge).toEqual([]);
    expect(back.shots[firstShot].angle).toEqual([]);
  });

  it('refuse les fichiers invalides', () => {
    expect(() => parseProjectFile('pas du json')).toThrow(ProjectFileError);
    expect(() => parseProjectFile('{"a":1}')).toThrow(/ne contient pas/);
    expect(() => parseProjectFile(JSON.stringify({ schemaVersion: 99, doc: buildRav3() }))).toThrow(/plus récente/);
    const broken = JSON.parse(serializeDoc(buildRav3()));
    delete broken.doc.shots;
    expect(() => parseProjectFile(JSON.stringify(broken))).toThrow(/shots/);
    const noOrder = JSON.parse(serializeDoc(buildRav3()));
    noOrder.doc.project.sequenceIds = null;
    expect(() => parseProjectFile(JSON.stringify(noOrder))).toThrow(/Ordre/);
    const noId = JSON.parse(serializeDoc(buildRav3()));
    noId.doc.project.id = '';
    expect(() => parseProjectFile(JSON.stringify(noId))).toThrow(/Identifiant/);
  });

  it('nomme le fichier proprement', () => {
    expect(fileNameFor(buildRav3())).toBe('rav3-v3.decoupage');
    const d = buildFiction();
    d.project.title = 'Été / Hiver';
    expect(fileNameFor(d)).toBe('ete-hiver-v1.decoupage');
    d.project.title = '';
    d.project.version = '';
    expect(fileNameFor(d)).toBe('projet.decoupage');
  });
});
