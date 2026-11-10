import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { insertEntry, insertPart, setOutlineTag } from './outline';
import { layoutOutline, OUTLINE_PAGE, wrapOutline, type OutlineElement, type OutlineMeasure } from './outlineLayout';
import type { ProjectDoc } from './types';

/** Mesure fixe : un demi-corps par caractère. */
const measure: OutlineMeasure = (t, size) => t.length * size * 0.5;

const texts = (els: OutlineElement[]) => els.flatMap((e) => (e.kind === 'text' ? [e.text] : []));

function film(count: number, plots: string[] = ['A']): ProjectDoc {
  const doc = createProjectDoc({ title: 'La Consigne', format: 'fiction' });
  let src = '';
  for (let i = 1; i <= count; i++) {
    src = insertEntry(src, 'end', { intExt: 'INT.', location: `Lieu ${i}`, effect: 'JOUR', phrase: `Phrase de la séquence ${i}, assez longue pour tenir sur deux lignes dans la colonne du séquencier imprimé.` }).source;
    const plot = plots[(i - 1) % plots.length];
    if (plot !== 'A' || i % 3 === 0) src = setOutlineTag(src, i, { plot, ...(i % 3 === 0 ? { step: 9 } : {}) }).source;
  }
  doc.scenario = src;
  doc.research = { logline: 'Une femme dépose une valise et ne revient jamais la chercher.' };
  return doc;
}

describe('mise en page du séquencier', () => {
  it('coupe le texte à la largeur mesurée', () => {
    expect(wrapOutline('un deux trois quatre', 30, 10, 400, measure)).toEqual(['un', 'deux', 'trois', 'quatre']);
    expect(wrapOutline('un deux trois quatre', 60, 10, 400, measure)).toEqual(['un deux', 'trois quatre']);
  });

  it('pagine en A4 sans couper une entrée, tout dans les marges, pied de page numéroté', () => {
    const doc = film(40);
    const pages = layoutOutline(doc, { order: 'list', date: '10/11/2026', version: 'V2', measure });
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((p, i) => {
      const footer = p.elements[p.elements.length - 1];
      expect(footer).toMatchObject({ kind: 'text', text: `Séquencier · V2 · 10/11/2026 · page ${i + 1} / ${pages.length}`, size: 8, gray: true });
      for (const e of p.elements.slice(0, -1)) {
        expect(e.y).toBeGreaterThanOrEqual(OUTLINE_PAGE.top);
        expect(e.y).toBeLessThanOrEqual(OUTLINE_PAGE.bottom);
        expect(e.x).toBeGreaterThanOrEqual(OUTLINE_PAGE.left - 0.01);
        if (e.kind === 'text') expect(e.x + e.width).toBeLessThanOrEqual(OUTLINE_PAGE.right + 0.01);
      }
    });
    // Chaque séquence une fois, dans l'ordre ; en-tête et phrase sur la même page.
    const all = pages.flatMap((p) => texts(p.elements));
    const heads = all.filter((t) => /^INT\. LIEU \d+ - JOUR$/.test(t));
    expect(heads).toEqual(Array.from({ length: 40 }, (_, i) => `INT. LIEU ${i + 1} - JOUR`));
    for (const p of pages) {
      const t = texts(p.elements);
      for (const h of t.filter((x) => /^INT\. LIEU/.test(x))) expect(t.some((x) => x.startsWith(`Phrase de la séquence ${h.match(/\d+/)![0]},`))).toBe(true);
    }
    // En tête : titre, version, logline ; mesures à droite, alignées sur la marge.
    expect(texts(pages[0].elements).slice(0, 3)).toEqual(['La Consigne', 'V2', 'Une femme dépose une valise et ne revient jamais la chercher.']);
    const right = pages[0].elements.find((e) => e.kind === 'text' && e.text.startsWith('p. 1 · '));
    expect(right && right.x + (right.kind === 'text' ? right.width : 0)).toBeCloseTo(OUTLINE_PAGE.right);
  });

  it('écrit les parties, l’étape, et l’intrigue seulement quand le projet en a plusieurs', () => {
    const doc = film(3);
    doc.scenario = insertPart(doc.scenario!, 2, 'Acte II').source;
    const t = texts(layoutOutline(doc, { order: 'list', date: 'd', measure })[0].elements);
    expect(t).toContain('ACTE II');
    expect(t.indexOf('ACTE II')).toBeGreaterThan(t.indexOf('INT. LIEU 1 - JOUR'));
    expect(t.indexOf('ACTE II')).toBeLessThan(t.indexOf('INT. LIEU 2 - JOUR'));
    expect(t).toContain('Première révélation et décision');
    const two = film(3, ['A', 'B']);
    two.plots = [
      { key: 'A', name: 'Léa' },
      { key: 'B', name: 'La lettre' },
    ];
    const t2 = texts(layoutOutline(two, { order: 'list', date: 'd', measure })[0].elements);
    expect(t2).toContain('La lettre');
    expect(t2).toContain('Première révélation et décision · Léa');
  });

  it('Par intrigue : une section par intrigue retenue, ordre du récit, numéros d’origine', () => {
    const doc = film(6, ['A', 'B', 'C']);
    doc.plots = [
      { key: 'A', name: 'Léa' },
      { key: 'B', name: 'La lettre' },
    ];
    const t = layoutOutline(doc, { order: 'plots', date: 'd', measure }).flatMap((p) => texts(p.elements));
    const sections = t.filter((x) => ['Léa', 'La lettre', 'Intrigue C'].includes(x));
    expect(sections).toEqual(['Léa', 'La lettre', 'Intrigue C']);
    const order = t.filter((x) => /^INT\. LIEU/.test(x)).map((x) => Number(x.match(/\d+/)![0]));
    expect(order).toEqual([1, 4, 2, 5, 3, 6]);
    // Les numéros d'origine précèdent chaque en-tête.
    expect(t.slice(t.indexOf('INT. LIEU 4 - JOUR') - 2, t.indexOf('INT. LIEU 4 - JOUR'))).toContain('4');
    expect(t[t.indexOf('Léa') + 1]).toMatch(/^2 · \d+:\d\d$/);
    const only = layoutOutline(doc, { order: 'plots', plots: ['B'], date: 'd', measure }).flatMap((p) => texts(p.elements));
    expect(only.filter((x) => /^INT\. LIEU/.test(x))).toEqual(['INT. LIEU 2 - JOUR', 'INT. LIEU 5 - JOUR']);
    expect(only).not.toContain('Léa');
  });

  it('un intertitre ne reste jamais seul en bas de page', () => {
    const doc = film(60);
    let src = doc.scenario!;
    for (let n = 55; n >= 5; n -= 5) src = insertPart(src, n, `Partie ${n}`).source;
    doc.scenario = src;
    const pages = layoutOutline(doc, { order: 'list', date: 'd', measure });
    for (const p of pages) {
      const t = texts(p.elements).slice(0, -1);
      expect(/^PARTIE/.test(t[t.length - 1] ?? '')).toBe(false);
    }
  });
});
