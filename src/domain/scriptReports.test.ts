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
