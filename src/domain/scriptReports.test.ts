import { describe, expect, it } from 'vitest';
import { blocksFromSource } from './screenplay';
import { characterReports, locationReports, parseHeading, sceneReports, sidesOf } from './scriptReports';

const SRC = `INT. GARE – HALL - JOUR

LÉA traverse le hall. MARC l'attend.

LÉA
Tu es là ?

MARC
(bas)
Depuis une heure.

EXT. PARVIS — NUIT

MARC fume seul.

INT. GARE – HALL - JOUR

LÉA revient.

LÉA
Je reste.
`;

describe('rapports du scénario', () => {
  const blocks = blocksFromSource(SRC).blocks;
  const scenes = sceneReports(blocks);

  it('en-têtes : tiret court, demi-cadratin ou cadratin', () => {
    expect(parseHeading('INT. GARE – HALL - JOUR')).toEqual({ intExt: 'INT', location: 'GARE – HALL', effect: 'JOUR' });
    expect(parseHeading('EXT. PARVIS — NUIT')).toEqual({ intExt: 'EXT', location: 'PARVIS', effect: 'NUIT' });
  });

  it('personnages : répliques, séquences parlantes et muettes, première apparition', () => {
    expect(scenes).toHaveLength(3);
    const [lea, marc] = characterReports(scenes);
    expect(lea).toMatchObject({ name: 'LÉA', replies: 2, speaking: 2, silent: 0, total: 2, first: 1 });
    expect(marc).toMatchObject({ name: 'MARC', replies: 1, speaking: 1, silent: 1, total: 2, first: 1 });
  });

  it('décors regroupés avec leur durée ; répliques d’un rôle', () => {
    const locs = locationReports(scenes);
    expect(locs.map((l) => [l.location, l.scenes])).toEqual([
      ['GARE – HALL', [1, 3]],
      ['PARVIS', [2]],
    ]);
    expect(locs[0].durationSec).toBeGreaterThan(0);
    expect(sidesOf(blocks, 'MARC')).toEqual([{ n: 1, heading: 'INT. GARE – HALL - JOUR', lines: [{ paren: '(bas)', text: 'Depuis une heure.' }] }]);
  });
});

describe('renommer', () => {
  it('garde la casse de chaque occurrence et recale les positions', async () => {
    const { replaceName, isHeadingLine } = await import('./scriptReports');
    const src = 'INT. GARE - JOUR\n\nLÉA entre. Léa sourit. Léandre passe.\n\nLÉA (OFF)\nBonjour.\n';
    const r = replaceName(src, 'Léa', 'Flora');
    expect(r.text).toBe('INT. GARE - JOUR\n\nFLORA entre. Flora sourit. Léandre passe.\n\nFLORA (OFF)\nBonjour.\n');
    expect(r.text.slice(r.shift(src.indexOf('Bonjour')), r.shift(src.indexOf('Bonjour')) + 7)).toBe('Bonjour');
    const d = replaceName(src, 'gare', 'Station', isHeadingLine);
    expect(d.text.startsWith('INT. STATION - JOUR')).toBe(true);
  });
});

describe('renommer dans le projet', () => {
  it('personnage : scénario, fiche, plans ; décor : en-têtes et séquences', async () => {
    const { renameCharacter, renameDecor } = await import('./scriptReports');
    const { buildFiction } = await import('../../seed/fiction');
    const doc = buildFiction();
    renameCharacter(doc, 'LÉA', 'Flora');
    expect(doc.scenario).not.toMatch(/Léa|LÉA/);
    expect(Object.values(doc.characters).map((c) => c.name)).toContain('Flora');
    expect(Object.values(doc.shots).some((s) => s.subject.includes('Flora'))).toBe(true);
    renameDecor(doc, 'GARE — HALL', 'Gare du Nord — Hall');
    expect(doc.scenario).toContain('GARE DU NORD — HALL');
  });

  it('dans une version : l’ancien nom reste un alias, la V1 figée retrouve la même fiche, sans doublon', async () => {
    const { renameCharacter, renameDecor, matchesName } = await import('./scriptReports');
    const { createVersion, switchVersion, ensureVersions } = await import('./versions');
    const { setSequenceDecorByName } = await import('./registry');
    const { buildFiction } = await import('../../seed/fiction');
    const doc = buildFiction();
    const lea = Object.values(doc.characters).find((c) => c.name === 'Léa')!;
    lea.actor = 'Ana Girardot';
    const v1 = ensureVersions(doc)[0].id;
    createVersion(doc);
    renameCharacter(doc, 'LÉA', 'Léonie');
    expect(lea).toMatchObject({ name: 'Léonie', aliases: ['Léa'] });
    const decor = Object.values(doc.decors)[0];
    const oldDecor = decor.name;
    renameDecor(doc, oldDecor, 'Hangar');
    expect(decor.aliases).toEqual([oldDecor]);
    switchVersion(doc, v1);
    // La V1 n'est pas réécrite : elle garde LÉA, qui désigne toujours la même fiche.
    expect(doc.scenario).toContain('LÉA');
    expect(Object.values(doc.characters).filter((c) => matchesName(c, 'LÉA'))).toEqual([lea]);
    expect(Object.values(doc.decors).filter((d) => matchesName(d, oldDecor))).toEqual([decor]);
    const seq = doc.project.sequenceIds[0];
    setSequenceDecorByName(doc, seq, oldDecor);
    expect(doc.sequences[seq].decorId).toBe(decor.id);
    // Revenir au nom d'origine retire l'alias devenu le nom.
    renameCharacter(doc, 'Léonie', 'Léa');
    expect(lea.name).toBe('Léa');
    expect(lea.aliases).toEqual(['Léonie']);
  });
});
