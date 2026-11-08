import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { characterName, diffRange, shiftAnchors, shiftOffset, displayName, matchSequence, normalizeScenario, parseFountain, parseHeading, sceneAt, scenesOf, splitSelection, importScenes } from './fountain';
import { addSequence, checkInvariants } from './ops';
import type { ProjectDoc } from './types';

const SCRIPT = `Title: La Consigne
Author: Réalisation

INT. GARE - HALL - JOUR

Le hall bruisse. Léa tire une valise cabossée.

LÉA
(à voix basse)
Encore une roue.

GUICHETIER (O.S.)
Suivant !

CUT TO:

EXT. PARVIS DE LA GARE - NUIT #3#

Marc attend sous la pluie.

MARC
Tu l'as laissée ?

.FLASHBACK
/* commentaire ignoré */
>FIN<
`;

describe('Fountain', () => {
  const els = parseFountain(SCRIPT);
  it('reconnaît les éléments', () => {
    expect(els.filter((e) => e.type === 'title').map((e) => e.text)).toEqual(['Title: La Consigne', 'Author: Réalisation']);
    expect(els.filter((e) => e.type === 'heading').map((e) => e.text)).toEqual(['INT. GARE - HALL - JOUR', 'EXT. PARVIS DE LA GARE - NUIT', 'FLASHBACK']);
    expect(els.filter((e) => e.type === 'character').map((e) => e.text)).toEqual(['LÉA', 'GUICHETIER (O.S.)', 'MARC']);
    expect(els.find((e) => e.type === 'parenthetical')).toMatchObject({ text: '(à voix basse)', speaker: 'LÉA' });
    expect(els.find((e) => e.type === 'dialogue')).toMatchObject({ text: 'Encore une roue.', speaker: 'LÉA' });
    expect(els.find((e) => e.type === 'transition')?.text).toBe('CUT TO:');
    expect(els.find((e) => e.type === 'centered')?.text).toBe('FIN');
    expect(els.some((e) => e.text.includes('commentaire'))).toBe(false);
  });
  it('garde les positions dans la source', () => {
    for (const e of els.filter((x) => x.type !== 'heading' || !x.text.startsWith('FLASH'))) {
      if (e.type === 'heading') expect(SCRIPT.slice(e.start, e.start + e.text.length)).toBe(e.text);
      else expect(SCRIPT.slice(e.start, e.end)).toBe(e.text);
    }
    const forced = els.find((e) => e.text === 'FLASHBACK')!;
    expect(SCRIPT.slice(forced.start, forced.end)).toBe('FLASHBACK');
  });
  it('analyse les en-têtes', () => {
    expect(parseHeading('INT. GARE - HALL - JOUR')).toEqual({ intExt: 'INT', location: 'GARE - HALL', effect: 'JOUR' });
    expect(parseHeading('EXT. PARC – CRÉPUSCULE')).toEqual({ intExt: 'EXT', location: 'PARC', effect: 'CRÉPUSCULE' });
    expect(parseHeading('INT./EXT. VOITURE - NIGHT')).toEqual({ intExt: 'INT/EXT', location: 'VOITURE', effect: 'NUIT' });
    expect(parseHeading('I/E. TRAIN')).toEqual({ intExt: 'INT/EXT', location: 'TRAIN', effect: undefined });
    expect(parseHeading('EST. VILLE - AUBE')).toEqual({ intExt: 'EXT', location: 'VILLE', effect: 'AUBE' });
    expect(parseHeading('FLASHBACK')).toEqual({ intExt: undefined, location: 'FLASHBACK', effect: undefined });
  });
  it('noms de personnages', () => {
    expect(characterName('GUICHETIER (O.S.)')).toBe('GUICHETIER');
    expect(characterName('LÉA^')).toBe('LÉA');
    expect(displayName('JEAN-PIERRE')).toBe('Jean-Pierre');
    expect(displayName("L'HOMME")).toBe("L'Homme");
  });
  it('découpe en séquences avec leurs personnages parlants', () => {
    const scenes = scenesOf(SCRIPT);
    expect(scenes).toHaveLength(3);
    expect(scenes[0].speakers).toEqual(['LÉA', 'GUICHETIER']);
    expect(scenes[1]).toMatchObject({ location: 'PARVIS DE LA GARE', effect: 'NUIT', speakers: ['MARC'] });
    expect(scenes[0].end).toBe(scenes[1].start);
    expect(sceneAt(scenes, scenes[1].start + 5)?.index).toBe(1);
    expect(sceneAt(scenes, 0)).toBeUndefined();
    expect(sceneAt(scenes, SCRIPT.length + 10)?.index).toBe(2);
  });
  it('synchronise séquences, décors et personnages', () => {
    const base = createProjectDoc({ title: 'x', format: 'fiction' });
    let res = { sequences: 0, characters: 0 };
    const doc = produce(base, (d) => {
      res = importScenes(d, SCRIPT);
    });
    expect(res).toEqual({ sequences: 3, characters: 3 });
    const labels = doc.project.sequenceIds.map((id) => doc.sequences[id].label);
    expect(labels).toEqual(['GARE - HALL', 'PARVIS DE LA GARE', 'FLASHBACK']);
    expect(doc.sequences[doc.project.sequenceIds[1]]).toMatchObject({ intExt: 'EXT', effect: 'NUIT' });
    expect(Object.values(doc.characters).map((c) => c.name).sort()).toEqual(['Guichetier', 'Léa', 'Marc']);
    expect(Object.keys(doc.decors)).toHaveLength(3);
    // Deuxième passage : rien n'est recréé.
    const again = produce(doc, (d) => {
      res = importScenes(d, SCRIPT.replace('PARVIS', 'QUAI'));
    });
    // Le lieu renommé dans l'en-tête : la séquence ancrée à cette scène reste la même (pas de doublon),
    // et le scénario, indicatif, ne renomme pas la séquence.
    expect(res).toEqual({ sequences: 0, characters: 0 });
    expect(again.project.sequenceIds).toHaveLength(3);
    expect(again.sequences[again.project.sequenceIds[1]].label).toBe('PARVIS DE LA GARE');
    expect(checkInvariants(again)).toEqual([]);
  });
  it('sépare action et répliques d’une sélection', () => {
    const start = SCRIPT.indexOf('Le hall');
    const end = SCRIPT.indexOf('Suivant') + 'Suivant !'.length;
    expect(splitSelection(els, start, end)).toEqual({
      action: 'Le hall bruisse. Léa tire une valise cabossée.',
      dialogue: 'LÉA : Encore une roue. GUICHETIER : Suivant !',
      speakers: ['Léa', 'Guichetier'],
    });
    const mid = SCRIPT.indexOf('bruisse');
    expect(splitSelection(els, mid, mid + 7).action).toBe('bruisse');
  });
});

describe('ancres du scénario', () => {
  it('repère la modification et décale les positions', () => {
    expect(diffRange('abcdef', 'abXYdef')).toEqual({ at: 2, removed: 1, inserted: 2 });
    expect(diffRange('abc', 'abc')).toEqual({ at: 3, removed: 0, inserted: 0 });
    expect(shiftOffset(1, 2, 1, 2)).toBe(1);
    expect(shiftOffset(5, 2, 1, 2)).toBe(6);
    expect(shiftOffset(2.5, 2, 1, 2)).toBe(4);
  });
  it('recale les ancres des blocs et séquences', () => {
    const doc = produce(createProjectDoc({ title: 'x', format: 'fiction' }), (d) => {
      importScenes(d, SCRIPT);
      const b = Object.values(d.blocks)[0];
      void b;
    });
    const withBlock = produce(doc, (d) => {
      d.blocks.b1 = { id: 'b1', sequenceId: d.project.sequenceIds[0], text: 'x', scenarioAnchor: { start: 100, end: 120 } };
      shiftAnchors(d, SCRIPT, 'XX' + SCRIPT);
      shiftAnchors(d, SCRIPT, SCRIPT);
    });
    expect(withBlock.blocks.b1.scenarioAnchor).toEqual({ start: 102, end: 122 });
    expect(withBlock.sequences[withBlock.project.sequenceIds[0]].scenarioAnchor!.start).toBe(doc.sequences[doc.project.sequenceIds[0]].scenarioAnchor!.start + 2);
  });
});

describe('seed fiction et scénario', () => {
  it('le scénario du seed est cohérent avec ses séquences et ses ancres', async () => {
    const { buildFiction } = await import('../../seed/fiction');
    const doc = buildFiction();
    const labels = doc.project.sequenceIds.map((id) => doc.sequences[id].label);
    let res = { sequences: -1, characters: -1 };
    const next = produce(doc, (d) => {
      res = importScenes(d, d.scenario!);
    });
    expect(res).toEqual({ sequences: 0, characters: 0 });
    expect(next.project.sequenceIds.map((id) => next.sequences[id].label)).toEqual(labels);
    const anchored = Object.values(doc.blocks).filter((b) => b.scenarioAnchor);
    expect(anchored.length).toBe(Object.keys(doc.blocks).length);
    for (const b of anchored) expect(doc.scenario!.slice(b.scenarioAnchor!.start, b.scenarioAnchor!.end)).toBe(b.text);
  });
});

describe('répliques de la colonne dialogue', async () => {
  const { parseDialogue } = await import('./fountain');
  it('sépare les orateurs et leurs répliques', () => {
    expect(parseDialogue('LÉA : Encore une roue. GUICHETIER : Suivant !')).toEqual([
      { speaker: 'LÉA', line: 'Encore une roue.' },
      { speaker: 'GUICHETIER', line: 'Suivant !' },
    ]);
    expect(parseDialogue('Bonjour')).toEqual([{ line: 'Bonjour' }]);
  });
});

describe('Fountain — variantes françaises et robustesse', () => {
  it('en-têtes numérotés, EXT./INT., séparateurs et effets composés', () => {
    const els = parseFountain('1. INT. CUISINE - JOUR\n\nTexte.\n\n12A EXT./INT. VOITURE - NUIT\n\nRoule.');
    expect(els.filter((e) => e.type === 'heading')).toHaveLength(2);
    expect(parseHeading('12. INT. CUISINE - JOUR')).toEqual({ intExt: 'INT', location: 'CUISINE', effect: 'JOUR' });
    expect(parseHeading('EXT./INT. VOITURE - NUIT')).toEqual({ intExt: 'INT/EXT', location: 'VOITURE', effect: 'NUIT' });
    expect(parseHeading('INT - CUISINE - JOUR')).toEqual({ intExt: 'INT', location: 'CUISINE', effect: 'JOUR' });
    expect(parseHeading('INT. CUISINE. NUIT')).toEqual({ intExt: 'INT', location: 'CUISINE', effect: 'NUIT' });
    expect(parseHeading('EXT. PLAGE - FIN DE JOURNÉE')).toMatchObject({ location: 'PLAGE', effect: 'CRÉPUSCULE' });
  });

  it('transitions avec espace avant les deux-points, notes sur leur ligne', () => {
    const els = parseFountain('Action.\n\nCOUPE FRANCHE :\n\n[[Revoir ce passage]]\n\nINT. BAR - NUIT');
    expect(els.map((e) => e.type)).toEqual(['action', 'transition', 'note', 'heading']);
    expect(els[2].text).toBe('Revoir ce passage');
  });

  it('fins de ligne Windows normalisées, ancres recalées au caractère près', () => {
    const doc = createProjectDoc({ title: 'x', format: 'fiction' });
    doc.scenario = '﻿INT. A - JOUR\r\n\r\nLéa entre.\r\n';
    const seqId = addSequence(doc, undefined, {}, true);
    const block = doc.blocks[doc.sequences[seqId].actionBlockIds[0]];
    const a = doc.scenario.indexOf('Léa');
    block.scenarioAnchor = { start: a, end: a + 'Léa entre.'.length };
    normalizeScenario(doc);
    expect(doc.scenario).toBe('INT. A - JOUR\n\nLéa entre.\n');
    expect(doc.scenario.slice(block.scenarioAnchor.start, block.scenarioAnchor.end)).toBe('Léa entre.');
  });

  it('une séquence renommée reste celle de sa scène (ancre d’abord)', () => {
    const doc = createProjectDoc({ title: 'x', format: 'fiction' });
    importScenes(doc, 'INT. GARE - JOUR\n\nTexte.');
    const id = doc.project.sequenceIds[0];
    doc.sequences[id].label = 'Hall de la gare';
    const sc = scenesOf(doc.scenario!)[0];
    expect(matchSequence(doc, sc)).toBe(id);
  });
});

describe('import d’un scénario entier : passages liés', () => {
  it('retrouve chaque passage par son texte, détache ceux qui ont disparu', async () => {
    const { relinkAnchors } = await import('./fountain');
    const before = 'INT. GARE - JOUR\n\nLéa entre.\n\nElle pose la valise.\n';
    const after = 'Title: Nouveau\n\nINT. GARE - JOUR\n\nElle pose la valise.\n\nEXT. QUAI - NUIT\n';
    const doc = { blocks: { a: { scenarioAnchor: { start: 18, end: 28 } }, b: { scenarioAnchor: { start: 30, end: 50 } } }, sequences: { s: { scenarioAnchor: { start: 0, end: 16 } } } } as unknown as ProjectDoc;
    expect(relinkAnchors(doc, before, after)).toBe(1);
    expect(doc.blocks.a.scenarioAnchor).toBeUndefined();
    expect(after.slice(doc.blocks.b.scenarioAnchor!.start, doc.blocks.b.scenarioAnchor!.end)).toBe('Elle pose la valise.');
    expect(after.slice(doc.sequences.s.scenarioAnchor!.start, doc.sequences.s.scenarioAnchor!.end)).toBe('INT. GARE - JOUR');
  });
});
