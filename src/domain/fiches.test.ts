import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { deleteWarning, ficheUse, orphanFiches } from './fiches';
import { addCharacter } from './ops';
import { addDecor, decorKey, findDecorByName, renameFiche, setSequenceDecorByName } from './registry';
import { createVersion } from './versions';

describe('fiches hors du texte', () => {
  it('personnages et décors que le scénario ne nomme pas', () => {
    const doc = buildFiction();
    expect(orphanFiches(doc, 'character')).toEqual([]);
    expect(orphanFiches(doc, 'decor')).toEqual([]);
    const next = produce(doc, (d) => {
      addCharacter(d, { name: 'Voyageuse', kind: 'figurant' });
      addDecor(d, { name: 'Quai 4' });
    });
    expect(orphanFiches(next, 'character').map((c) => c.name)).toEqual(['Voyageuse']);
    expect(orphanFiches(next, 'decor').map((c) => c.name)).toEqual(['Quai 4']);
    // Nommée dans une action : présente.
    const named = produce(next, (d) => void (d.scenario = (d.scenario ?? '').replace('Léa le rejoint.', 'Léa le rejoint. Voyageuse passe.')));
    expect(orphanFiches(named, 'character')).toEqual([]);
  });

  it('usage et avertissement de suppression : rien si personne ne s’en sert', () => {
    const doc = produce(buildFiction(), (d) => void addDecor(d, { name: 'Quai 4' }));
    const quai = findDecorByName(doc, 'quai 4')!.id;
    expect(deleteWarning(doc, 'decor', quai)).toBe('');
    const hall = findDecorByName(doc, 'Gare — hall')!.id;
    expect(ficheUse(doc, 'decor', hall).sequences).toBe(1);
    expect(deleteWarning(doc, 'decor', hall)).toMatch(/^Lieu de 1 séquence de cette version/);
    const lea = Object.values(doc.characters).find((c) => c.name === 'Léa')!.id;
    expect(deleteWarning(doc, 'character', lea)).toMatch(/^Présent dans 3 séquences/);
    const v = produce(doc, (d) => void createVersion(d));
    expect(ficheUse(v, 'decor', hall).versions).toEqual(['V1']);
  });
});

describe('noms de décor', () => {
  it('comparés sans casse, accents ni tirets', () => {
    expect(decorKey('Gare – hall')).toBe(decorKey('GARE — HALL'));
    expect(decorKey('Église')).toBe(decorKey('eglise'));
    const doc = buildFiction();
    const hall = findDecorByName(doc, 'GARE — HALL')!;
    expect(findDecorByName(doc, 'gare - hall')).toBe(hall);
    const s1 = doc.project.sequenceIds[1];
    const next = produce(doc, (d) => setSequenceDecorByName(d, s1, 'Gare-Hall'));
    expect(next.sequences[s1].decorId).toBe(hall.id);
    expect(Object.keys(next.decors)).toHaveLength(3);
  });

  it('renommer une fiche garde l’ancien nom en alias', () => {
    const doc = buildFiction();
    const hall = findDecorByName(doc, 'GARE — HALL')!.id;
    const next = produce(doc, (d) => renameFiche(d, 'decor', hall, 'Hall de la gare'));
    expect(next.decors[hall]).toMatchObject({ name: 'Hall de la gare', aliases: ['GARE — HALL'] });
    expect(findDecorByName(next, 'gare — hall')!.id).toBe(hall);
    expect(produce(next, (d) => renameFiche(d, 'decor', hall, '  '))).toBe(next);
  });
});
