import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addBreakdownItems } from './breakdown';
import { aggregateEquipment } from './equipment';
import { cleanTag, findTerm, foldKeepLength, marksIn, marksWith, sceneRangeOf, tagContext } from './tagging';

describe('dépouillement depuis le texte', () => {
  it('replie sans changer la longueur', () => {
    expect(foldKeepLength('Élève À LA Gare')).toBe('eleve a la gare');
    expect(foldKeepLength('œuvre')).toHaveLength(5);
  });

  it('trouve un terme en mot entier, pluriel compris', () => {
    const t = 'Deux valises. Une Valise cabossée ; les valisettes non.';
    expect(findTerm(t, 'valise').map(([a, b]) => t.slice(a, b))).toEqual(['valises', 'Valise']);
    expect(findTerm(t, 'valise cabossée')).toEqual([[18, 33]]);
  });

  it('nettoie une sélection', () => {
    expect(cleanTag(' « une valise cabossée », ')).toBe('Une valise cabossée');
    expect(cleanTag('...')).toBe('');
  });

  it('passage de la scène et repères', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[1];
    const r = sceneRangeOf(doc, seqId)!;
    const text = doc.scenario!.slice(r.start, r.end);
    expect(text.startsWith('INT. GARE — CONSIGNE')).toBe(true);
    addBreakdownItems(doc, seqId, 'accessoires', ['Ticket']);
    const marks = marksIn(doc, seqId, text);
    expect(marks.some((m) => m.item === 'Ticket' && !m.suggested)).toBe(true);
    expect(marks.some((m) => m.item === 'Valise' && m.suggested)).toBe(true);
  });
});

describe('repères du lexique, à la place du mot trouvé', () => {
  const corpus = [
    'Elle prend l’affiche et enlève ses lunettes ; il pleut, un taxi passe. Rouge à lèvres, robe.',
    'Elle est en train de chanter. Ève lit. Elle livre le colis au feu rouge.',
    'Il pose un livre sur le lit, prend le train.',
    'Elle se maquille, se coiffe les cheveux. Son portable et la clé. Sa bague. Une larme.',
    '  —  la ,  valise   ; les CLÉS !! Une   cigarette… au café, au lit.\n\nLe vent, un vent.',
    'Ça prend feu ! Mettre le feu, un feu de camp, les feux verts, le TGV, l’auto, une auto 🚗 rouge.',
  ];

  it('mêmes termes que la détection, aux bonnes positions', async () => {
    const { detectInText, detectSpans } = await import('./breakdown');
    const { buildRav3 } = await import('../../seed/rav3');
    for (const t of [...corpus, buildFiction().scenario!, buildRav3().scenario ?? '']) {
      const fromSpans: Record<string, string[]> = {};
      for (const sp of detectSpans(t)) if (!fromSpans[sp.cat]?.includes(sp.canon)) (fromSpans[sp.cat] ??= []).push(sp.canon);
      const expected = detectInText(t) as Record<string, string[]>;
      expect(Object.fromEntries(Object.entries(fromSpans).map(([c, l]) => [c, [...l].sort()]))).toEqual(Object.fromEntries(Object.entries(expected).map(([c, l]) => [c, [...l].sort()])));
    }
    const t = corpus[4];
    const words = detectSpans(t).map((sp) => t.slice(sp.start, sp.end));
    expect(words).toEqual(['valise', 'CLÉS', 'cigarette', 'vent', 'vent']);
    expect(detectSpans(corpus[5]).map((sp) => corpus[5].slice(sp.start, sp.end))).toEqual(['feu', 'TGV', 'auto']);
  });

  it('souligne la forme trouvée, pas les faux repères', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    const words = (t: string) => marksIn(doc, seqId, t).filter((m) => m.suggested).map((m) => `${t.slice(m.start, m.end)}=${m.item}`);
    expect(words(corpus[3])).toEqual(['maquille=Maquillage', 'coiffe=Coiffure', 'cheveux=Coiffure', 'portable=Téléphone', 'clé=Clés', 'bague=Bagues', 'larme=Larmes']);
    expect(words('Il est en train de lire. Il lit le journal au feu rouge.')).toEqual(['journal=Journal']);
    // Déjà dépouillés : repérés partout, sauf au cœur d'une expression trompeuse (« en train de », « feu rouge »).
    addBreakdownItems(doc, seqId, 'vehicules', ['Train']);
    addBreakdownItems(doc, seqId, 'accessoires', ['Lit', 'Téléphone', 'Sac', 'Café']);
    addBreakdownItems(doc, seqId, 'effets', ['Feu']);
    const show = (t: string) => marksIn(doc, seqId, t).map((m) => `${t.slice(m.start, m.end)}=${m.item}${m.suggested ? '?' : ''}`);
    expect(show('Il est en train de lire au lit. Il lit. Le train part. Son portable sonne.')).toEqual(['lit=Lit', 'lit=Lit', 'train=Train', 'portable=Téléphone']);
    expect(show('Elle prend un vieux sac.')).toEqual(['sac=Sac']);
    expect(show('Café, puis CAFÉ au café.')).toEqual(['Café=Café', 'CAFÉ=Café', 'café=Café']);
    expect(show('Le grand lit défait.')).toEqual(['lit=Lit']);
    expect(show('INT. CAFÉ - JOUR')).toEqual(['CAFÉ=Café']);
    expect(show('Arrêt au feu rouge. Le feu prend. Ça va prendre feu.')).toEqual(['feu=Feu']);
  });

  it('une expression trompeuse saisie telle quelle reste repérée', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    addBreakdownItems(doc, seqId, 'effets', ['Feu rouge']);
    const t = 'Arrêt au feu rouge.';
    expect(marksIn(doc, seqId, t).map((m) => t.slice(m.start, m.end))).toEqual(['feu rouge']);
  });
});

describe('repères : déduits ou saisis', () => {
  it('un personnage nommé par les plans est déduit ; un élément saisi se retire', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[0];
    addBreakdownItems(doc, seqId, 'accessoires', ['Valise']);
    const marks = marksIn(doc, seqId, 'Léa porte une valise.');
    expect(marks.find((m) => m.item === 'Léa')).toMatchObject({ cat: 'personnages', derived: true });
    expect(marks.find((m) => m.item === 'Valise')?.derived).toBeUndefined();
    // Un personnage ajouté à la séquence (pas à ses plans) se retire d'ici.
    addBreakdownItems(doc, seqId, 'personnages', ['Marc']);
    expect(marksIn(doc, seqId, 'Marc arrive.').find((m) => m.item === 'Marc')?.derived).toBeUndefined();
  });

  it('le contexte d’une séquence sert tous ses paragraphes', () => {
    const doc = buildFiction();
    const seqId = doc.project.sequenceIds[2];
    const ctx = tagContext(doc, seqId);
    for (const t of ['Marc attend sous la pluie.', 'Une cigarette éteinte.']) expect(marksWith(ctx, t)).toEqual(marksIn(doc, seqId, t));
    // Le matériel du film, calculé une fois pour toutes les séquences, donne le même contexte.
    expect(tagContext(doc, seqId, aggregateEquipment(doc))).toEqual(ctx);
  });
});
