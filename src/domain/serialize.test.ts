import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { checkInvariants } from './ops';
import { exportBase, fileNameFor, parseProjectFile, ProjectFileError, projectCopy, serializeDoc } from './serialize';

describe('fichier .decoupage', () => {
  it('ouvert comme copie : nouvel identifiant, sans le fichier de relecture de l’original', () => {
    const doc = buildFiction();
    doc.review = { fileId: 'file123456', publishedVersionId: 'v1', publishedAt: '2026-11-09T10:00:00Z' };
    const copy = parseProjectFile(serializeDoc(projectCopy(doc, 'copie1')));
    expect(copy.project.id).toBe('copie1');
    expect(copy.project.title).toBe(`${doc.project.title} (copie)`);
    expect(copy.review).toBeUndefined();
    expect(doc.review.fileId).toBe('file123456');
  });

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
    // Fichiers exportés : même nom, sans l'extension du projet.
    expect(exportBase(d)).toBe('ete-hiver-v1');
    d.project.title = '';
    d.project.version = '';
    expect(fileNameFor(d)).toBe('projet.decoupage');
  });
});

describe('médias intégrés au fichier', () => {
  it('liste les images du storyboard, des keyframes, des fonds de plan et la piste', async () => {
    const { mediaKeys, mediaOfFile } = await import('./serialize');
    const doc = buildRav3();
    const [a, b] = Object.keys(doc.shots);
    doc.shots[a].storyboard = { blobKey: 'p:1', baseKey: 'p:0' };
    doc.shots[b].keyframes = [{ id: 'k', blobKey: 'p:2' }];
    doc.floorPlans = { x: { items: [], bg: { blobKey: 'p:3', opacity: 1, x: 0, y: 0, w: 100 } } };
    doc.project.settings.audioTrack = { name: 'piste', durationSec: 10, blobKey: 'p:4' };
    expect(mediaKeys(doc).sort()).toEqual(['p:0', 'p:1', 'p:2', 'p:3', 'p:4']);
    const text = serializeDoc(doc, undefined, { 'p:1': { type: 'image/png', data: 'AAAA' } });
    expect(mediaOfFile(text)['p:1'].type).toBe('image/png');
    expect(parseProjectFile(text).project.id).toBe(doc.project.id);
    expect(mediaOfFile(serializeDoc(doc))).toEqual({});
  });
});
