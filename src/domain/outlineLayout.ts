/**
 * Mise en page du séquencier pour l'export (PDF, Word) : pages A4 portrait d'éléments placés
 * (texte ou filet), indépendante du moteur de rendu. La largeur du texte est mesurée par une fonction
 * fournie (police réelle de l'export). Unités : points ; `y` est la ligne de base, depuis le haut.
 *
 * - En tête : titre du projet (16 pt, 600), version, logline.
 * - Chaque entrée : « 4  INT. GARE — CONSIGNE - JOUR » (10 pt, 600, capitales) avec « p. 4 · 1:20 » à
 *   droite ; la phrase (10,5 pt) ; « Première révélation et décision · Intrigue B » (8,5 pt, gris).
 * - Parties en intertitres ; pied de page « Séquencier · V2 · <date> · page 1 / 3 ».
 * - Ordre : Liste (ordre du récit, toutes intrigues) ou Par intrigue (une section par intrigue retenue,
 *   ordre du récit, numéros d'origine).
 */
import { mmss } from './chronometry';
import { outlineMeasures, outlineOf, plotName, plotsOf, type OutlineSequence } from './outline';
import { stepLabel } from './truby';
import type { ProjectDoc } from './types';
import { activeVersion } from './versions';

export type OutlineMeasure = (text: string, size: number, weight: OutlineWeight) => number;
export type OutlineWeight = 400 | 500 | 600;

export type OutlineElement =
  | { kind: 'text'; text: string; x: number; y: number; size: number; weight: OutlineWeight; gray: boolean; width: number; tracking?: number }
  | { kind: 'rule'; x: number; y: number; width: number };

export interface OutlinePage {
  number: number;
  elements: OutlineElement[];
}

export const OUTLINE_PAGE = {
  w: 595.28,
  h: 841.89,
  left: 56.7,
  right: 595.28 - 56.7,
  top: 64,
  /** Bas de la zone de texte (le pied de page est en dessous). */
  bottom: 841.89 - 72,
  footerBaseline: 841.89 - 36,
  /** Retrait du texte après le numéro. */
  indent: 28,
} as const;

export interface OutlineLayoutOptions {
  order: 'list' | 'plots';
  /** Par intrigue : intrigues retenues, dans l'ordre voulu (absent : toutes). */
  plots?: readonly string[];
  /** Date du pied de page, déjà écrite (« 10/11/2026 »). */
  date: string;
  /** Version du pied de page (absent : la version courante du projet). */
  version?: string;
  measure: OutlineMeasure;
}

/** Ligne placée relativement à son bloc. */
type Rel = { dy: number } & ({ kind: 'text'; text: string; x: number; size: number; weight: OutlineWeight; gray: boolean; tracking?: number; alignRight?: boolean } | { kind: 'rule'; x: number; width: number });

interface Block {
  height: number;
  lines: Rel[];
  /** Ne pas laisser seul en bas de page (intertitre, titre de section). */
  keepWithNext?: boolean;
  /** Espace avant le bloc (sauté en haut de page). */
  before: number;
}

const lineH = (size: number) => Math.round(size * 1.4 * 100) / 100;
const upper = (s: string) => s.toLocaleUpperCase('fr');

/** Coupe un texte en lignes d'au plus `width` points (un mot trop long reste seul sur sa ligne). */
export function wrapOutline(text: string, width: number, size: number, weight: OutlineWeight, measure: OutlineMeasure): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next, size, weight) > width) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

const tracked = (measure: OutlineMeasure, text: string, size: number, weight: OutlineWeight, tracking = 0) => measure(text, size, weight) + tracking * Math.max(0, text.length - 1);

export function layoutOutline(doc: ProjectDoc, opts: OutlineLayoutOptions): OutlinePage[] {
  const P = OUTLINE_PAGE;
  const { measure } = opts;
  const width = P.right - P.left;
  const textW = width - P.indent;
  const items = outlineOf(doc.scenario ?? '');
  const m = outlineMeasures(doc);
  const declared = plotsOf(doc);
  const blocks: Block[] = [];

  // En tête du document : titre, version, logline.
  {
    const lines: Rel[] = [];
    let y = 16;
    lines.push({ kind: 'text', dy: y, text: doc.project.title || 'Sans titre', x: P.left, size: 16, weight: 600, gray: false });
    const version = opts.version ?? activeVersion(doc)?.name ?? doc.project.version;
    if (version) {
      y += lineH(10) + 2;
      lines.push({ kind: 'text', dy: y, text: version, x: P.left, size: 10, weight: 400, gray: true });
    }
    const logline = doc.research?.logline?.trim();
    if (logline) {
      y += 6;
      for (const l of wrapOutline(logline, width, 10.5, 400, measure)) {
        y += lineH(10.5);
        lines.push({ kind: 'text', dy: y, text: l, x: P.left, size: 10.5, weight: 400, gray: false });
      }
    }
    blocks.push({ height: y + 8, lines, before: 0 });
  }

  const partBlock = (title: string): Block => {
    const t = upper(title);
    return {
      before: 14,
      keepWithNext: true,
      height: lineH(9) + 10,
      lines: [
        { kind: 'text', dy: 9, text: t, x: P.left, size: 9, weight: 600, gray: true, tracking: 0.9 },
        { kind: 'rule', dy: 9 + 5, x: P.left, width },
      ],
    };
  };

  const entryBlock = (it: OutlineSequence, withPlot: boolean): Block => {
    const lines: Rel[] = [];
    const me = m.byN.get(it.n);
    const right = me ? `p. ${me.page} · ${mmss(me.sec)}` : '';
    const rightW = right ? measure(right, 10, 400) + 12 : 0;
    let y = 0;
    wrapOutline(upper(it.heading), textW - rightW, 10, 600, measure).forEach((l, k) => {
      y += lineH(10);
      if (k === 0) {
        lines.push({ kind: 'text', dy: y, text: String(it.n), x: P.left, size: 10, weight: 600, gray: false });
        if (right) lines.push({ kind: 'text', dy: y, text: right, x: P.right, size: 10, weight: 400, gray: true, alignRight: true });
      }
      lines.push({ kind: 'text', dy: y, text: l, x: P.left + P.indent, size: 10, weight: 600, gray: false });
    });
    if (it.phrase.trim()) {
      y += 2;
      for (const l of wrapOutline(it.phrase, textW, 10.5, 400, measure)) {
        y += lineH(10.5);
        lines.push({ kind: 'text', dy: y, text: l, x: P.left + P.indent, size: 10.5, weight: 400, gray: false });
      }
    }
    const attrs = [it.step !== undefined ? stepLabel(it.step) : '', withPlot ? plotName(doc, it.plot) : ''].filter(Boolean).join(' · ');
    if (attrs) {
      y += 1;
      for (const l of wrapOutline(attrs, textW, 8.5, 400, measure)) {
        y += lineH(8.5);
        lines.push({ kind: 'text', dy: y, text: l, x: P.left + P.indent, size: 8.5, weight: 400, gray: true });
      }
    }
    return { height: y + 3, lines, before: 10 };
  };

  const sequences = items.filter((x): x is OutlineSequence => x.kind === 'sequence');
  if (opts.order === 'list') {
    // L'intrigue n'est écrite que si le projet en a plusieurs (ou qu'une autre que A est employée).
    const several = declared.length > 1 || sequences.some((x) => x.plot !== declared[0]?.key);
    for (const it of items) blocks.push(it.kind === 'part' ? partBlock(it.title) : entryBlock(it, several));
  } else {
    const used = [...new Set(sequences.map((x) => x.plot))];
    const all = [...declared.map((p) => p.key), ...used.filter((k) => !declared.some((p) => p.key === k)).sort()];
    const keys = opts.plots ? opts.plots.filter((k) => all.includes(k)) : all;
    for (const key of keys) {
      const own = sequences.filter((x) => x.plot === key);
      const total = own.reduce((t, x) => t + (m.byN.get(x.n)?.sec ?? 0), 0);
      const count = `${own.length} · ${mmss(total)}`;
      blocks.push({
        before: 22,
        keepWithNext: own.length > 0,
        height: lineH(12) + 10,
        lines: [
          { kind: 'text', dy: 12, text: plotName(doc, key), x: P.left, size: 12, weight: 600, gray: false },
          { kind: 'text', dy: 12, text: count, x: P.right, size: 10, weight: 400, gray: true, alignRight: true },
          { kind: 'rule', dy: 12 + 6, x: P.left, width },
        ],
      });
      // Les intertitres précèdent la première entrée de leur partie dans la section.
      let part: string | undefined;
      let shownPart: string | undefined;
      for (const it of items) {
        if (it.kind === 'part') {
          part = it.title;
          continue;
        }
        if (it.plot !== key) continue;
        if (part !== undefined && part !== shownPart) {
          blocks.push(partBlock(part));
          shownPart = part;
        }
        blocks.push(entryBlock(it, false));
      }
    }
  }

  // Pagination : un bloc ne se coupe pas ; un intertitre reste avec ce qui le suit.
  const pages: OutlinePage[] = [{ number: 1, elements: [] }];
  let y = P.top;
  let empty = true;
  const place = (b: Block, at: number) => {
    const page = pages[pages.length - 1];
    for (const l of b.lines) {
      if (l.kind === 'rule') page.elements.push({ kind: 'rule', x: l.x, y: at + l.dy, width: l.width });
      else {
        const w = tracked(measure, l.text, l.size, l.weight, l.tracking);
        page.elements.push({
          kind: 'text',
          text: l.text,
          x: l.alignRight ? l.x - w : l.x,
          y: at + l.dy,
          size: l.size,
          weight: l.weight,
          gray: l.gray,
          width: w,
          ...(l.tracking ? { tracking: l.tracking } : {}),
        });
      }
    }
  };
  blocks.forEach((b, k) => {
    let need = b.height + (empty ? 0 : b.before);
    // Intertitre : la place du bloc suivant aussi.
    for (let j = k; blocks[j]?.keepWithNext && blocks[j + 1]; j++) need += blocks[j + 1].before + blocks[j + 1].height;
    if (!empty && y + need > P.bottom) {
      pages.push({ number: pages.length + 1, elements: [] });
      y = P.top;
      empty = true;
    }
    if (!empty) y += b.before;
    place(b, y);
    y += b.height;
    empty = false;
  });

  const version = opts.version ?? activeVersion(doc)?.name ?? doc.project.version;
  for (const page of pages) {
    const text = ['Séquencier', version, opts.date, `page ${page.number} / ${pages.length}`].filter(Boolean).join(' · ');
    page.elements.push({ kind: 'text', text, x: P.left, y: P.footerBaseline, size: 8, weight: 400, gray: true, width: measure(text, 8, 400) });
  }
  return pages;
}
