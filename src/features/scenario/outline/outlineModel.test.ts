import { describe, expect, it } from 'vitest';
import { moveEntry, outlineOf, outlineSequences } from '../../../domain/outline';
import { clock, dropMove, dropOnPart, filterSteps, pickChoices, plotKeys, renamePart, stepMove, weaveColumns } from './outlineModel';

const SRC = ['Title: Essai', '', 'INT. A - JOUR', '', '= Un.', '', '# Acte II', '', 'INT. B - NUIT', '', '= Deux. [[ds:intrigue=B]]', '', 'EXT. C - JOUR', '', '= Trois.', ''].join('\n');
const order = (src: string) => outlineSequences(src).map((x) => x.location);
const apply = (src: string, n: number, m: { to: number; edge: 'top' | 'bottom' } | null) => (m ? moveEntry(src, n, m.to, { edge: m.edge }).source : src);

describe('séquencier à l’écran', () => {
  it('⌥↑ / ⌥↓ franchissent un intertitre seul, puis la voisine', () => {
    const items = outlineOf(SRC);
    // B est la première de l'acte II : monter la sort de la partie, sans passer A.
    expect(stepMove(items, 2, -1)).toEqual({ to: 2, edge: 'top' });
    const out = apply(SRC, 2, stepMove(items, 2, -1));
    expect(order(out)).toEqual(['A', 'B', 'C']);
    expect(out.indexOf('INT. B')).toBeLessThan(out.indexOf('# Acte II'));
    // Pas suivant : B passe A.
    expect(order(apply(out, 2, stepMove(outlineOf(out), 2, -1)))).toEqual(['B', 'A', 'C']);
    // A descend : d'abord sous l'intertitre, puis après B.
    const down = apply(SRC, 1, stepMove(items, 1, 1));
    expect(order(down)).toEqual(['A', 'B', 'C']);
    expect(down.indexOf('INT. A')).toBeGreaterThan(down.indexOf('# Acte II'));
    expect(order(apply(down, 1, stepMove(outlineOf(down), 1, 1)))).toEqual(['B', 'A', 'C']);
    // Aux bords : rien.
    expect(stepMove(items, 3, 1)).toBeNull();
    expect(stepMove(outlineOf('INT. A - JOUR\n\nINT. B - JOUR\n'), 1, -1)).toBeNull();
  });

  it('un dépôt avant rejoint la partie, après reste au-dessus de l’intertitre', () => {
    expect(dropMove(3, 1, 'before')).toEqual({ to: 1, edge: 'bottom' });
    expect(dropMove(1, 3, 'after')).toEqual({ to: 3, edge: 'top' });
    expect(dropMove(1, 3, 'before')).toEqual({ to: 2, edge: 'bottom' });
    expect(dropMove(3, 1, 'after')).toEqual({ to: 2, edge: 'top' });
    // C lâchée juste avant B (sous « Acte II ») : rien ne change de partie pour B ; C passe devant.
    expect(order(apply(SRC, 3, dropMove(3, 2, 'before')))).toEqual(['A', 'C', 'B']);
    // C lâchée après A : au-dessus de l'intertitre.
    const above = apply(SRC, 3, dropMove(3, 1, 'after'));
    expect(above.indexOf('EXT. C')).toBeLessThan(above.indexOf('# Acte II'));
    // A lâchée sur l'intertitre : en tête de l'acte II.
    const onPart = apply(SRC, 1, dropOnPart(outlineOf(SRC), 1, 0));
    expect(order(onPart)).toEqual(['A', 'B', 'C']);
    expect(onPart.indexOf('INT. A')).toBeGreaterThan(onPart.indexOf('# Acte II'));
  });

  it('aucune ligne perdue, quel que soit le dépôt', () => {
    const lines = (s: string) => s.split('\n').filter((l) => l.trim()).sort();
    for (let from = 1; from <= 3; from++)
      for (let n = 1; n <= 3; n++)
        for (const place of ['before', 'after'] as const) if (n !== from) expect(lines(apply(SRC, from, dropMove(from, n, place)))).toEqual(lines(SRC));
  });

  it('renomme un intertitre sans toucher au reste', () => {
    const part = outlineOf(SRC).find((x) => x.kind === 'part')!;
    const e = renamePart(SRC, part, '  Acte   deux ');
    expect(e.source).toBe(SRC.replace('# Acte II', '# Acte deux'));
    const at = SRC.indexOf('INT. B');
    expect(e.source.slice(e.map(at, 'start'), e.map(at, 'start') + 6)).toBe('INT. B');
    expect(renamePart(SRC, part, '   ').source).toBe(SRC);
    expect(renamePart('## Sous-partie\n\nINT. A - JOUR\n', outlineOf('## Sous-partie\n\nINT. A - JOUR\n')[0] as never, 'Neuve').source).toBe('## Neuve\n\nINT. A - JOUR\n');
  });

  it('filtre les étapes par numéro ou par mots, la plus proche d’abord', () => {
    expect(filterSteps('')).toHaveLength(22);
    expect(filterSteps('2').map((s) => s.n)).toEqual([2, 20, 21, 22]);
    expect(filterSteps('desir')[0].n).toBe(5);
    expect(filterSteps('declencheur').map((s) => s.n)).toEqual([4]);
    expect(filterSteps('revelation decision').map((s) => s.n)).toEqual([9, 15, 17]);
    expect(filterSteps('zzz')).toHaveLength(0);
  });

  it('colonnes du tissage : nombre et durée par intrigue, intrigues lues dans le texte comprises', () => {
    const seqs = outlineSequences(SRC);
    const byN = new Map([
      [1, { page: 1, sec: 60 }],
      [2, { page: 1, sec: 30 }],
      [3, { page: 2, sec: 15 }],
    ]);
    expect(weaveColumns(seqs, ['A', 'B'], { byN })).toEqual([
      { key: 'A', count: 2, sec: 75 },
      { key: 'B', count: 1, sec: 30 },
    ]);
    expect(plotKeys([{ key: 'A' }], seqs)).toEqual(['A', 'B']);
  });

  it('durées et choix', () => {
    expect(clock(80)).toBe('1:20');
    expect(clock(5892)).toBe('1:38:12');
    expect(pickChoices(['GARE — HALL', 'PARVIS DE LA GARE', 'CAFÉ'], 'gare')).toEqual(['GARE — HALL', 'PARVIS DE LA GARE']);
    expect(pickChoices(['CAFÉ'], 'cafe')).toEqual([]);
    expect(pickChoices(['JOUR', 'NUIT'], '')).toEqual(['JOUR', 'NUIT']);
  });
});
