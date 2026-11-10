import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { checkInvariants } from './ops';
import { createVersion } from './versions';
import { exportBase, fileNameFor, mediaKeys, migrate, parseProjectFile, ProjectFileError, projectCopy, serializeDoc, sharedMediaOwners } from './serialize';

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

  it('garde les intrigues du séquencier', () => {
    const doc = buildFiction();
    doc.plots = [
      { key: 'A', name: 'Léa' },
      { key: 'C', name: 'La lettre' },
    ];
    expect(parseProjectFile(serializeDoc(doc)).plots).toEqual(doc.plots);
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

  it('garde les écritures non latines et borne la longueur', () => {
    const d = buildFiction();
    d.project.title = 'Москва : 1989 ?';
    expect(fileNameFor(d)).toBe('москва-1989-v1.decoupage');
    d.project.title = 'ガラス';
    expect(exportBase(d)).toBe('ガラス-v1');
    // Signes combinants (voyelles des écritures indiennes, thaï) : gardés.
    d.project.title = 'हिन्दी ไทย';
    expect(exportBase(d)).toBe('हिन्दी-ไทย-v1');
    d.project.title = 'Œuvre çà et là '.repeat(20);
    const base = exportBase(d);
    expect(base.startsWith('œuvre-ca-et-la-')).toBe(true);
    expect(Array.from(base).length).toBeLessThanOrEqual(80);
    expect(base.endsWith('-')).toBe(false);
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

describe('médias partagés entre projets', () => {
  it('confie au projet qui les utilise encore les médias d’un projet supprimé', () => {
    const copy = projectCopy(buildFiction(), 'copie');
    const shotId = Object.keys(copy.shots)[0];
    copy.shots[shotId].storyboard = { blobKey: 'orig:image' };
    const owners = sharedMediaOwners(['orig:image', 'orig:seule'], [copy]);
    expect([...owners]).toEqual([['orig:image', 'copie']]);
  });
});

describe('projet abîmé relu (fichier ou base)', () => {
  type Raw = Record<string, unknown>;
  type Doc = ReturnType<typeof buildRav3>;
  /** Chemins d'un projet (un exemple par table), jusqu'à quatre niveaux. */
  function paths(o: unknown, pre: string[] = [], out: string[][] = []): string[][] {
    if (pre.length > 3 || o === null || typeof o !== 'object') return out;
    const keys = Object.keys(o);
    for (const k of Array.isArray(o) || keys.length > 30 ? keys.slice(0, 1) : keys) {
      out.push([...pre, k]);
      paths((o as Raw)[k], [...pre, k], out);
    }
    return out;
  }
  const corrupt = (doc: Doc, path: string[], value: unknown): Doc => {
    const d = JSON.parse(JSON.stringify(doc)) as Raw;
    let o = d;
    for (const k of path.slice(0, -1)) o = o[k] as Raw;
    o[path[path.length - 1]] = value;
    return d as unknown as Doc;
  };

  it.each([['RAV3', buildRav3], ['fiction', buildFiction]])('une valeur nulle ou d’un autre type n’empêche jamais l’ouverture (%s)', (_n, build) => {
    const base = build();
    const failures: string[] = [];
    for (const p of paths(base).filter((x) => ['project', 'sequences', 'shots', 'blocks', 'characters', 'decors'].includes(x[0]) && x.length > 1)) {
      for (const value of [null, 'x', 42]) {
        try {
          const back = migrate(corrupt(base, p, value));
          const errors = checkInvariants(back);
          if (errors.length) failures.push(`${p.join('.')}=${value} : ${errors[0]}`);
        } catch (e) {
          if (!(e instanceof ProjectFileError)) failures.push(`${p.join('.')}=${value} : ${(e as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('versions rangées : saines, inchangées ; abîmées, réparées comme la courante', () => {
    const doc = buildFiction();
    createVersion(doc, 'V2');
    expect(parseProjectFile(serializeDoc(doc))).toEqual(doc);
    const old = doc.versions!.find((v) => v.slice)!;
    const s = old.slice!;
    const [s1, s2] = s.sequenceIds;
    s.sequences[s2].shotIds.push(s.sequences[s1].shotIds[0]);
    (s.shots as Record<string, unknown>)[s.sequences[s1].shotIds[1]] = null;
    const raw = doc as unknown as { versions: unknown[] };
    raw.versions.push({ id: 'cassee', name: 'V0', createdAt: '', slice: { sequenceIds: [] } });
    const back = migrate(doc);
    expect(back.versions!.map((v) => v.name)).toEqual(['V1', 'V2']);
    const bs = back.versions!.find((v) => v.slice)!.slice!;
    const asDoc = { ...back, project: { ...back.project, sequenceIds: bs.sequenceIds }, sequences: bs.sequences, shots: bs.shots, blocks: bs.blocks };
    expect(checkInvariants(asDoc)).toEqual([]);
  });

  it('réparer deux fois ne change plus rien', () => {
    const doc = buildFiction();
    const once = migrate(corrupt(doc, ['sequences', doc.project.sequenceIds[0], 'shotIds'], null));
    expect(migrate(once)).toEqual(once);
  });

  it('plan listé par deux séquences, rattaché à la mauvaise, séquence hors de l’ordre : rien ne se perd', () => {
    const doc = buildFiction();
    const [s1, s2] = doc.project.sequenceIds;
    const shot = doc.sequences[s1].shotIds[0];
    doc.sequences[s2].shotIds.push(shot);
    doc.shots[shot].sequenceId = s2;
    doc.project.sequenceIds = doc.project.sequenceIds.filter((id) => id !== s2);
    const back = migrate(doc);
    expect(checkInvariants(back)).toEqual([]);
    expect(back.shots[shot].sequenceId).toBe(s1);
    expect(back.sequences[s2].shotIds).not.toContain(shot);
    expect(back.project.sequenceIds).toContain(s2);
    expect(Object.keys(back.shots).length).toBe(Object.keys(doc.shots).length);
  });

  it('personnages, décors et réglages abîmés : références pendantes oubliées, réglages par défaut', () => {
    const doc = buildFiction();
    const seq = doc.sequences[doc.project.sequenceIds[0]];
    seq.characterIds = [...seq.characterIds, 'disparu'];
    seq.decorId = 'disparu';
    const raw = doc as unknown as Raw;
    (raw.characters as Raw).casse = null;
    (doc.project.settings as unknown as Raw).fps = null;
    (doc.project.settings as unknown as Raw).gridColumns = ['subject', null, 'inconnue'];
    raw.scenario = 42;
    raw.comments = [null, { id: 'sans-ancre' }, { id: 'c', anchor: { kind: 'sequence', sequenceId: seq.id }, replies: null, attachments: [null, 'k:1'] }];
    raw.geocodes = { bon: { address: 'a', lat: 48.8, lon: 2.3 }, introuvable: { address: 'b', missing: true }, vide: { address: 'c' }, casse: { address: 'd', lat: '48' } };
    const back = migrate(doc);
    expect(back.sequences[seq.id].characterIds).not.toContain('disparu');
    expect(back.sequences[seq.id].decorId).toBeUndefined();
    expect(back.characters.casse).toBeUndefined();
    expect(back.project.settings.fps).toBe(25);
    expect(back.project.settings.gridColumns).toEqual(['subject']);
    expect(back.scenario).toBeUndefined();
    expect(back.comments).toHaveLength(1);
    expect(back.comments![0].replies).toEqual([]);
    expect(mediaKeys(back)).toContain('k:1');
    expect(Object.keys(back.geocodes!).sort()).toEqual(['bon', 'introuvable']);
  });
});
