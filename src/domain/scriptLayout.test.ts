import { describe, expect, it } from 'vitest';
import { fdxToFountain } from './fdx';
import { blocksFromSource } from './screenplay';
import { blankLinesBefore, layoutScript, lineX, parseEmphasis, plainText, printLines, SCRIPT_PAGE, titlePageLayout, wrapText } from './scriptLayout';
import completFountain from './__fixtures__/kit/modele-complet.fountain?raw';
import completFdx from './__fixtures__/kit/modele-complet.fdx?raw';
import completLines from './__fixtures__/kit/modele-complet.lines.txt?raw';
import eparpFountain from './__fixtures__/kit/sequences-eparpillees.fountain?raw';
import eparpLines from './__fixtures__/kit/sequences-eparpillees.lines.txt?raw';
import repetFountain from './__fixtures__/kit/sequences-repetees.fountain?raw';
import repetLines from './__fixtures__/kit/sequences-repetees.lines.txt?raw';
import actionsFountain from './__fixtures__/kit/actions.fountain?raw';
import actionsLines from './__fixtures__/kit/actions.lines.txt?raw';
import persoFdx from './__fixtures__/kit/personnages-repetes.fdx?raw';
import persoLines from './__fixtures__/kit/personnages-repetes.lines.txt?raw';
import persoLongFdx from './__fixtures__/kit/personnage-long.fdx?raw';
import persoLongLines from './__fixtures__/kit/personnage-long.lines.txt?raw';
import repliquesFdx from './__fixtures__/kit/repliques.fdx?raw';
import repliquesLines from './__fixtures__/kit/repliques.lines.txt?raw';
import didasFdx from './__fixtures__/kit/didascalie.fdx?raw';
import didasLines from './__fixtures__/kit/didascalie.lines.txt?raw';

/**
 * Lignes imprimées, au format des relevés faits sur les PDF du modèle (KIT Scenarist) :
 * page, rang depuis la première ligne de base, abscisse, texte (morceaux d'une même ligne réunis).
 */
function rendered(source: string): string {
  const { pages } = layoutScript(blocksFromSource(source).blocks);
  const out: string[] = [];
  pages.forEach((p, i) => {
    const byY = new Map<number, Array<{ x: number; text: string }>>();
    for (const l of printLines(p)) {
      const y = Math.round(l.y * 10) / 10;
      byY.set(y, [...(byY.get(y) ?? []), { x: l.x, text: l.runs.map((r) => r.text).join('') }]);
    }
    for (const [y, parts] of [...byY.entries()].sort((a, b) => a[0] - b[0])) {
      parts.sort((a, b) => a.x - b.x);
      let text = '';
      let cursor = parts[0].x;
      for (const part of parts) {
        const gap = Math.round((part.x - cursor) / SCRIPT_PAGE.cw);
        if (text && gap > 0) text += ' '.repeat(gap);
        text += part.text;
        cursor = part.x + part.text.length * SCRIPT_PAGE.cw;
      }
      out.push(`${i + 1}\t${Math.round((y - SCRIPT_PAGE.firstBaseline) / SCRIPT_PAGE.lineH)}\t${parts[0].x.toFixed(1)}\t${text}`);
    }
  });
  return out.join('\n') + '\n';
}

const parse = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => {
      const [p, r, x, ...t] = l.split('\t');
      return { key: `${p}\t${r}\t${t.join('\t').replace(/\s+/g, ' ').trim()}`, x: Number(x) };
    });

/** Compare au relevé du PDF : mêmes lignes, mêmes textes, abscisses à un demi-point près (arrondis du relevé). */
function expectSameLines(got: string, want: string) {
  const g = parse(got);
  const w = parse(want);
  const show = (l: { key: string; x: number }, ref?: { x: number }) => `${l.key}\t@${ref && Math.abs(ref.x - l.x) <= 0.5 ? ref.x : l.x}`;
  expect(g.map((l, i) => show(l, w[i]))).toEqual(w.map((l) => show(l)));
}

describe('mise en page du scénario (modèle KIT Scenarist fourni par l’utilisateur)', () => {
  it('reproduit ligne à ligne le modèle complet (17 pages) depuis le Fountain', () => {
    expectSameLines(rendered(completFountain), completLines);
  });
  it('reproduit le modèle complet depuis le fichier Final Draft', () => {
    expectSameLines(rendered(fdxToFountain(completFdx)), completLines);
  });
  it.each([
    ['en-têtes éparpillés', eparpFountain, eparpLines],
    ['en-têtes répétés', repetFountain, repetLines],
    ['actions en paragraphes', actionsFountain, actionsLines],
  ])('%s', (_n, src, lines) => {
    expectSameLines(rendered(src), lines);
  });
  it.each([
    ['personnages répétés (jamais seuls en bas de page)', persoFdx, persoLines],
    ['nom de personnage très long', persoLongFdx, persoLongLines],
    ['répliques sans personnage, coupées entre deux pages', repliquesFdx, repliquesLines],
    ['didascalie longue', didasFdx, didasLines],
  ])('%s (Final Draft)', (_n, fdx, lines) => {
    expectSameLines(rendered(fdxToFountain(fdx)), lines);
  });
});

describe('règles de mise en page', () => {
  it('coupe aux espaces et après un trait d’union ; un mot trop long est coupé net', () => {
    expect(wrapText('un deux trois', 7)).toEqual(['un deux', 'trois']);
    expect(wrapText('arc-en-ciel', 8)).toEqual(['arc-en-', 'ciel']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    // L'espace insécable ne coupe pas la ligne.
    expect(wrapText('mot insécable', 5)).toEqual(['mot i', 'nséca', 'ble']);
  });
  it('espaces : deux lignes avant une séquence, aucune dans une réplique', () => {
    expect(blankLinesBefore('action', 'heading')).toBe(2);
    expect(blankLinesBefore('character', 'dialogue')).toBe(0);
    expect(blankLinesBefore('dialogue', 'parenthetical')).toBe(0);
    expect(blankLinesBefore('dialogue', 'action')).toBe(1);
    expect(blankLinesBefore(undefined, 'heading')).toBe(0);
  });
  it('lit l’emphase Fountain sans imprimer les marques', () => {
    expect(parseEmphasis('un **gras** et *italique* _souligné_')).toEqual([
      { text: 'un ' },
      { text: 'gras', bold: true },
      { text: ' et ' },
      { text: 'italique', italic: true },
      { text: ' ' },
      { text: 'souligné', underline: true },
    ]);
    expect(plainText('5 * 3 = 15')).toBe('5 * 3 = 15');
    expect(plainText('\\*pas\\* d’italique')).toBe('*pas* d’italique');
  });
  it('un en-tête ne reste jamais seul en bas de page', () => {
    const filler = Array.from({ length: 27 }, (_, i) => `Action ${i}.`).join('\n\n');
    const { pages } = layoutScript(blocksFromSource(`INT. A - JOUR\n\n${filler}\n\nINT. B - NUIT\n\nLa suite.\n`).blocks);
    const heading = pages.flatMap((p, i) => p.lines.map((l) => ({ ...l, page: i }))).find((l) => l.text === 'INT. B - NUIT')!;
    expect(heading.page).toBe(1);
    expect(heading.row).toBe(0);
  });
  it('page de garde au gabarit KIT : titre souligné au 17e rang, blocs centrés sur la page, contact au 43e rang, date en bas centrée', () => {
    const pages = titlePageLayout({ Title: 'Consectetur', Credit: 'Écrit par', Author: 'Léa Martin', Source: 'D’après une idée', Contact: 'lea@exemple.fr\n06 00 00 00 00', 'Draft date': '2026' });
    expect(pages).toHaveLength(1);
    const [lines] = pages;
    const at = (t: string) => lines.find((l) => plainText(l.text) === t)!;
    expect(at('CONSECTETUR')).toMatchObject({ row: 16, align: 'center', text: '_CONSECTETUR_' });
    expect(at('Écrit par').row).toBe(20);
    expect(at('Léa Martin').row).toBe(22);
    expect(at('D’après une idée').row).toBe(24);
    expect(at('lea@exemple.fr')).toMatchObject({ row: 42, x: 108 });
    expect(at('2026')).toMatchObject({ row: SCRIPT_PAGE.lines - 1, align: 'center' });
    // Centrée sur la feuille (et non sur la colonne d'action).
    expect(lineX(at('2026')) + (4 * SCRIPT_PAGE.cw) / 2).toBeCloseTo(298.2, 0);
  });
  it('page de garde trop longue : rien n’est coupé, elle continue sur une page suivante', () => {
    const long = Array.from({ length: 120 }, (_, i) => `mot${i}`).join(' ');
    const pages = titlePageLayout({ Title: long, Source: long.repeat(4), Contact: long, 'Draft date': '2026' });
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) for (const l of p) expect(l.row).toBeLessThan(SCRIPT_PAGE.lines);
    const all = pages.flat().map((l) => plainText(l.text)).join(' ');
    expect(all).toContain('mot119');
    expect(pages.at(-1)!.at(-1)).toMatchObject({ text: '2026', row: SCRIPT_PAGE.lines - 1 });
  });
});

describe('emphase dans l’éditeur', () => {
  it('garde chaque caractère, marques à part', async () => {
    const { emphasisRuns } = await import('./scriptLayout');
    const t = 'Il **court** vers *elle*, _vite_.\n2*3 = 6';
    const runs = emphasisRuns(t);
    expect(runs.map((r) => r.text).join('')).toBe(t);
    expect(runs.find((r) => r.text === 'court')).toMatchObject({ bold: true });
    expect(runs.find((r) => r.text === 'elle')).toMatchObject({ italic: true });
    expect(runs.find((r) => r.text === 'vite')).toMatchObject({ underline: true });
    expect(runs.filter((r) => r.mark).length).toBe(6);
  });
});

describe('surlignage de révision', () => {
  it('posé, recouvert, retiré ; jamais imprimé', async () => {
    const { setHighlight, emphasisRuns, plainText } = await import('./scriptLayout');
    let t = 'Léa traverse le hall.';
    t = setHighlight(t, 4, 12, 'jaune').text;
    expect(t).toBe('Léa [[=jaune]]traverse[[=]] le hall.');
    expect(plainText(t)).toBe('Léa traverse le hall.');
    expect(emphasisRuns(t).find((r) => r.text === 'traverse')).toMatchObject({ highlight: 'jaune' });
    // Une autre couleur au milieu d'un passage surligné : le passage est coupé proprement.
    const inner = t.indexOf('vers');
    t = setHighlight(t, inner, inner + 4, 'vert').text;
    expect(t).toBe('Léa [[=jaune]]tra[[=]][[=vert]]vers[[=]][[=jaune]]e[[=]] le hall.');
    t = setHighlight(t, 0, t.length, undefined).text;
    expect(t).toBe('Léa traverse le hall.');
  });
});
