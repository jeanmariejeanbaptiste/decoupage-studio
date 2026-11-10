/**
 * Mise en page d'une comparaison de versions, au gabarit du scénario (A4, Courier Prime 12 pt,
 * colonnes et règles d'espacement de `scriptLayout`) : sert l'export PDF. Les morceaux de texte gardent
 * leur nature (inchangé, ajouté, retiré) d'une ligne à l'autre.
 */
import { mmss } from './chronometry';
import type { BlockType } from './screenplay';
import { SCRIPT_COLUMNS, SCRIPT_PAGE, blankLinesBefore } from './scriptLayout';
import { readable, type BlockOp, type DiffItem, type DiffStats, type ScriptDiff, type SegOp } from './scriptDiff';

/**
 * Coupures d'un texte en lignes d'au plus `chars` caractères, aux mêmes endroits que `wrapText`
 * (espaces, après un trait d'union, un tiret ou une barre ; mot trop long coupé net), en positions
 * dans le texte : [début, fin) de chaque ligne, espaces de bord exclus.
 */
export function wrapRanges(text: string, chars: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let base = 0;
  for (const para of text.split('\n')) {
    const end = para.replace(/\s+$/, '').length;
    let pos = 0;
    if (!end) out.push([base, base]);
    while (pos < end) {
      const rest = para.slice(pos, end);
      if (rest.length <= chars) {
        out.push([base + pos, base + end]);
        break;
      }
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
      const lineEnd = pos + rest.slice(0, cut).replace(/\s+$/, '').length;
      out.push([base + pos, base + lineEnd]);
      pos += cut;
      while (pos < end && para[pos] === ' ') pos++;
    }
    base += para.length + 1;
  }
  return out;
}

export interface DiffRun {
  text: string;
  op: SegOp;
}

export interface DiffLine {
  /** Texte d'un bloc, ligne de séquences repliées, ou en-tête de la comparaison. */
  kind: 'text' | 'fold' | 'head';
  op: BlockOp;
  type: BlockType;
  /** Abscisse de la colonne et sa largeur (pt). */
  x: number;
  width: number;
  align?: 'right' | 'center';
  runs: DiffRun[];
  row: number;
  /** Numéro de séquence dans la marge (barré pour une séquence retirée). */
  sceneNumber?: string;
  /** Mention dans la marge, sous le numéro, ligne à ligne (« déplacée » / « était 4 »). */
  margin?: string[];
  /** Première et dernière ligne du bloc (filet d'un bloc ajouté). */
  first?: boolean;
  last?: boolean;
}

export interface DiffPage {
  number: number;
  lines: DiffLine[];
}

/** Lignes d'un texte en morceaux, coupé à la largeur de sa colonne. */
export function wrapRuns(runs: readonly DiffRun[], chars: number): DiffRun[][] {
  const text = runs.map((r) => r.text).join('');
  const bounds: number[] = [];
  let at = 0;
  for (const r of runs) {
    bounds.push(at);
    at += r.text.length;
  }
  return wrapRanges(text, chars).map(([a, z]) => {
    const line: DiffRun[] = [];
    runs.forEach((r, k) => {
      const s = Math.max(a, bounds[k]);
      const e = Math.min(z, bounds[k] + r.text.length);
      if (e <= s) return;
      const piece = text.slice(s, e);
      const prev = line[line.length - 1];
      if (prev && prev.op === r.op) prev.text += piece;
      else line.push({ text: piece, op: r.op });
    });
    return line;
  });
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

/** Résumé chiffré (en-tête de l'export), en caractères que la police de l'export possède. */
export function summaryLines(st: DiffStats, nameA: string, nameB: string): string[] {
  const seq = [st.added && plural(st.added, 'ajoutée'), st.removed && plural(st.removed, 'retirée'), st.changed && plural(st.changed, 'modifiée'), st.moved && plural(st.moved, 'déplacée')].filter(Boolean);
  return [
    `Séquences : ${seq.length ? seq.join(', ') : 'aucun changement'}`,
    `Mots : ${plural(st.wordsAdded, 'ajouté')}, ${plural(st.wordsRemoved, 'retiré')}`,
    `Pages : ${st.after.pages} (${nameA}), ${st.before.pages} (${nameB})`,
    `Durée : ${mmss(st.after.seconds)} (${nameA}), ${mmss(st.before.seconds)} (${nameB})`,
  ];
}

/** Ligne des séquences repliées. */
export const foldLabel = (from: number, to: number, count: number) => (count > 1 ? `Séquences ${from} à ${to} : identiques` : `Séquence ${from} : identique`);

/** Mention d'une séquence déplacée. */
export const movedLabel = (before: number) => `déplacée, était ${before}`;
/** La même, en deux lignes courtes (marge étroite de la page imprimée). */
export const movedLines = (before: number) => ['déplacée', `était ${before}`];

interface Item {
  kind: DiffLine['kind'];
  op: BlockOp;
  type: BlockType;
  lines: DiffRun[][];
  sceneNumber?: string;
  margin?: string[];
}

/**
 * Pages de la comparaison : en-tête, puis les séquences (ou les lignes repliées). Un bloc garde ses
 * lignes ensemble s'il tient sur une page ; un en-tête emmène au moins deux lignes de ce qui le suit.
 */
export function layoutDiff(diff: ScriptDiff, items: readonly DiffItem[], header: readonly string[]): DiffPage[] {
  const flat: Item[] = [];
  const col = (t: BlockType) => SCRIPT_COLUMNS[t];
  for (const [k, h] of header.entries()) flat.push({ kind: 'head', op: 'eq', type: k ? 'action' : 'heading', lines: wrapRuns([{ text: h, op: 'eq' }], col('action').chars) });
  for (const it of items) {
    if (it.kind === 'fold') {
      flat.push({ kind: 'fold', op: 'eq', type: 'heading', lines: [[{ text: foldLabel(it.from, it.to, it.scenes.length), op: 'eq' }]] });
      continue;
    }
    const sc = diff.scenes[it.index];
    sc.blocks.forEach((b, bi) => {
      const c = col(b.type);
      const runs = readable(b.segs).map((s) => ({ op: s.op, text: c.upper ? s.text.toLocaleUpperCase('fr') : s.text }));
      const isHead = bi === 0 && b.type === 'heading' && !sc.prelude;
      flat.push({
        kind: 'text',
        op: b.op,
        type: b.type,
        lines: wrapRuns(runs, c.chars),
        ...(isHead ? { sceneNumber: String(sc.after ?? sc.before ?? ''), ...(sc.moved && sc.before ? { margin: movedLines(sc.before) } : {}) } : {}),
      });
    });
  }
  const LPP = SCRIPT_PAGE.lines;
  const pages: DiffPage[] = [{ number: 1, lines: [] }];
  let row = 0;
  let prev: BlockType | undefined;
  let prevKind: Item['kind'] | undefined;
  const newPage = () => {
    pages.push({ number: pages.length + 1, lines: [] });
    row = 0;
    prev = undefined;
  };
  flat.forEach((it, k) => {
    // Après l'en-tête de la comparaison : deux lignes blanches, comme avant une séquence.
    const gap = row === 0 ? 0 : prevKind === 'head' && it.kind !== 'head' ? 2 : it.kind === 'head' ? 0 : blankLinesBefore(prev, it.type);
    const next = flat[k + 1];
    const need = gap + it.lines.length + (it.type === 'heading' && next && next.kind === 'text' ? 1 + Math.min(2, next.lines.length) : 0);
    if (row > 0 && row + need > LPP && it.lines.length <= LPP) newPage();
    else row += gap;
    const c = SCRIPT_COLUMNS[it.kind === 'head' || it.kind === 'fold' ? 'action' : it.type];
    it.lines.forEach((runs, li) => {
      if (row >= LPP) newPage();
      pages[pages.length - 1].lines.push({
        kind: it.kind,
        op: it.op,
        type: it.type,
        x: c.x,
        width: c.chars * SCRIPT_PAGE.cw,
        ...(c.align && it.kind === 'text' ? { align: c.align } : {}),
        runs,
        row: row++,
        ...(li === 0 && it.sceneNumber ? { sceneNumber: it.sceneNumber } : {}),
        ...(li === 0 && it.margin ? { margin: it.margin } : {}),
        ...(li === 0 ? { first: true } : {}),
        ...(li === it.lines.length - 1 ? { last: true } : {}),
      });
    });
    prev = it.type;
    prevKind = it.kind;
  });
  return pages;
}
