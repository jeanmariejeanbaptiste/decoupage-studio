import { describe, expect, it } from 'vitest';
import { applyPatches, enablePatches, produce, produceWithPatches } from 'immer';
import { createProjectDoc } from './factory';
import { importScenes } from './fountain';
import { addSequence, applyScenarioEdit, setSequenceSummary } from './ops';
import {
  carryOutline,
  formatOutlineTag,
  insertEntry,
  insertPart,
  isOutlinePhrase,
  moveEntry,
  nextPlotKey,
  outlineMeasures,
  outlineOf,
  outlineSequences,
  parseOutlineTag,
  plotName,
  plotsInUse,
  plotsOf,
  removeEntry,
  removePart,
  sceneOfSequence,
  sequenceSummary,
  setHeading,
  setOutlineTag,
  setPhrase,
  type SourceEdit,
} from './outline';
import { blocksFromSource, serialize } from './screenplay';
import { addComment } from './comments';
import type { ProjectDoc } from './types';

enablePatches();

const SCRIPT = [
  'Title: La Consigne',
  'Author: Léa Martin',
  '',
  'FONDU D’OUVERTURE.',
  '',
  '# Acte I',
  '',
  'INT. GARE — CONSIGNE - JOUR',
  '',
  '= Léa ouvre le casier et trouve la lettre. [[ds:etape=9;intrigue=B]]',
  '',
  'Léa pose la valise sur le comptoir.',
  '',
  'EXT. QUAI - NUIT #12#',
  '',
  '[[une note]]',
  '',
  '= Le train part sans elle.',
  '',
  '= Un résumé libre, invisible du séquencier.',
  '',
  'MARC',
  'Tu viens ?',
  '',
  '===',
  '',
  '# Acte II',
  '',
  'INT. CAFÉ - SOIR',
  '',
  'Léa attend.',
  '',
  '.',
  '',
  'Une ligne après un en-tête vide.',
  '',
  'EXT. RUE - AUBE',
  '',
].join('\n');

const seqs = (src: string) => outlineSequences(src);
const nonEmptyLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim())
    .sort();

/** Chaque caractère des morceaux déplacés se retrouve à sa nouvelle place. */
function expectExactMap(before: string, edit: SourceEdit, positions: number[]) {
  for (const p of positions) expect(edit.source[edit.map(p, 'start')]).toBe(before[p]);
}

describe('note du séquencier', () => {
  it('lit et écrit une note, aller-retour', () => {
    const t = parseOutlineTag('[[ds:etape=9;intrigue=B]]');
    expect(t).toEqual({ step: 9, plot: 'B' });
    expect(formatOutlineTag(t)).toBe('[[ds:etape=9;intrigue=B]]');
    expect(parseOutlineTag('etape=4')).toEqual({ step: 4 });
  });

  it('garde une clé ou une valeur inconnue, telle quelle', () => {
    const t = parseOutlineTag('[[ds:etape=climax;ton=sombre;intrigue=C]]');
    expect(t).toEqual({ step: 'climax', plot: 'C', extra: 'ton=sombre' });
    expect(formatOutlineTag(t)).toBe('[[ds:etape=climax;intrigue=C;ton=sombre]]');
    expect(parseOutlineTag('[[ds:etape=40]]').step).toBe('40');
  });

  it('sans note : rien ; intrigue A omise', () => {
    expect(parseOutlineTag(undefined)).toEqual({});
    expect(parseOutlineTag('')).toEqual({});
    expect(formatOutlineTag({})).toBe('');
    expect(formatOutlineTag({ plot: 'A' })).toBe('');
    expect(formatOutlineTag({ step: 3, plot: 'A' })).toBe('[[ds:etape=3]]');
  });
});

describe('screenplay : note du résumé', () => {
  it('retire la note du texte, la garde dans meta, et le bloc intact garde son texte', () => {
    const src = 'INT. A - JOUR\n\n= Léa part. [[ds:etape=9;intrigue=B]]\n\nAction.\n';
    const doc = blocksFromSource(src);
    const syn = doc.blocks[1];
    expect(syn.type).toBe('synopsis');
    expect(syn.text).toBe('Léa part.');
    expect(syn.meta).toBe('[[ds:etape=9;intrigue=B]]');
    expect(serialize(doc).source).toBe(src);
  });

  it('réécrit la note quand le texte du résumé change, et un résumé qui n’a qu’une note n’est pas vide', () => {
    const doc = blocksFromSource('INT. A - JOUR\n\n= Léa part. [[ds:etape=9]]\n');
    const blocks = doc.blocks.map((b) => (b.type === 'synopsis' ? { ...b, text: 'Léa reste.', raw: undefined, lineOffsets: undefined } : b));
    expect(serialize({ ...doc, blocks }).source).toBe('INT. A - JOUR\n\n= Léa reste. [[ds:etape=9]]\n');
    const empty = blocks.map((b) => (b.type === 'synopsis' ? { ...b, text: '' } : b));
    expect(serialize({ ...doc, blocks: empty }).source).toBe('INT. A - JOUR\n\n= [[ds:etape=9]]\n');
    const back = blocksFromSource('INT. A - JOUR\n\n= [[ds:etape=9]]\n').blocks[1];
    expect(back).toMatchObject({ type: 'synopsis', text: '', meta: '[[ds:etape=9]]' });
  });

  it('va-et-vient Fountain octet pour octet', () => {
    // (Un en-tête vide « . » est un bloc vide de l'éditeur : il ne s'écrit pas, hors sujet ici.)
    const text = SCRIPT.replace('\n.\n\n', '\n');
    expect(serialize(blocksFromSource(text)).source).toBe(text);
    const crlf = text.replace(/\n/g, '\r\n');
    expect(serialize(blocksFromSource(crlf)).source).toBe(crlf);
  });
});

describe('outlineOf', () => {
  it('lit parties et séquences, sans le prélude, en ignorant l’en-tête vide', () => {
    const items = outlineOf(SCRIPT);
    expect(items.map((x) => (x.kind === 'part' ? `# ${x.title}` : `${x.n} ${x.heading}`))).toEqual([
      '# Acte I',
      '1 INT. GARE — CONSIGNE - JOUR',
      '2 EXT. QUAI - NUIT',
      '# Acte II',
      '3 INT. CAFÉ - SOIR',
      '4 EXT. RUE - AUBE',
    ]);
  });

  it('découpe l’en-tête, lit la phrase, la note, le numéro imposé, et le premier « = » seulement', () => {
    const [a, b, c, d] = seqs(SCRIPT);
    expect(a).toMatchObject({ intExt: 'INT.', location: 'GARE — CONSIGNE', effect: 'JOUR', phrase: 'Léa ouvre le casier et trouve la lettre.', step: 9, plot: 'B', hasBody: true });
    expect(SCRIPT.slice(...a.phraseRange!)).toBe(a.phrase);
    expect(SCRIPT.slice(a.headingStart, a.headingEnd)).toBe('INT. GARE — CONSIGNE - JOUR');
    expect(b).toMatchObject({ forced: '12', location: 'QUAI', effect: 'NUIT', phrase: 'Le train part sans elle.', plot: 'A', hasBody: true });
    expect(b.step).toBeUndefined();
    expect(c).toMatchObject({ phrase: '', hasBody: true });
    expect(c.phraseRange).toBeUndefined();
    expect(d).toMatchObject({ phrase: '', hasBody: false, end: SCRIPT.length });
  });

  it('une ligne « = » après un bloc imprimé n’est pas la phrase', () => {
    const src = 'INT. A - JOUR\n\nAction.\n\n= Résumé libre.\n';
    expect(seqs(src)[0].phrase).toBe('');
  });

  it('isOutlinePhrase suit la même règle dans les blocs de l’éditeur', () => {
    const { blocks } = blocksFromSource(SCRIPT);
    const phrases = blocks.map((_, i) => i).filter((i) => isOutlinePhrase(blocks, i)).map((i) => blocks[i].text);
    expect(phrases).toEqual(['Léa ouvre le casier et trouve la lettre.', 'Le train part sans elle.']);
  });
});

describe('écriture d’une entrée', () => {
  it('setPhrase crée la ligne sous l’en-tête, puis la remplace en gardant la note', () => {
    const src = 'INT. A - JOUR\n\nAction.\n';
    const e1 = setPhrase(src, 1, 'Léa part.');
    expect(e1.source).toBe('INT. A - JOUR\n\n= Léa part.\n\nAction.\n');
    const e2 = setOutlineTag(e1.source, 1, { step: 4 });
    expect(e2.source).toBe('INT. A - JOUR\n\n= Léa part. [[ds:etape=4]]\n\nAction.\n');
    const e3 = setPhrase(e2.source, 1, 'Léa reste.');
    expect(e3.source).toBe('INT. A - JOUR\n\n= Léa reste. [[ds:etape=4]]\n\nAction.\n');
    // Phrase vidée : la note reste.
    expect(setPhrase(e3.source, 1, '').source).toBe('INT. A - JOUR\n\n= [[ds:etape=4]]\n\nAction.\n');
    // Ni phrase ni note : la ligne part.
    expect(setPhrase(e1.source, 1, '  ').source).toBe(src);
    // Les positions de l'action suivent.
    const at = src.indexOf('Action');
    expect(e1.source.slice(e1.map(at, 'start'), e1.map(at, 'start') + 6)).toBe('Action');
  });

  it('setPhrase sous un en-tête collé à l’action, et en fin de texte', () => {
    expect(setPhrase('.MONTAGE\nAction.', 1, 'Vite.').source).toBe('.MONTAGE\n\n= Vite.\n\nAction.');
    expect(setPhrase('INT. A - JOUR', 1, 'Vite.').source).toBe('INT. A - JOUR\n\n= Vite.');
  });

  it('setOutlineTag : intrigue posée puis retirée, étape inconnue gardée', () => {
    const src = 'INT. A - JOUR\n\n= Léa part. [[ds:etape=x;ton=sombre]]\n';
    const e = setOutlineTag(src, 1, { plot: 'C' });
    expect(e.source).toBe('INT. A - JOUR\n\n= Léa part. [[ds:etape=x;intrigue=C;ton=sombre]]\n');
    expect(setOutlineTag(e.source, 1, { plot: null, step: null }).source).toBe('INT. A - JOUR\n\n= Léa part. [[ds:ton=sombre]]\n');
    expect(setOutlineTag('INT. A - JOUR\n', 1, { step: 3 }).source).toBe('INT. A - JOUR\n\n= [[ds:etape=3]]\n');
  });

  it('setHeading réécrit l’en-tête et garde « #12# »', () => {
    const e = setHeading(SCRIPT, 2, { intExt: 'INT./EXT.', location: 'quai de la gare', effect: 'soir' });
    expect(e.source).toContain('\nINT./EXT. QUAI DE LA GARE - SOIR #12#\n');
    expect(seqs(e.source)[1]).toMatchObject({ location: 'QUAI DE LA GARE', effect: 'SOIR', forced: '12', phrase: 'Le train part sans elle.' });
    const kept = setHeading(SCRIPT, 1, { effect: 'NUIT' });
    expect(seqs(kept.source)[0].heading).toBe('INT. GARE — CONSIGNE - NUIT');
    expect(() => setHeading(SCRIPT, 1, { location: ' ' })).toThrow();
    // Sans préfixe : en-tête forcé.
    expect(setHeading('INT. A - JOUR\n', 1, { intExt: '', location: 'Montage', effect: '' }).source).toBe('.MONTAGE\n');
  });
});

describe('insertEntry, insertPart, removePart, removeEntry', () => {
  it('insère en fin de texte, après N, en tête (sous l’intertitre), et refuse sans lieu', () => {
    const end = insertEntry(SCRIPT, 'end', { intExt: 'INT.', location: 'Gare', effect: 'NUIT', phrase: 'Léa revient.' });
    expect(end.n).toBe(5);
    expect(end.source).toBe(`${SCRIPT}\nINT. GARE - NUIT\n\n= Léa revient.\n`);
    const after1 = insertEntry(SCRIPT, 1, { intExt: 'EXT.', location: 'Parvis', effect: 'JOUR', phrase: '' });
    expect(after1.n).toBe(2);
    expect(seqs(after1.source).map((s) => s.location)).toEqual(['GARE — CONSIGNE', 'PARVIS', 'QUAI', 'CAFÉ', 'RUE']);
    expect(after1.source).toContain('Léa pose la valise sur le comptoir.\n\nEXT. PARVIS - JOUR\n\nEXT. QUAI - NUIT #12#');
    const first = insertEntry(SCRIPT, 0, { intExt: 'INT.', location: 'Train', effect: 'JOUR', phrase: 'Départ.', step: 4, plot: 'B' });
    expect(first.n).toBe(1);
    expect(first.source).toContain('# Acte I\n\nINT. TRAIN - JOUR\n\n= Départ. [[ds:etape=4;intrigue=B]]\n\nINT. GARE');
    expect(() => insertEntry(SCRIPT, 'end', { intExt: 'INT.', location: '', effect: 'JOUR', phrase: 'x' })).toThrow();
    // Texte vide : le texte est créé.
    expect(insertEntry('', 'end', { intExt: 'INT.', location: 'Gare', effect: 'JOUR', phrase: 'Léa.' }).source).toBe('INT. GARE - JOUR\n\n= Léa.\n');
  });

  it('insère une partie avant une séquence, puis la retire (sa ligne seulement)', () => {
    const e = insertPart(SCRIPT, 2, 'Le quai');
    expect(e.source).toContain('comptoir.\n\n# Le quai\n\nEXT. QUAI');
    expect(outlineOf(e.source).filter((x) => x.kind === 'part').map((x) => x.kind === 'part' && x.title)).toEqual(['Acte I', 'Le quai', 'Acte II']);
    expect(removePart(e.source, 1).source).toBe(SCRIPT);
  });

  it('removeEntry supprime la séquence et son texte, sans toucher au reste', () => {
    const e = removeEntry(SCRIPT, 1);
    expect(seqs(e.source).map((s) => s.location)).toEqual(['QUAI', 'CAFÉ', 'RUE']);
    expect(e.source).toContain('# Acte I\n\nEXT. QUAI');
    expect(e.source).not.toContain('valise');
    const last = removeEntry(SCRIPT, 4);
    expect(last.source.endsWith('Une ligne après un en-tête vide.\n')).toBe(true);
  });
});

describe('moveEntry', () => {
  const simple = 'Title: X\n\nINT. A - JOUR\n\n= Phrase A.\n\nAction A.\n\nINT. B - JOUR\n\nAction B.\n\nINT. C - JOUR\n\nAction C.\n';

  it('première ↔ dernière, avec une ligne vide entre les morceaux, prélude en place', () => {
    const down = moveEntry(simple, 1, 3);
    expect(seqs(down.source).map((s) => s.location)).toEqual(['B', 'C', 'A']);
    expect(down.source).toBe('Title: X\n\nINT. B - JOUR\n\nAction B.\n\nINT. C - JOUR\n\nAction C.\n\nINT. A - JOUR\n\n= Phrase A.\n\nAction A.\n');
    const up = moveEntry(down.source, 3, 1);
    expect(up.source).toBe(simple);
  });

  it('les parties restent en place ; la séquence rejoint la partie où elle est déposée', () => {
    const e = moveEntry(SCRIPT, 4, 1);
    const order = outlineOf(e.source).map((x) => (x.kind === 'part' ? `#${x.title}` : x.location));
    expect(order).toEqual(['#Acte I', 'RUE', 'GARE — CONSIGNE', 'QUAI', '#Acte II', 'CAFÉ']);
    // Descendre au-delà de l'intertitre : par défaut, juste après la voisine.
    const d = moveEntry(SCRIPT, 1, 3);
    expect(outlineOf(d.source).map((x) => (x.kind === 'part' ? `#${x.title}` : x.location))).toEqual(['#Acte I', 'QUAI', '#Acte II', 'CAFÉ', 'GARE — CONSIGNE', 'RUE']);
    // Même numéro, changement de partie.
    const cross = moveEntry(SCRIPT, 2, 2, { edge: 'bottom' });
    expect(outlineOf(cross.source).map((x) => (x.kind === 'part' ? `#${x.title}` : x.location))).toEqual(['#Acte I', 'GARE — CONSIGNE', '#Acte II', 'QUAI', 'CAFÉ', 'RUE']);
    expect(moveEntry(SCRIPT, 2, 2).source).toBe(SCRIPT);
  });

  it('« === » placé avant l’en-tête suivant appartient au morceau, la page de garde ne bouge pas', () => {
    const e = moveEntry(SCRIPT, 2, 1);
    expect(e.source.startsWith('Title: La Consigne\nAuthor: Léa Martin\n\nFONDU D’OUVERTURE.\n\n# Acte I\n\nEXT. QUAI')).toBe(true);
    expect(e.source).toContain('Tu viens ?\n\n===\n\nINT. GARE');
  });

  it('conserve le multiensemble des lignes non vides, pour toute paire', () => {
    const n = seqs(SCRIPT).length;
    for (let a = 1; a <= n; a++)
      for (let b = 1; b <= n; b++)
        for (const edge of [undefined, 'top', 'bottom'] as const) {
          const e = moveEntry(SCRIPT, a, b, { edge });
          expect(nonEmptyLines(e.source)).toEqual(nonEmptyLines(SCRIPT));
          expect(seqs(e.source)).toHaveLength(n);
        }
  });

  it('garde CRLF', () => {
    const crlf = SCRIPT.replace(/\n/g, '\r\n');
    const e = moveEntry(crlf, 1, 4);
    expect(e.source.replace(/\r\n/g, '')).not.toContain('\n');
    expect(e.source.replace(/\r\n/g, '\n')).toBe(moveEntry(SCRIPT, 1, 4).source);
  });

  it('map exacte sur chaque caractère des morceaux, séparateurs vers la borne voisine', () => {
    const e = moveEntry(SCRIPT, 1, 4);
    const all = Array.from({ length: SCRIPT.length }, (_, i) => i).filter((i) => SCRIPT[i] !== '\n');
    // Hors des lignes vides entre morceaux, chaque caractère est retrouvé.
    expectExactMap(SCRIPT, e, all);
    const crlf = SCRIPT.replace(/\n/g, '\r\n');
    const c = moveEntry(crlf, 3, 1);
    expectExactMap(
      crlf,
      c,
      Array.from({ length: crlf.length }, (_, i) => i).filter((i) => crlf[i] !== '\n' && crlf[i] !== '\r'),
    );
    // Séparateur entre la séquence 1 et 2 : vers le début de la 2 (côté début), la fin de la 1 (côté fin).
    const gap = SCRIPT.indexOf('comptoir.') + 'comptoir.'.length + 1;
    const two = seqs(e.source).find((s) => s.location === 'QUAI')!;
    const one = seqs(e.source).find((s) => s.location === 'GARE — CONSIGNE')!;
    expect(e.map(gap, 'start')).toBe(two.headingStart);
    expect(e.map(gap, 'end')).toBe(e.source.indexOf('comptoir.') + 'comptoir.'.length);
    expect(one.n).toBe(4);
  });

  it('une ancre à cheval sur deux séquences est ramenée dans celle de son début', () => {
    const e = moveEntry(SCRIPT, 1, 4);
    const a = SCRIPT.indexOf('valise');
    const b = SCRIPT.indexOf('train part') + 5;
    const [s, t] = e.range!(a, b)!;
    expect(e.source.slice(s, t)).toBe('valise sur le comptoir.');
  });
});

describe('carryOutline', () => {
  const before = 'INT. GARE - JOUR\n\n= Léa arrive. [[ds:etape=4;intrigue=B]]\n\nLéa entre dans la gare avec sa valise rouge.\n\nEXT. QUAI - NUIT\n\n= Le train part.\n\nLe train quitte le quai dans un grand fracas.\n\nINT. BAR - SOIR\n\nMarc boit un café en silence au comptoir.\n';

  it('reporte phrase et note sur la scène retrouvée, rien sur une scène nouvelle, rien pour une disparue', () => {
    const after = 'INT. GARE - JOUR\n\nLéa entre dans la gare avec sa valise rouge et son billet.\n\nINT. TAXI - NUIT\n\nUn taxi attend devant la sortie nord.\n\nINT. BAR - SOIR\n\nMarc boit un café en silence au comptoir.\n';
    const out = carryOutline(before, after);
    const s = seqs(out);
    expect(s.map((x) => x.phrase)).toEqual(['Léa arrive.', '', '']);
    expect(s[0]).toMatchObject({ step: 4, plot: 'B' });
    expect(out).toContain('INT. GARE - JOUR\n\n= Léa arrive. [[ds:etape=4;intrigue=B]]\n\nLéa entre');
  });

  it('n’écrase jamais une phrase ou une note existante', () => {
    const after = before.replace('= Léa arrive. [[ds:etape=4;intrigue=B]]', '= Autre phrase.').replace('= Le train part.\n\n', '');
    const out = carryOutline(before, after);
    expect(seqs(out).map((x) => x.phrase)).toEqual(['Autre phrase.', 'Le train part.', '']);
    // La note manquait : elle est reprise, la phrase écrite reste.
    expect(seqs(out)[0]).toMatchObject({ phrase: 'Autre phrase.', step: 4, plot: 'B' });
    const own = before.replace('[[ds:etape=4;intrigue=B]]', '[[ds:etape=7]]').replace('= Le train part.\n\n', '');
    expect(seqs(carryOutline(before, own))[0]).toMatchObject({ phrase: 'Léa arrive.', step: 7, plot: 'A' });
  });
});

describe('intrigues', () => {
  it('par défaut, l’intrigue principale ; une lettre inconnue s’affiche « Intrigue X »', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    expect(plotsOf(doc)).toEqual([{ key: 'A', name: 'Intrigue principale' }]);
    expect(plotName(doc, 'A')).toBe('Intrigue principale');
    expect(plotName(doc, 'D')).toBe('Intrigue D');
    doc.plots = [
      { key: 'A', name: 'Léa' },
      { key: 'B', name: 'La lettre' },
    ];
    expect(plotName(doc, 'B')).toBe('La lettre');
    expect(nextPlotKey(doc)).toBe('C');
  });

  it('plotsInUse balaie le texte courant et celui de chaque version', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    doc.scenario = 'INT. A - JOUR\n\n= x [[ds:intrigue=B]]\n';
    doc.versions = [
      { id: 'v1', name: 'V1', createdAt: '', slice: { scenario: 'INT. A - JOUR\n\n= y [[ds:intrigue=C]]\n\nINT. B - JOUR\n' } },
      { id: 'v2', name: 'V2', createdAt: '' },
    ] as unknown as ProjectDoc['versions'];
    expect([...plotsInUse(doc)].sort()).toEqual(['A', 'B', 'C']);
    expect(nextPlotKey(doc)).toBe('D');
  });
});

describe('mesures', () => {
  it('page imprimée et durée de chaque séquence ; une phrase n’y change rien', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    doc.scenario = 'INT. A - JOUR\n\nAction.\n\nINT. B - NUIT\n\nAutre action.\n';
    const m = outlineMeasures(doc);
    expect(m.byN.get(1)!.page).toBe(1);
    expect(m.byN.get(1)!.sec + m.byN.get(2)!.sec).toBeCloseTo(m.total);
    const withPhrase = { ...doc, scenario: setPhrase(setPhrase(doc.scenario, 1, 'Une phrase.').source, 2, 'Une autre.').source };
    const m2 = outlineMeasures(withPhrase);
    expect(m2.total).toBeCloseTo(m.total);
    expect(m2.byN.get(1)!.sec).toBeCloseTo(m.byN.get(1)!.sec);
  });
});

// --- Application au projet ---------------------------------------------------------------------

function project(src: string): ProjectDoc {
  const doc = createProjectDoc({ title: 'T', format: 'fiction' });
  importScenes(doc, src);
  return doc;
}

const SRC3 = 'INT. GARE - JOUR\n\nLéa entre dans la gare.\n\nEXT. QUAI - NUIT\n\nLe train part.\n\nINT. BAR - SOIR\n\nMarc boit.\n';

describe('applyScenarioEdit', () => {
  it('recale les ancres des actions, des séquences et des commentaires', () => {
    const doc = project(SRC3);
    const [s1, s2] = doc.project.sequenceIds;
    const at = SRC3.indexOf('Le train part.');
    const next = produce(doc, (d) => {
      const bId = Object.keys(d.blocks)[0] ?? null;
      void bId;
      d.blocks.x = { id: 'x', sequenceId: s2, text: 'Le train part.', scenarioAnchor: { start: at, end: at + 14 } };
      addComment(d, { kind: 'script', start: at, end: at + 9, quote: 'Le train ' }, 'Moi', 'Trop court');
    });
    const edited = produce(next, (d) => applyScenarioEdit(d, setPhrase(d.scenario!, 1, 'Léa arrive.')));
    const a = edited.blocks.x.scenarioAnchor!;
    expect(edited.scenario!.slice(a.start, a.end)).toBe('Le train part.');
    const c = edited.comments![0].anchor as { start: number; end: number };
    expect(edited.scenario!.slice(c.start, c.end)).toBe('Le train ');
    const q = edited.sequences[s2].scenarioAnchor!;
    expect(edited.scenario!.slice(q.start, q.start + 16)).toBe('EXT. QUAI - NUIT');
    expect(sceneOfSequence(edited, s1)).toBe(1);
  });

  it('reorderCut : le découpage suit le texte quand il le suivait, en une seule annulation', () => {
    const doc = project(SRC3);
    const ids = doc.project.sequenceIds.slice();
    const [next, patches, inverse] = produceWithPatches(doc, (d) => applyScenarioEdit(d, moveEntry(d.scenario!, 3, 1), { reorderCut: true }));
    expect(next.project.sequenceIds).toEqual([ids[2], ids[0], ids[1]]);
    expect(seqs(next.scenario!).map((s) => s.location)).toEqual(['BAR', 'GARE', 'QUAI']);
    for (const id of ids) expect(next.scenario!.slice(next.sequences[id].scenarioAnchor!.start).startsWith(`${doc.scenario!.slice(doc.sequences[id].scenarioAnchor!.start, doc.sequences[id].scenarioAnchor!.start + 8)}`)).toBe(true);
    expect(patches.length).toBeGreaterThan(0);
    expect(applyPatches(next, inverse)).toEqual(doc);
  });

  it('reorderCut : une séquence hors texte garde sa place', () => {
    const doc = project(SRC3);
    const free = addSequence(doc, 1, { label: 'INTERVIEW' }, false);
    const ids = doc.project.sequenceIds.slice();
    const next = produce(doc, (d) => applyScenarioEdit(d, moveEntry(d.scenario!, 1, 3), { reorderCut: true }));
    expect(next.project.sequenceIds).toEqual([ids[2], free, ids[3], ids[0]]);
  });

  it('reorderCut : ne touche pas un découpage monté autrement', () => {
    const doc = project(SRC3);
    const ids = doc.project.sequenceIds.slice();
    const mounted = produce(doc, (d) => {
      d.project.sequenceIds = [ids[1], ids[0], ids[2]];
    });
    const next = produce(mounted, (d) => applyScenarioEdit(d, moveEntry(d.scenario!, 3, 1), { reorderCut: true }));
    expect(next.project.sequenceIds).toEqual([ids[1], ids[0], ids[2]]);
    expect(seqs(next.scenario!)[0].location).toBe('BAR');
  });
});

describe('résumé unique', () => {
  it('séquence rapprochée : la phrase fait foi, l’écriture va dans le texte et vide seq.summary', () => {
    const doc = project(SRC3);
    const [s1] = doc.project.sequenceIds;
    const withOld = produce(doc, (d) => {
      d.sequences[s1].summary = 'Ancien résumé';
    });
    expect(sequenceSummary(withOld, s1)).toBe('Ancien résumé');
    const next = produce(withOld, (d) => setSequenceSummary(d, s1, 'Léa arrive.'));
    expect(next.sequences[s1].summary).toBeUndefined();
    expect(sequenceSummary(next, s1)).toBe('Léa arrive.');
    expect(next.scenario).toContain('INT. GARE - JOUR\n\n= Léa arrive.\n\nLéa entre');
  });

  it('séquence non rapprochée : seq.summary, comme avant', () => {
    const doc = project(SRC3);
    const free = addSequence(doc, undefined, { label: 'INTERVIEW' }, false);
    const next = produce(doc, (d) => setSequenceSummary(d, free, 'Paul raconte.'));
    expect(next.sequences[free].summary).toBe('Paul raconte.');
    expect(next.scenario).toBe(SRC3);
    expect(sequenceSummary(next, free)).toBe('Paul raconte.');
  });
});

// --- Relecture contradictoire : défauts corrigés ---------------------------------------------------

describe('défauts relevés en relecture', () => {
  const SRC = 'INT. GARE - JOUR\n\n= Phrase gare.\n\nLéa entre.\n\nEXT. QUAI - NUIT\n\n= Phrase quai.\n\nLe train part.\n\nINT. BAR - SOIR\n\n= Phrase bar.\n\nMarc boit.\n';

  it('1. supprimer une séquence détache la sienne ; les autres gardent leur lien et leur phrase', () => {
    for (const n of [2, 3]) {
      const doc = project(SRC);
      const ids = doc.project.sequenceIds.slice();
      const next = produce(doc, (d) => applyScenarioEdit(d, removeEntry(d.scenario!, n)));
      const gone = ids[n - 1];
      expect(next.sequences[gone].scenarioAnchor).toBeUndefined();
      expect(sceneOfSequence(next, gone)).toBeUndefined();
      expect(sequenceSummary(next, gone)).toBeUndefined();
      const kept = ids.filter((id) => id !== gone);
      expect(kept.map((id) => sceneOfSequence(next, id))).toEqual([1, 2]);
      const w = produce(next, (d) => setSequenceSummary(d, gone, 'Pour la supprimée'));
      expect(w.scenario).toBe(next.scenario);
      expect(w.sequences[gone].summary).toBe('Pour la supprimée');
    }
  });

  it('2. le moment n’est lu que s’il est connu ; le numéro en tête est gardé', () => {
    const src = 'INT. GARE — CONSIGNE\n\nAa.\n';
    expect(seqs(src)[0]).toMatchObject({ location: 'GARE — CONSIGNE' });
    expect(seqs(src)[0].effect).toBeUndefined();
    expect(setHeading(src, 1, { effect: 'JOUR' }).source).toBe('INT. GARE — CONSIGNE - JOUR\n\nAa.\n');
    expect(seqs('INT. GARE - PLUS TARD\n')[0]).toMatchObject({ location: 'GARE', effect: 'PLUS TARD' });
    const num = '12. INT. GARE - JOUR\n\nAa.\n';
    expect(seqs(num)[0]).toMatchObject({ lead: '12.', intExt: 'INT.', location: 'GARE', effect: 'JOUR' });
    expect(setHeading(num, 1, { intExt: 'EXT' }).source).toBe('12. EXT. GARE - JOUR\n\nAa.\n');
  });

  it('4. « [[ », « ]] », « /* » dans une phrase ou une note ne cassent pas l’analyse', () => {
    const src = 'INT. A - JOUR\n\nAa.\n\nINT. B - NUIT\n\nBb.\n\nINT. C - JOUR\n\n[[note]]\n\nCc.\n';
    for (const phrase of ['Léa hésite [[ ou pas', 'Fin ]] ici', 'Un /* commentaire', 'puis */ fin']) {
      const e = setPhrase(src, 1, phrase);
      expect(seqs(e.source).map((x) => x.location)).toEqual(['A', 'B', 'C']);
      expect(seqs(e.source)[0].phrase).not.toMatch(/\[\[|\]\]|\/\*|\*\//);
    }
    const t = setOutlineTag(src, 1, { step: 'a]]b;c', plot: 'B]' });
    expect(seqs(t.source).map((x) => x.location)).toEqual(['A', 'B', 'C']);
    expect(seqs(t.source)[0]).toMatchObject({ step: 'abc', plot: 'B' });
    const ins = insertEntry(src, 1, { intExt: 'INT.', location: 'Gare [[x', effect: 'JOUR', phrase: '/* oups' });
    expect(seqs(ins.source)).toHaveLength(4);
  });

  it('7. une séquence insérée devant un en-tête forcé collé est bien lue comme un en-tête', () => {
    const src = 'INT. A - JOUR\n\nAa.\n.CUISINE\n\nBb.\n';
    const e = insertEntry(src, 1, { intExt: 'INT', location: 'Neuf', effect: 'JOUR', phrase: 'p' });
    expect(e.n).toBe(2);
    expect(seqs(e.source).map((x) => x.location)).toEqual(['A', 'NEUF', 'CUISINE']);
  });

  it('8. pas de phrase reprise en double quand la scène porte déjà cette ligne « = »', () => {
    const before = 'INT. GARE - JOUR\n\n= Phrase gare. [[ds:etape=3]]\n\nLéa entre dans la gare avec une valise lourde.\n';
    const after = 'INT. GARE - JOUR\n\nLéa entre dans la gare avec une valise lourde.\n\n= Phrase gare.\n';
    expect(carryOutline(before, after)).toBe(after);
  });
});
