/**
 * Mise en page d'un scénario au format du modèle fourni par l'utilisateur (KIT Scenarist, A4) :
 * Courier Prime 12 pt, 58 lignes par page, retraits et largeurs mesurés au point près sur son PDF.
 * Fonction pure : l'éditeur (pagination à l'écran) et les exports (PDF texte, images, Word) s'en
 * servent tous, pour que les pages soient les mêmes partout.
 */
import { headingNumbers, isEmptyBlock, parseTitlePage, type BlockType, type SBlock } from './screenplay';

/** Géométrie en points (1 pt = 1/72 po). */
export const SCRIPT_PAGE = {
  w: 595.28,
  h: 841.89,
  /** Ligne de base de la première ligne, interligne et nombre de lignes par page. */
  firstBaseline: 77.7,
  lineH: 12.1,
  lines: 58,
  fontSize: 12,
  /** Largeur d'un caractère de Courier Prime à 12 pt (1228 / 2048 em). */
  cw: (1228 / 2048) * 12,
  /** Numéro de page : en haut à droite, à partir de la deuxième page. */
  pageNumberBaseline: 46.2,
  right: 547.2,
  /** Numéro de séquence : dans la marge, aligné à droite contre ce bord. */
  sceneNumberRight: 98,
} as const;

/** Colonne de chaque élément : abscisse et largeur en caractères. */
export const SCRIPT_COLUMNS: Record<BlockType, { x: number; chars: number; align?: 'right' | 'center'; upper?: boolean }> = {
  heading: { x: 108, chars: 61, upper: true },
  action: { x: 108, chars: 61 },
  character: { x: 252.4, chars: 38, upper: true },
  parenthetical: { x: 210, chars: 26 },
  dialogue: { x: 181.6, chars: 35 },
  transition: { x: 108, chars: 61, align: 'right', upper: true },
  centered: { x: 108, chars: 61, align: 'center' },
  note: { x: 108, chars: 61 },
  section: { x: 108, chars: 61 },
  synopsis: { x: 108, chars: 61 },
  pagebreak: { x: 108, chars: 61 },
  title: { x: 108, chars: 61, align: 'center' },
};

/** Éléments qui ne s'impriment pas (notes, parties, résumés : aides à l'écriture). */
export const NOT_PRINTED: ReadonlySet<BlockType> = new Set(['note', 'section', 'synopsis']);

const DIALOGUE_PART: ReadonlySet<BlockType> = new Set(['parenthetical', 'dialogue']);

/** Lignes vides avant un élément (jamais en haut de page). */
export function blankLinesBefore(prev: BlockType | undefined, cur: BlockType): number {
  if (!prev) return 0;
  if (DIALOGUE_PART.has(cur) && (prev === 'character' || DIALOGUE_PART.has(prev))) return 0;
  return cur === 'heading' ? 2 : 1;
}

/**
 * Coupe un texte en lignes d'au plus `chars` caractères, comme un traitement de texte : aux espaces,
 * après un trait d'union, un tiret ou une barre ; un mot trop long est coupé net.
 */
export function wrapText(text: string, chars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let rest = para.replace(/\s+$/, '');
    if (!rest) {
      out.push('');
      continue;
    }
    while (rest.length > chars) {
      let cut = -1;
      for (let i = chars; i > 0; i--) {
        const c = rest[i];
        const p = rest[i - 1];
        if (c === ' ') {
          cut = i;
          break;
        }
        if ((p === '-' || p === '–' || p === '—' || p === '/') && i < rest.length) {
          cut = i;
          break;
        }
      }
      if (cut <= 0) cut = chars;
      out.push(rest.slice(0, cut).replace(/\s+$/, ''));
      rest = rest.slice(cut).replace(/^ +/, '');
    }
    out.push(rest);
  }
  return out;
}

/** Morceau de ligne avec sa mise en forme Fountain (*italique*, **gras**, _souligné_). */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** Lit l'emphase Fountain d'une ligne ; les marques ne s'impriment pas. */
export function parseEmphasis(line: string): Run[] {
  const runs: Run[] = [];
  const state = { bold: false, italic: false, underline: false };
  let buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, ...(state.bold ? { bold: true } : {}), ...(state.italic ? { italic: true } : {}), ...(state.underline ? { underline: true } : {}) });
    buf = '';
  };
  // Une marque n'agit que si elle a sa fermeture plus loin sur la ligne.
  const closes = (mark: string, from: number) => line.indexOf(mark, from) > from;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) {
      buf += line[++i];
      continue;
    }
    if (line.startsWith('***', i) && (state.bold && state.italic ? true : closes('***', i + 3))) {
      flush();
      state.bold = state.italic = !(state.bold && state.italic);
      i += 2;
      continue;
    }
    if (line.startsWith('**', i) && (state.bold || closes('**', i + 2))) {
      flush();
      state.bold = !state.bold;
      i += 1;
      continue;
    }
    if (c === '*' && (state.italic || closes('*', i + 1))) {
      flush();
      state.italic = !state.italic;
      continue;
    }
    if (c === '_' && (state.underline || closes('_', i + 1))) {
      flush();
      state.underline = !state.underline;
      continue;
    }
    buf += c;
  }
  flush();
  return runs;
}

/** Texte imprimé d'une ligne (sans les marques d'emphase), pour mesurer et couper. */
export const plainText = (line: string) => parseEmphasis(line).map((r) => r.text).join('');

export interface LaidLine {
  blockId: string;
  type: BlockType;
  /** Texte de la ligne, marques d'emphase comprises (le rendu les applique). */
  text: string;
  x: number;
  align?: 'right' | 'center';
  /** Rang de la ligne dans la page (0 = première ligne). */
  row: number;
  /** Numéro de séquence affiché dans la marge (première ligne d'un en-tête). */
  sceneNumber?: string;
}

export interface LaidPage {
  /** Numéro imprimé (le premier reste sans numéro, comme dans le modèle). */
  number: number;
  lines: LaidLine[];
}

export interface ScriptLayout {
  pages: LaidPage[];
  /** Page (indice) et rang de départ de chaque bloc imprimé. */
  placement: Map<string, Placement>;
  /** Lignes de la page de titre, s'il y en a une. */
  title?: Record<string, string>;
}


interface Item {
  block: SBlock;
  lines: string[];
}

/**
 * Texte tel qu'il s'imprime : les espaces fines (typographie française) deviennent des espaces
 * insécables, que la police possède et qui ne coupent pas la ligne.
 */
export const printable = (text: string) => text.replace(/[\u2007\u2009\u202f]/g, '\u00a0').replace(/\t/g, ' ');

/** Lignes d'un bloc à l'impression. */
export function blockLines(b: SBlock): string[] {
  const col = SCRIPT_COLUMNS[b.type];
  const text = printable(col.upper ? b.text.toLocaleUpperCase('fr') : b.text);
  // On coupe le texte imprimé, mais on garde les marques d'emphase de la source.
  return wrapWithMarks(text, col.chars);
}

/** Coupe en tenant compte des marques d'emphase, qui ne prennent pas de place à l'impression. */
function wrapWithMarks(text: string, chars: number): string[] {
  if (!/[*_\\]/.test(text)) return wrapText(text, chars);
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const plain = plainText(para);
    const lines = wrapText(plain, chars);
    // Reporte les coupures du texte imprimé sur le texte marqué.
    let pos = 0;
    for (const l of lines) {
      let seen = 0;
      let end = pos;
      while (end < para.length && seen < l.length) {
        const c = para[end];
        if (c === '\\') {
          end += 2;
          seen++;
          continue;
        }
        if (c === '*' || c === '_') {
          end++;
          continue;
        }
        end++;
        seen++;
      }
      // Les marques fermantes restent sur la ligne qui les ouvre.
      while (end < para.length && (para[end] === '*' || para[end] === '_')) end++;
      out.push(para.slice(pos, end).trim());
      pos = end;
      while (para[pos] === ' ') pos++;
    }
  }
  return out;
}

/** Élément à paginer : son type et son nombre de lignes. */
export interface PageItem {
  id: string;
  type: BlockType;
  lines: number;
}

export interface Placement {
  page: number;
  row: number;
}

/**
 * Pagination, aux règles du modèle : un élément garde ses lignes ensemble (il ne se coupe d'une page
 * à l'autre que s'il dépasse une page) ; une réplique (personnage, didascalies, texte) forme un tout ;
 * un en-tête emmène au moins deux lignes de ce qui le suit, un personnage seul au moins une ; pas de
 * ligne vide en haut de page. Renvoie la page et le rang de départ de chaque élément.
 */
export function paginateItems(items: readonly PageItem[]): { at: Map<string, Placement>; pages: number } {
  const LPP = SCRIPT_PAGE.lines;
  const at = new Map<string, Placement>();
  let page = 0;
  let row = 0;
  let prev: BlockType | undefined;
  const newPage = () => {
    page++;
    row = 0;
    prev = undefined;
  };
  const place = (it: PageItem) => {
    let start = row === 0 ? 0 : row + blankLinesBefore(prev, it.type);
    if (start >= LPP) {
      newPage();
      start = 0;
    }
    at.set(it.id, { page, row: start });
    // Plus long que la place qui reste : la suite passe aux pages suivantes.
    let left = it.lines;
    let r = start;
    while (left > LPP - r) {
      left -= LPP - r;
      page++;
      r = 0;
    }
    row = r + left;
    prev = it.type;
  };
  const need = (group: readonly PageItem[], firstGap: number) => group.reduce((n, it, i) => n + (i === 0 ? firstGap : blankLinesBefore(group[i - 1].type, it.type)) + it.lines, 0);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'pagebreak') {
      at.set(it.id, { page, row });
      if (row > 0) newPage();
      continue;
    }
    const group: PageItem[] = [it];
    if (it.type === 'character' || DIALOGUE_PART.has(it.type)) while (items[i + 1] && DIALOGUE_PART.has(items[i + 1].type)) group.push(items[++i]);
    let needed = need(group, row === 0 ? 0 : blankLinesBefore(prev, it.type));
    const next = items[i + 1];
    if (next && next.type !== 'pagebreak') {
      if (it.type === 'heading') needed += blankLinesBefore('heading', next.type) + Math.min(2, next.lines);
      else if (it.type === 'character' && group.length === 1) needed += blankLinesBefore('character', next.type) + Math.min(1, next.lines);
    }
    if (row > 0 && row + needed > LPP && need(group, 0) <= LPP) newPage();
    for (const g of group) place(g);
  }
  return { at, pages: row === 0 && page > 0 ? page : page + 1 };
}

/** Mise en page complète du scénario imprimé (les notes, parties et résumés ne s'impriment pas). */
export function layoutScript(blocks: readonly SBlock[]): ScriptLayout {
  const numbers = headingNumbers(blocks);
  const printed = blocks.filter((b) => b.type !== 'title' && !NOT_PRINTED.has(b.type) && (b.type === 'pagebreak' || !isEmptyBlock(b)));
  const titleBlock = blocks.find((b) => b.type === 'title' && b.text.trim());
  const items: Item[] = printed.map((b) => ({ block: b, lines: b.type === 'pagebreak' ? [] : blockLines(b) }));
  const { at, pages: count } = paginateItems(items.map((it) => ({ id: it.block.id, type: it.block.type, lines: it.lines.length })));
  const pages: LaidPage[] = Array.from({ length: count }, (_, i) => ({ number: i + 1, lines: [] }));
  const placement = new Map<string, Placement>();
  for (const { block: b, lines } of items) {
    if (b.type === 'pagebreak') continue;
    const col = SCRIPT_COLUMNS[b.type];
    let { page, row } = at.get(b.id)!;
    placement.set(b.id, { page, row });
    lines.forEach((text, k) => {
      if (row >= SCRIPT_PAGE.lines) {
        page++;
        row = 0;
      }
      pages[page].lines.push({
        blockId: b.id,
        type: b.type,
        text,
        x: col.x,
        ...(col.align ? { align: col.align } : {}),
        row: row++,
        // Numéro dérivé de l'ordre, comme partout dans l'outil (un « #12A# » écrit dans la source est ignoré).
        ...(b.type === 'heading' && k === 0 && numbers.has(b.id) ? { sceneNumber: String(numbers.get(b.id)) } : {}),
      });
    });
  }
  return { pages, placement, title: titleBlock ? parseTitlePage(titleBlock.text) : undefined };
}

/** Abscisse de début d'une ligne, alignement compris. */
export function lineX(line: Pick<LaidLine, 'x' | 'align' | 'text' | 'type'>): number {
  const { cw, right } = SCRIPT_PAGE;
  const width = plainText(line.text).length * cw;
  if (line.align === 'right') return right - width;
  if (line.align === 'center') {
    const col = SCRIPT_COLUMNS[line.type];
    return col.x + (col.chars * cw - width) / 2;
  }
  return line.x;
}

/** Ligne de base (depuis le haut de la page) d'une ligne de rang donné. */
export const baselineOf = (row: number) => SCRIPT_PAGE.firstBaseline + row * SCRIPT_PAGE.lineH;

/**
 * Page de titre : titre en capitales au tiers de la page, crédit et auteurs centrés en dessous,
 * contact et date en bas à gauche. Elle n'est pas numérotée.
 */
export function titlePageLines(title: Record<string, string>, upper = true): LaidLine[] {
  const out: LaidLine[] = [];
  const col = SCRIPT_COLUMNS.title;
  // `blockId` nomme le champ d'origine (« title:Title », « title:Author »…).
  const center = (text: string, row: number, field: string) => {
    for (const l of wrapText(printable(text), col.chars)) out.push({ blockId: `title:${field}`, type: 'title', text: l, x: col.x, align: 'center', row: row++ });
    return row;
  };
  const split = (v?: string) => (v ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  let row = 19;
  for (const l of split(title.Title)) row = center(upper ? l.toLocaleUpperCase('fr') : l, row, 'Title');
  row += 2;
  for (const l of split(title.Credit)) row = center(l, row, 'Credit');
  if (split(title.Credit).length) row += 1;
  for (const l of split(title.Author)) row = center(l, row, 'Author');
  const source = split(title.Source);
  if (source.length) {
    row += 2;
    for (const l of source) row = center(l, row, 'Source');
  }
  // Pied de page : contact, puis date et mentions, en bas à gauche.
  const foot = [...split(title.Contact), ...split(title['Draft date']), ...split(title.Copyright)].flatMap((l) => wrapText(printable(l), SCRIPT_COLUMNS.action.chars));
  foot.forEach((l, k) => out.push({ blockId: 'title:foot', type: 'action', text: l, x: SCRIPT_COLUMNS.action.x, row: SCRIPT_PAGE.lines - foot.length + k }));
  return out;
}

/** Ligne prête à dessiner : position en points depuis le coin haut gauche, morceaux mis en forme. */
export interface PrintLine {
  x: number;
  /** Ligne de base, depuis le haut de la page. */
  y: number;
  runs: Run[];
}

const runsOf = (text: string) => parseEmphasis(text);

/** Lignes d'une page du scénario : texte, numéros de séquence dans la marge, numéro de page en haut à droite. */
export function printLines(page: LaidPage): PrintLine[] {
  const { cw, right, sceneNumberRight, pageNumberBaseline } = SCRIPT_PAGE;
  const out: PrintLine[] = [];
  // Numéro en haut à droite, sauf sur la première page (comme dans le modèle).
  if (page.number > 1) {
    const t = `${page.number}.`;
    out.push({ x: right - t.length * cw, y: pageNumberBaseline, runs: [{ text: t }] });
  }
  for (const l of page.lines) {
    const y = baselineOf(l.row);
    if (l.sceneNumber) {
      const t = `${l.sceneNumber}.`;
      out.push({ x: sceneNumberRight - t.length * cw, y, runs: [{ text: t }] });
    }
    out.push({ x: lineX(l), y, runs: runsOf(l.text) });
  }
  return out;
}

/** Lignes de la page de titre. */
export function titlePrintLines(title: Record<string, string>): PrintLine[] {
  return titlePageLines(title).map((l) => ({ x: lineX(l), y: baselineOf(l.row), runs: runsOf(l.text) }));
}
