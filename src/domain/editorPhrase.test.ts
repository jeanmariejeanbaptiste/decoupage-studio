import { describe, expect, it } from 'vitest';
import { mergeBackwardVisible, mergeForwardVisible, outlinePhraseIds, splitPastPhrase, visibleCaret, visibleIndex } from './editorPhrase';
import { blocksFromSource, replaceRange, serialize, setBlockText, type ScriptDoc } from './screenplay';

const SRC = ['INT. GARE — CONSIGNE - JOUR', '', '= Léa ouvre le casier. [[ds:etape=9;intrigue=B]]', '', 'Léa pose la valise.', '', 'EXT. QUAI - NUIT', '', '[[Note de travail]]', '', '= Le train part.', '', '= Un autre résumé.', ''].join('\n');

const load = (src = SRC) => blocksFromSource(src);
const texts = (d: ScriptDoc) => d.blocks.map((b) => b.text);
const idOf = (d: ScriptDoc, text: string) => d.blocks.find((b) => b.text === text)!.id;

describe('phrases cachées dans l’éditeur', () => {
  it('seules les phrases des séquences sont cachées', () => {
    const d = load();
    const hidden = outlinePhraseIds(d.blocks);
    expect(d.blocks.filter((b) => hidden.has(b.id)).map((b) => b.text)).toEqual(['Léa ouvre le casier.', 'Le train part.']);
  });

  it('un en-tête vidé rend la phrase visible, rien n’est perdu', () => {
    const d = load();
    const emptied = setBlockText(d, d.blocks[0].id, '');
    expect([...outlinePhraseIds(emptied.blocks)].map((id) => emptied.blocks.find((b) => b.id === id)!.text)).toEqual(['Le train part.']);
    expect(serialize(emptied).source).toContain('= Léa ouvre le casier. [[ds:etape=9;intrigue=B]]');
  });

  it('le curseur saute la phrase', () => {
    const d = load();
    const hidden = outlinePhraseIds(d.blocks);
    expect(visibleIndex(d.blocks, 0, 1, hidden)).toBe(2);
    expect(visibleIndex(d.blocks, 2, -1, hidden)).toBe(0);
    const phrase = d.blocks[1].id;
    expect(visibleCaret(d.blocks, { id: phrase, offset: 3 }, hidden, 1)).toEqual({ id: d.blocks[2].id, offset: 0 });
    expect(visibleCaret(d.blocks, { id: phrase, offset: 3 }, hidden, -1)).toEqual({ id: d.blocks[0].id, offset: d.blocks[0].text.length });
    const c = { id: d.blocks[2].id, offset: 1 };
    expect(visibleCaret(d.blocks, c, hidden)).toBe(c);
  });

  it('⌫ en début de bloc joint le bloc visible précédent ; la phrase reste sous l’en-tête', () => {
    const d = load();
    const hidden = outlinePhraseIds(d.blocks);
    const r = mergeBackwardVisible(d, idOf(d, 'Léa pose la valise.'), hidden)!;
    expect(texts(r.doc).slice(0, 2)).toEqual(['INT. GARE — CONSIGNE - JOUR Léa pose la valise.', 'Léa ouvre le casier.']);
    expect(r.caret).toEqual({ id: d.blocks[0].id, offset: 'INT. GARE — CONSIGNE - JOUR'.length + 1 });
    expect(serialize(r.doc).source).toContain('= Léa ouvre le casier. [[ds:etape=9;intrigue=B]]');
  });

  it('⌫ dans un bloc vide après la phrase le retire seulement', () => {
    const d = load();
    const e = splitPastPhrase(d, { id: d.blocks[0].id, offset: d.blocks[0].text.length });
    const hidden = outlinePhraseIds(e.doc.blocks);
    const r = mergeBackwardVisible(e.doc, e.caret.id, hidden)!;
    expect(texts(r.doc)).toEqual(texts(d));
    expect(r.caret).toEqual({ id: d.blocks[0].id, offset: d.blocks[0].text.length });
    expect(serialize(r.doc).source).toBe(SRC);
  });

  it('Suppr en fin d’en-tête joint le bloc visible suivant ; rien à joindre en fin de texte', () => {
    const d = load();
    const hidden = outlinePhraseIds(d.blocks);
    const r = mergeForwardVisible(d, d.blocks[0].id, hidden)!;
    expect(texts(r.doc)[1]).toBe('Léa ouvre le casier.');
    expect(texts(r.doc)[0]).toBe('INT. GARE — CONSIGNE - JOUR Léa pose la valise.');
    const tail = load('INT. A - JOUR\n\n= Seule.\n');
    expect(mergeForwardVisible(tail, tail.blocks[0].id, outlinePhraseIds(tail.blocks))).toBeNull();
  });

  it('les blocs sans phrase gardent leur comportement', () => {
    const d = load('INT. A - JOUR\n\nAction.\n');
    const r = mergeBackwardVisible(d, d.blocks[1].id, new Set())!;
    expect(texts(r.doc)).toEqual(['INT. A - JOUR Action.']);
  });

  it('Entrée en fin d’en-tête crée le bloc après la phrase, qui le reste une fois le bloc rempli', () => {
    const d = load();
    const e = splitPastPhrase(d, { id: d.blocks[0].id, offset: d.blocks[0].text.length });
    expect(e.doc.blocks.findIndex((b) => b.id === e.caret.id)).toBe(2);
    expect(e.doc.blocks[2].type).toBe('action');
    const typed = setBlockText(e.doc, e.caret.id, 'Un homme attend.');
    expect(outlinePhraseIds(typed.blocks).has(d.blocks[1].id)).toBe(true);
    expect(serialize(typed).source.startsWith('INT. GARE — CONSIGNE - JOUR\n\n= Léa ouvre le casier. [[ds:etape=9;intrigue=B]]\n\nUn homme attend.\n\nLéa pose la valise.')).toBe(true);
  });

  it('Entrée ailleurs : comportement habituel', () => {
    const d = load();
    const mid = splitPastPhrase(d, { id: d.blocks[0].id, offset: 4 });
    expect(mid.doc.blocks.findIndex((b) => b.id === mid.caret.id)).toBe(1);
    const plain = load('INT. A - JOUR\n\nAction.\n');
    const e = splitPastPhrase(plain, { id: plain.blocks[0].id, offset: plain.blocks[0].text.length });
    expect(plain.blocks.length + 1).toBe(e.doc.blocks.length);
    expect(e.doc.blocks.findIndex((b) => b.id === e.caret.id)).toBe(1);
  });

  it('une sélection qui englobe la phrase la retire avec le reste', () => {
    const d = load();
    const r = replaceRange(d, { id: d.blocks[0].id, offset: 10 }, { id: d.blocks[2].id, offset: 4 }, '');
    const src = serialize(r.doc).source;
    expect(src).not.toContain('Léa ouvre');
    expect(src.startsWith('INT. GARE POSE LA VALISE.')).toBe(true);
  });
});
