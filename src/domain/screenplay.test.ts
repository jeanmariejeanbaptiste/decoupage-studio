import { describe, expect, it } from 'vitest';
import { diffRange, parseFountain } from './fountain';
import {
  blocksFromSource,
  caretToSource,
  cycleType,
  insertText,
  mergeWithPrevious,
  rangeText,
  replaceRange,
  scriptStats,
  serialize,
  setBlockText,
  setBlockType,
  sourceToCaret,
  speakersOf,
  parseTitlePage,
  setTitlePage,
  smartType,
  splitBlock,
  type ScriptDoc,
} from './screenplay';

const SRC = `Title: La Consigne
Credit: Scénario

INT. GARE — HALL - JOUR

Le hall bruisse.
Les annonces se succèdent.

LÉA
(essoufflée)
Je ne sais pas encore.
Une nuit, peut-être.

GUICHETIER
Alors on dira trois.

> FONDU AU NOIR.

EXT. PARVIS - NUIT

Marc attend.
`;

const types = (d: ScriptDoc) => d.blocks.map((b) => b.type);
const reparse = (d: ScriptDoc) => types(blocksFromSource(serialize(d).source));

describe('scénario en blocs', () => {
  it('retrouve exactement la source quand rien ne change', () => {
    for (const src of [SRC, '', 'Action seule.', '\n\nINT. A - JOUR\n\n\nTexte\r\nsur deux lignes\r\n', '.FORCÉ\n\n!TOUT EN CAPITALES\n\n@léa\nSalut.']) {
      expect(serialize(blocksFromSource(src)).source).toBe(src);
    }
  });

  it('regroupe actions et répliques sur plusieurs lignes', () => {
    const d = blocksFromSource(SRC);
    expect(types(d)).toEqual(['title', 'heading', 'action', 'character', 'parenthetical', 'dialogue', 'character', 'dialogue', 'transition', 'heading', 'action']);
    expect(d.blocks[2].text).toBe('Le hall bruisse.\nLes annonces se succèdent.');
    expect(d.blocks[5].text).toBe('Je ne sais pas encore.\nUne nuit, peut-être.');
  });

  it('une modification ne touche que sa zone (les ancres restent justes)', () => {
    const d = blocksFromSource(SRC);
    const id = d.blocks[7].id;
    const after = serialize(setBlockText(d, id, 'Alors on dira quatre.')).source;
    const r = diffRange(SRC, after);
    expect(SRC.slice(r.at, r.at + r.removed)).toBe('trois');
    expect(after.slice(r.at, r.at + r.inserted)).toBe('quatre');
  });

  it('Entrée : en-tête → action, personnage → réplique', () => {
    let d = blocksFromSource('INT. CUISINE - JOUR');
    let e = splitBlock(d, { id: d.blocks[0].id, offset: d.blocks[0].text.length });
    expect(e.doc.blocks[1].type).toBe('action');
    d = setBlockText(e.doc, e.caret.id, 'Léa entre.');
    e = splitBlock(d, { id: e.caret.id, offset: 'Léa entre.'.length });
    d = setBlockType(e.doc, e.caret.id, 'character').doc;
    d = setBlockText(d, e.caret.id, 'léa');
    e = splitBlock(d, { id: e.caret.id, offset: 3 });
    expect(e.doc.blocks[3].type).toBe('dialogue');
    d = setBlockText(e.doc, e.caret.id, 'Bonjour.');
    const src = serialize(d).source;
    expect(src).toBe('INT. CUISINE - JOUR\n\nLéa entre.\n\nLÉA\nBonjour.');
    expect(parseFountain(src).map((x) => x.type)).toEqual(['heading', 'action', 'character', 'dialogue']);
  });

  it('Entrée en fin de ligne d’action : en-tête, personnage et transition reconnus', () => {
    expect(smartType('INT. CAFÉ DE LA GARE - NUIT', 'action')).toBe('heading');
    expect(smartType('ext. toit - aube', 'action')).toBe('heading');
    // Un nom en capitales devient personnage seulement s'il parle déjà ; sinon, Entrée est un retour à la ligne.
    const known = (n: string) => ['NINA', 'LÉA'].includes(n);
    expect(smartType('NINA', 'action', known)).toBe('character');
    expect(smartType('LÉA (V.O.)', 'action', known)).toBe('character');
    expect(smartType('NINA', 'action')).toBe('action');
    expect(smartType('FADE TO FIN', 'action', known)).toBe('action');
    expect(smartType('FONDU AU NOIR :', 'action')).toBe('transition');
    // Phrases criées, intérieurs du langage courant, ou autres types : inchangés.
    expect(smartType('BOUM !', 'action')).toBe('action');
    expect(smartType('Internet ne marche plus.', 'action')).toBe('action');
    expect(smartType('NINA', 'dialogue')).toBe('dialogue');
    // Après une réplique, le bloc proposé est un personnage : un en-tête tapé là est reconnu aussi.
    expect(smartType('INT. CAFÉ - NUIT', 'character')).toBe('heading');
    expect(smartType('COUPE FRANCHE :', 'character')).toBe('transition');
    expect(smartType('MARC', 'character')).toBe('character');
    expect(smartType('LA PORTE CLAQUE, PUIS PLUS RIEN.', 'action')).toBe('action');

    let d = blocksFromSource('Léa attend.');
    let e = splitBlock(d, { id: d.blocks[0].id, offset: 11 });
    d = setBlockText(e.doc, e.caret.id, 'INT. CAFÉ - NUIT');
    e = splitBlock(d, { id: e.caret.id, offset: 16 });
    expect(e.doc.blocks.map((b) => b.type)).toEqual(['action', 'heading', 'action']);
    // Entrée dans l'action vide : elle devient un en-tête de séquence (puis on la rend à l'action).
    const asHeading = splitBlock(e.doc, e.caret);
    expect(asHeading.doc.blocks.map((b) => b.type)).toEqual(['action', 'heading', 'heading']);
    expect(asHeading.caret).toEqual(e.caret);
    // Un nom inconnu reste une action ; Tab en fait un personnage.
    d = setBlockText(e.doc, e.caret.id, 'NINA');
    expect(splitBlock(d, { id: e.caret.id, offset: 4 }).doc.blocks.map((b) => b.type)).toEqual(['action', 'heading', 'action', 'action']);
    d = setBlockType(d, e.caret.id, 'character').doc;
    e = splitBlock(d, { id: e.caret.id, offset: 4 });
    expect(e.doc.blocks.map((b) => b.type)).toEqual(['action', 'heading', 'character', 'dialogue']);
    d = setBlockText(e.doc, e.caret.id, 'Bonsoir.');
    e = splitBlock(d, { id: e.caret.id, offset: 8 });
    // Après une réplique : un autre personnage ; Entrée sur ce nom vide ramène à l'action.
    expect(e.doc.blocks.at(-1)!.type).toBe('character');
    expect(splitBlock(e.doc, e.caret).doc.blocks.at(-1)!.type).toBe('action');
    expect(serialize(e.doc).source).toBe('Léa attend.\n\nINT. CAFÉ - NUIT\n\nNINA\nBonsoir.');
  });

  it('un personnage sans réplique reste un personnage (forcé)', () => {
    let d = blocksFromSource('Action.');
    const e = splitBlock(d, { id: d.blocks[0].id, offset: 7 });
    d = setBlockType(e.doc, e.caret.id, 'character').doc;
    d = setBlockText(d, e.caret.id, 'Marc');
    expect(serialize(d).source).toBe('Action.\n\n@MARC');
    expect(reparse(d)).toEqual(['action', 'character']);
  });

  it('une action en capitales ou qui ressemble à un en-tête est forcée', () => {
    let d = blocksFromSource('Texte.');
    d = setBlockText(d, d.blocks[0].id, 'INT. ce n’est pas un en-tête');
    expect(serialize(d).source).toBe('!INT. ce n’est pas un en-tête');
    d = setBlockText(d, d.blocks[0].id, 'BOUM\nLa porte claque.');
    expect(reparse(d)).toEqual(['action']);
  });

  it('un en-tête sans INT/EXT est forcé, en capitales', () => {
    let d = blocksFromSource('x');
    d = setBlockType(d, d.blocks[0].id, 'heading').doc;
    d = setBlockText(d, d.blocks[0].id, 'la plage au loin');
    expect(serialize(d).source).toBe('.LA PLAGE AU LOIN');
  });

  it('Tab fait tourner le type ; didascalie entre parenthèses', () => {
    expect(cycleType('action')).toBe('character');
    expect(cycleType('heading')).toBe('action');
    expect(cycleType('action', -1)).toBe('heading');
    expect(cycleType('dialogue')).toBe('parenthetical');
    const d = blocksFromSource('LÉA\nbas');
    const r = setBlockType(d, d.blocks[1].id, 'parenthetical');
    expect(r.text).toBe('(bas)');
    expect(serialize(r.doc).source).toBe('LÉA\n(bas)');
  });

  it('retour arrière en début de bloc : fusion avec le précédent', () => {
    const d = blocksFromSource('Un.\n\nDeux.');
    const e = mergeWithPrevious(d, d.blocks[1].id)!;
    expect(serialize(e.doc).source).toBe('Un. Deux.');
    expect(e.caret).toEqual({ id: d.blocks[0].id, offset: 4 });
  });

  it('remplacement sur plusieurs blocs', () => {
    const d = blocksFromSource('Un deux.\n\nTrois quatre.\n\nCinq.');
    const e = replaceRange(d, { id: d.blocks[0].id, offset: 3 }, { id: d.blocks[1].id, offset: 6 }, 'X ');
    expect(serialize(e.doc).source).toBe('Un X quatre.\n\nCinq.');
  });

  it('coller plusieurs lignes : des blocs Fountain insérés au curseur', () => {
    const d = blocksFromSource('Avant après.');
    const e = insertText(d, { id: d.blocks[0].id, offset: 6 }, 'MARC\nSalut.\n\nEXT. RUE - NUIT');
    expect(types(e.doc)).toEqual(['action', 'character', 'dialogue', 'heading', 'action']);
    expect(serialize(e.doc).source).toBe('Avant\n\nMARC\nSalut.\n\nEXT. RUE - NUIT\n\naprès.');
  });

  it('copie : Fountain des blocs sélectionnés', () => {
    const d = blocksFromSource('Un.\n\nLÉA\nSalut.');
    expect(rangeText(d, { id: d.blocks[0].id, offset: 0 }, { id: d.blocks[2].id, offset: 6 })).toBe('Un.\n\nLÉA\nSalut.');
  });

  it('positions : texte affiché ↔ source', () => {
    const d = blocksFromSource(SRC);
    const { spans } = serialize(d);
    const reply = d.blocks[5];
    const pos = caretToSource(d.blocks, spans, { id: reply.id, offset: 'Je ne sais pas encore.\nUne'.length })!;
    expect(SRC.slice(pos, pos + 5)).toBe(' nuit');
    expect(sourceToCaret(d.blocks, spans, pos)).toEqual({ id: reply.id, offset: 26 });
  });

  it('statistiques et personnages', () => {
    const d = blocksFromSource(SRC);
    const st = scriptStats(d.blocks);
    expect(st.scenes).toBe(2);
    expect(st.intExt.INT).toBe(1);
    expect(st.intExt.EXT).toBe(1);
    expect(st.characters.map((c) => c.name)).toEqual(['LÉA', 'GUICHETIER']);
    expect(speakersOf(d.blocks)).toEqual(['LÉA', 'GUICHETIER']);
  });

  it('page de titre : lue, réécrite, créée et retirée', () => {
    const d = blocksFromSource('Title: La Consigne\nCredit: Scénario de démonstration\n\nINT. GARE - JOUR\n\nLéa attend.');
    const tp = d.blocks.find((b) => b.type === 'title')!;
    expect(parseTitlePage(tp.text)).toEqual({ Title: 'La Consigne', Credit: 'Scénario de démonstration' });
    const d2 = setTitlePage(d, { Title: 'La Consigne', Author: 'Nina Roy', Contact: 'Paris\n06 00 00 00 00' });
    const src = serialize(d2).source;
    expect(src.startsWith('Title: La Consigne\nAuthor: Nina Roy\nContact: Paris\n    06 00 00 00 00\n\nINT. GARE - JOUR')).toBe(true);
    expect(parseTitlePage(blocksFromSource(src).blocks[0].text)).toEqual({ Title: 'La Consigne', Author: 'Nina Roy', Contact: 'Paris\n06 00 00 00 00' });
    expect(parseFountain(src)[0].type).toBe('title');
    // Tout vide : la page de titre disparaît ; absente : elle est créée en tête.
    const d3 = setTitlePage(d2, { Title: '', Author: '' });
    expect(d3.blocks.some((b) => b.type === 'title')).toBe(false);
    expect(setTitlePage(d3, { Title: 'Nouveau' }).blocks[0]).toMatchObject({ type: 'title', text: 'Title: Nouveau' });
    // Retour arrière juste après la page de titre : rien ne fusionne.
    expect(mergeWithPrevious(d2, d2.blocks[1].id)).toBeNull();
  });
});

describe('note du séquencier dans l’éditeur (relecture)', () => {
  it('6. copier un résumé garde sa note ; changer son type puis revenir au résumé la rend telle quelle', () => {
    const src = 'INT. A - JOUR\n\n= Phrase A. [[ds:etape=9;intrigue=B]]\n\nAa.\n\nINT. B - NUIT\n\nBb.\n';
    const d = blocksFromSource(src);
    const copied = rangeText(d, { id: d.blocks[0].id, offset: 0 }, { id: d.blocks[2].id, offset: d.blocks[2].text.length });
    expect(copied).toBe('INT. A - JOUR\n\n= Phrase A. [[ds:etape=9;intrigue=B]]\n\nAa.');
    const id = d.blocks[1].id;
    const asAction = setBlockType(d, id, 'action').doc;
    // Geste explicite : la phrase devient une action, la note n'est plus écrite.
    expect(serialize(asAction).source).toBe('INT. A - JOUR\n\nPhrase A.\n\nAa.\n\nINT. B - NUIT\n\nBb.\n');
    expect(serialize(setBlockType(asAction, id, 'synopsis').doc).source).toBe(src);
  });

  it('le texte d’un résumé garde son surlignage quand un voisin change', () => {
    const src = 'INT. A - JOUR\n\n= Léa [[=jaune]]trouve[[=]] la lettre. [[ds:etape=9]]\n\nAction.\n';
    const d = blocksFromSource(src);
    expect(d.blocks[1].text).toBe('Léa [[=jaune]]trouve[[=]] la lettre.');
    expect(serialize(setBlockText(d, d.blocks[2].id, '')).source).toBe('INT. A - JOUR\n\n= Léa [[=jaune]]trouve[[=]] la lettre. [[ds:etape=9]]\n');
  });
});
