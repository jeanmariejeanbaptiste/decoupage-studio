/**
 * Planches du storyboard (A4) : combien de cases par feuille ont un sens pour un format d'image
 * donné, et comment les poser. Mesures en millimètres, accordées à la feuille de style des planches
 * (`.print .sheet` dans StoryboardPage.module.css).
 *
 * La logique : les images remplissent la largeur de la feuille (ou sa hauteur pour un format
 * vertical) ; il ne reste de la place que dans l'autre sens. Un reste en hauteur se range en marges
 * (un peu plus en bas qu'en haut) et passe s'il reste modéré ; un vide sur les côtés se voit
 * davantage : il est tenu plus court.
 */

export type SheetOrientation = 'landscape' | 'portrait';

/** Choix proposés dans « Par feuille ». */
export const PER_SHEET = [1, 2, 3, 4, 6, 9] as const;

/** Feuille A4 et réglages des planches (mm). */
const A4 = { long: 297, short: 210 };
const PAD_X = 10;
const PAD_Y = 6;
/** En-tête (titre, planche n / N) et son espacement. */
const HEAD = 6.5 + 4;
/** Espace entre deux cases. */
const GAP = 5;
/** Légende sous l'image (deux lignes), marge du cadre et bordures. */
const CAPTION = 9.5;
const FRAME_ROOM = 4.2;
const BORDER = 0.6;

/** Part minimale occupée dans le sens qui garde de la place : en hauteur, sur les côtés. */
const MIN_USE_V = 0.73;
const MIN_USE_H = 0.8;

export interface SheetLayout {
  perPage: number;
  cols: number;
  rows: number;
  /** Image dans sa case (mm). */
  frameW: number;
  frameH: number;
  /** Case : image, légende et marges du cadre (mm). */
  cellW: number;
  cellH: number;
  /** Part de la largeur et de la hauteur utiles occupée par la grille. */
  useW: number;
  useH: number;
  /** Espace entre deux rangées (mm) : l'espace de base, plus une part du reste de hauteur. */
  rowGap: number;
  /** Place restante : en haut, en bas, de chaque côté (mm). */
  top: number;
  bottom: number;
  side: number;
}

/** Zone utile de la feuille, sous l'en-tête (mm). */
export function sheetArea(o: SheetOrientation): { w: number; h: number } {
  const [w, h] = o === 'portrait' ? [A4.short, A4.long] : [A4.long, A4.short];
  return { w: w - 2 * PAD_X, h: h - 2 * PAD_Y - HEAD };
}

function shape(n: number, cols: number, ratio: number, o: SheetOrientation): SheetLayout {
  const rows = Math.ceil(n / cols);
  const { w, h } = sheetArea(o);
  const boxW = (w - (cols - 1) * GAP) / cols - BORDER;
  const boxH = (h - (rows - 1) * GAP) / rows - CAPTION - FRAME_ROOM - BORDER;
  const frameW = Math.max(0, Math.min(boxW, boxH * ratio));
  const frameH = frameW / ratio;
  const cellW = frameW + BORDER;
  const cellH = frameH + CAPTION + FRAME_ROOM + BORDER;
  const gridW = cols * cellW + (cols - 1) * GAP;
  const gridH = rows * cellH + (rows - 1) * GAP;
  const restH = Math.max(0, h - gridH);
  // Reste en hauteur : un quart en haut, un peu plus en bas, le reste aère les rangées.
  const between = rows > 1 ? restH * 0.3 : 0;
  const top = (restH - between) * (rows > 1 ? 0.25 / 0.7 : 0.4);
  const rowGap = GAP + (rows > 1 ? between / (rows - 1) : 0);
  return { perPage: n, cols, rows, frameW, frameH, cellW, cellH, useW: gridW / w, useH: gridH / h, rowGap, top, bottom: restH - between - top, side: Math.max(0, w - gridW) / 2 };
}

/** Meilleure grille pour n cases : la plus grande image (à surface égale, la plus remplie). */
export function sheetLayout(n: number, ratio: number, o: SheetOrientation): SheetLayout {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9;
  let best: SheetLayout | null = null;
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols) continue;
    const l = shape(n, cols, r, o);
    if (!best || l.frameW * l.frameH > best.frameW * best.frameH + 1e-6) best = l;
  }
  return best!;
}

/** La grille remplit-elle la feuille au point d'être jolie à l'export ? */
function fits(l: SheetLayout): boolean {
  // Le sens rempli est celui qui limite l'image ; l'autre doit l'être assez.
  return l.useW >= l.useH ? l.useH >= MIN_USE_V : l.useW >= MIN_USE_H;
}

/**
 * Nombres de cases par feuille qui ont un sens pour ce format et cette orientation (16:9 : 1, 4, 9 en
 * paysage ; 2, 6 en portrait). Jamais vide : à défaut, les deux grilles les mieux remplies.
 */
export function sheetChoices(ratio: number, o: SheetOrientation): number[] {
  const all = PER_SHEET.map((n) => sheetLayout(n, ratio, o));
  const ok = all.filter(fits).map((l) => l.perPage);
  if (ok.length) return ok;
  const score = (l: SheetLayout) => Math.min(l.useW, l.useH);
  return all
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, 2)
    .map((l) => l.perPage)
    .sort((a, b) => a - b);
}

/** Choix enregistré s'il reste valable, sinon le plus proche (à égalité, le plus grand). */
export function sheetPerPage(wanted: number | undefined, choices: readonly number[]): number {
  if (wanted !== undefined && choices.includes(wanted)) return wanted;
  const target = wanted ?? 4;
  return choices.reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) || (Math.abs(n - target) === Math.abs(best - target) && n > best) ? n : best), choices[0]);
}
