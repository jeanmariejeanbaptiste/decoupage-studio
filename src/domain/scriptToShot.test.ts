import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addSequence, addShot } from './ops';
import { anchorShotToPassages, chronologicalIndex, createShotFromPassage, passageInsertText, passageOf, sentencesOf, upperName } from './scriptToShot';

const SCRIPT = `INT. ENTREPRISE - JOUR

Flora s'arrête un instant. Elle est seule. Devant elle, plusieurs chaises.

MARC
(à voix basse)
Tu es en avance, comme toujours.

EXT. RUE - NUIT

LÉA traverse la rue.
`;

const at = (frag: string) => {
  const i = SCRIPT.indexOf(frag);
  return [i, i + frag.length] as const;
};

describe('du scénario au découpage', () => {
  it('découpe les actions en phrases et garde les répliques entières', () => {
    const s = sentencesOf(SCRIPT).map((x) => SCRIPT.slice(x.start, x.end));
    expect(s).toContain("Flora s'arrête un instant.");
    expect(s).toContain('Elle est seule.');
    expect(s).toContain('Devant elle, plusieurs chaises.');
    expect(s.find((x) => x.startsWith('MARC'))).toContain('Tu es en avance');
  });
  it('détecte le prénom en majuscules seulement s’il y en a un', () => {
    expect(upperName('LÉA traverse la rue.')).toBe('Léa');
    expect(upperName('Flora s’arrête.')).toBeUndefined();
  });
  it('réplique : sujet, didascalie dans l’action, mention dans Son si la colonne Dialogue est masquée', () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    const [a, b] = at('MARC\n(à voix basse)\nTu es en avance, comme toujours.');
    const p = passageOf(doc, SCRIPT, a, b, { dialogueShown: false });
    expect(p.subject).toBe('Marc');
    expect(p.action).toBe('(à voix basse)');
    expect(p.dialogue).toBe('MARC : Tu es en avance, comme toujours.');
    expect(p.sound).toBe('Rép. « Tu es en avance, comme… »');
    expect(passageOf(doc, SCRIPT, a, b, { dialogueShown: true }).sound).toBe('');
  });
  it('marque « [Rép]. » entre deux séries d’actions séparées par des répliques', () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    const src = `INT. BUREAU - JOUR

La DIRECTRICE ouvre son tiroir.

DIRECTRICE
(ton saccadé)
Vous pouvez signer !

FLORA prend le contrat.

FLORA
C'est illisible...

DIRECTRICE
Asseyez-vous !

La DIRECTRICE lui tend un stylo.
`;
    const p = passageOf(doc, src, src.indexOf('La DIRECTRICE ouvre'), src.indexOf('stylo.') + 6, { dialogueShown: true });
    expect(p.action).toBe('La DIRECTRICE ouvre son tiroir. [Rép (ton saccadé)]. FLORA prend le contrat. [Rép]. La DIRECTRICE lui tend un stylo.');
  });
  it('range chaque plan dans la séquence de sa scène, créée au besoin, à sa place chronologique', () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    doc.scenario = SCRIPT;
    const add = (frag: string) => {
      const [a, b] = at(frag);
      return createShotFromPassage(doc, SCRIPT, a, b, { dialogueShown: false })!;
    };
    const chaises = add('Devant elle, plusieurs chaises.');
    const seule = add('Elle est seule.');
    const arret = add("Flora s'arrête un instant.");
    const seqId = doc.shots[chaises].sequenceId;
    expect(doc.sequences[seqId].label).toBe('ENTREPRISE');
    expect(doc.sequences[seqId].shotIds).toEqual([arret, seule, chaises]);
    const rue = add('LÉA traverse la rue.');
    expect(doc.sequences[doc.shots[rue].sequenceId].label).toBe('RUE');
    expect(doc.shots[rue].subject).toBe('Léa');
    expect(doc.project.sequenceIds.indexOf(doc.shots[rue].sequenceId)).toBe(1);
    expect(doc.blocks[doc.shots[seule].actionBlockId].text).toBe('Elle est seule.');
    expect(chronologicalIndex(doc, seqId, SCRIPT.length)).toBe(3);
  });
});

describe('sélection sur plusieurs scènes', () => {
  const SRC = `INT. ENTREPRISE / OPEN SPACE - JOUR

FLORA regarde son ordinateur.

INT. ENTREPRISE / OPEN SPACE - JOUR

Les bureaux ont changé.

EXT. RUE - NUIT

LÉA traverse la rue.
`;
  it('découpe la sélection scène par scène, sans les en-têtes', async () => {
    const { splitByScene } = await import('./scriptToShot');
    const a = SRC.indexOf('ordinateur');
    const b = SRC.indexOf('traverse') + 5;
    const parts = splitByScene(SRC, a, b).map((p) => SRC.slice(p.start, p.end));
    expect(parts).toEqual(['ordinateur.', 'Les bureaux ont changé.', 'LÉA trave']);
  });
  it('range chaque morceau dans la séquence de sa scène, même au même lieu', async () => {
    const { createShotsFromSelection } = await import('./scriptToShot');
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    doc.scenario = SRC;
    const ids = createShotsFromSelection(doc, SRC, SRC.indexOf('FLORA'), SRC.indexOf('rue.') + 4, { dialogueShown: true });
    expect(ids).toHaveLength(3);
    const seqs = ids.map((id) => doc.shots[id].sequenceId);
    expect(new Set(seqs).size).toBe(3);
    expect(seqs.map((s) => doc.sequences[s].label)).toEqual(['ENTREPRISE / OPEN SPACE', 'ENTREPRISE / OPEN SPACE', 'RUE']);
    expect(doc.project.sequenceIds.indexOf(seqs[0])).toBeLessThan(doc.project.sequenceIds.indexOf(seqs[1]));
    // Une nouvelle sélection dans la 2e scène retrouve la 2e séquence.
    const again = createShotsFromSelection(doc, SRC, SRC.indexOf('Les bureaux'), SRC.indexOf('changé.') + 7, { dialogueShown: true });
    expect(doc.shots[again[0]].sequenceId).toBe(seqs[1]);
  });
});

describe('séquences importées sans plan', () => {
  const SCENES = `INT. ENTREPRISE / ACCUEIL - JOUR

Flora entre. Elle **hésite** [[note de mise en scène]] devant le comptoir.

MARC
(sans lever les yeux)
Vous êtes en avance.

FLORA
Comme toujours.

EXT. RUE - NUIT

LÉA
On y va ?

INT. COULOIR - JOUR
`;
  const setup = async () => {
    const { importScenes } = await import('./fountain');
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    importScenes(doc, SCENES);
    return doc;
  };

  it('un passage par paragraphe d’action et par réplique, sans l’en-tête', async () => {
    const { sequencePassages } = await import('./scriptToShot');
    const doc = await setup();
    const [acc, rue, couloir] = doc.project.sequenceIds;
    const parts = sequencePassages(doc, acc).map((p) => [p.kind, SCENES.slice(p.start, p.end)]);
    expect(parts).toEqual([
      ['action', 'Flora entre. Elle **hésite** [[note de mise en scène]] devant le comptoir.'],
      ['dialogue', 'MARC\n(sans lever les yeux)\nVous êtes en avance.'],
      ['dialogue', 'FLORA\nComme toujours.'],
    ]);
    expect(sequencePassages(doc, rue)).toHaveLength(1);
    expect(sequencePassages(doc, couloir)).toEqual([]);
  });

  it('aperçu : résumé écrit, sinon le texte imprimé de l’action, sinon la première réplique', async () => {
    const { sequenceExcerpt } = await import('./scriptToShot');
    const doc = await setup();
    const [acc, rue, couloir] = doc.project.sequenceIds;
    expect(sequenceExcerpt(doc, acc)).toBe('Flora entre. Elle hésite devant le comptoir.');
    expect(sequenceExcerpt(doc, rue)).toBe('LÉA : On y va ?');
    expect(sequenceExcerpt(doc, couloir)).toBe('');
    doc.sequences[couloir].summary = '  Flora   attend. ';
    expect(sequenceExcerpt(doc, couloir)).toBe('Flora attend.');
    expect(sequenceExcerpt(doc, acc, undefined, 20)).toBe('Flora entre. Elle…');
  });

  it('crée les plans d’un coup, dans l’ordre du texte, liés à leur passage', async () => {
    const { shotsFromSequenceText } = await import('./scriptToShot');
    const { checkInvariants } = await import('./ops');
    const doc = await setup();
    const acc = doc.project.sequenceIds[0];
    const ids = shotsFromSequenceText(doc, acc, { dialogueShown: true });
    expect(ids).toHaveLength(3);
    expect(doc.sequences[acc].shotIds).toEqual(ids);
    const blocks = ids.map((id) => doc.blocks[doc.shots[id].actionBlockId]);
    expect(blocks[0].text).toContain('Flora entre.');
    expect(blocks[1].dialogue).toBe('MARC : Vous êtes en avance.');
    expect(doc.shots[ids[2]].subject).toBe('Flora');
    expect(blocks.every((b) => b.scenarioAnchor)).toBe(true);
    expect(checkInvariants(doc)).toEqual([]);
    // Sans scène liée (ou sans texte) : rien n'est créé.
    expect(shotsFromSequenceText(doc, doc.project.sequenceIds[2], { dialogueShown: true })).toEqual([]);
    delete doc.sequences[doc.project.sequenceIds[1]].scenarioAnchor;
    expect(shotsFromSequenceText(doc, doc.project.sequenceIds[1], { dialogueShown: true })).toEqual([]);
  });
});

describe('minutage', () => {
  it('ne compte pas les repères de réplique', async () => {
    const { countWords } = await import('./text');
    expect(countWords('Elle entre. [Rép (ton saccadé)]. Elle sort. [Rép]. Fin.')).toBe(5);
  });
});

describe('passages versés dans une cellule Action', () => {
  const setup = () => {
    const doc = createProjectDoc({ title: 't', format: 'fiction' });
    doc.scenario = SCRIPT;
    const seq = addSequence(doc, undefined, { label: 'x' }, false);
    const shot = addShot(doc, seq);
    return { doc, shot };
  };
  it('texte versé : l’action seule, sinon la réplique', () => {
    const { doc } = setup();
    expect(passageInsertText(doc, SCRIPT, ...at('Elle est seule. Devant'))).toBe('Elle est seule. Devant');
    expect(passageInsertText(doc, SCRIPT, ...at('Tu es en avance'))).toBe('MARC : Tu es en avance');
  });
  it('ancre posée, étendue dans la même scène, laissée telle quelle dans une autre', () => {
    const { doc, shot } = setup();
    const block = () => doc.blocks[doc.shots[shot].actionBlockId];
    const [a, b] = at('Elle est seule.');
    anchorShotToPassages(doc, shot, [{ start: a, end: b }]);
    expect(block().scenarioAnchor).toEqual({ start: a, end: b });
    const [c, d] = at('Devant elle, plusieurs chaises.');
    anchorShotToPassages(doc, shot, [{ start: c, end: d }]);
    expect(block().scenarioAnchor).toEqual({ start: a, end: d });
    anchorShotToPassages(doc, shot, [{ start: at('LÉA traverse')[0], end: at('LÉA traverse')[1] }]);
    expect(block().scenarioAnchor).toEqual({ start: a, end: d });
    // Passage hors du texte : ignoré.
    anchorShotToPassages(doc, shot, [{ start: 0, end: SCRIPT.length + 5 }]);
    expect(block().scenarioAnchor).toEqual({ start: a, end: d });
  });
});
