/**
 * Minutage du scénario, selon les trois méthodes de KIT Scenarist :
 * - par pages : les lignes occupées sur la page imprimée (58 lignes), à N secondes la page (60 par défaut) ;
 * - par caractères : N caractères valent M secondes (1000 = 60 s), espaces comptées ou non ;
 * - par type : forfait par paragraphe + secondes par tranche de 50 caractères, pour l'en-tête,
 *   l'action et la réplique ; personnage, didascalie et transition ne comptent pas.
 * Notes, parties et résumés ne sont jamais minutés.
 */
import { isEmptyBlock, type BlockType, type SBlock } from './screenplay';
import { blankLinesBefore, blockLines, layoutScript, NOT_PRINTED, parseEmphasis, SCRIPT_PAGE } from './scriptLayout';

export type ChronoMethod = 'pages' | 'characters' | 'configurable';

export interface TypeRate {
  /** Forfait par paragraphe (s). */
  paragraph: number;
  /** Secondes par tranche de 50 caractères. */
  per50: number;
}

export interface ScriptChrono {
  method: ChronoMethod;
  /** Par pages : secondes par page. */
  pageSec: number;
  /** Par caractères : `chars` caractères valent `charsSec` secondes. */
  chars: number;
  charsSec: number;
  spaces: boolean;
  /** Par type. */
  heading: TypeRate;
  action: TypeRate;
  dialogue: TypeRate;
}

export const DEFAULT_CHRONO: ScriptChrono = {
  method: 'pages',
  pageSec: 60,
  chars: 1000,
  charsSec: 60,
  spaces: false,
  heading: { paragraph: 2, per50: 0 },
  action: { paragraph: 1, per50: 1.5 },
  dialogue: { paragraph: 2, per50: 2.4 },
};

export const chronoOf = (c: Partial<ScriptChrono> | undefined): ScriptChrono => ({ ...DEFAULT_CHRONO, ...c });

/** Texte sans marques d'emphase ni de surlignage (lignes gardées). */
export const stripMarks = (text: string) =>
  text
    .split('\n')
    .map((l) => parseEmphasis(l).map((r) => r.text).join(''))
    .join('\n');

/** Texte imprimé d'un bloc : sans marques, sauts et espaces multiples réduits. */
export const printedText = (text: string) => stripMarks(text).replace(/\s+/g, ' ').trim();

const counted = (b: SBlock) => b.type !== 'title' && b.type !== 'pagebreak' && !NOT_PRINTED.has(b.type) && !isEmptyBlock(b);

const RATE_OF: Partial<Record<BlockType, keyof Pick<ScriptChrono, 'heading' | 'action' | 'dialogue'>>> = {
  heading: 'heading',
  action: 'action',
  dialogue: 'dialogue',
};

/**
 * Durée de chaque bloc (secondes, non arrondies), dans l'ordre. Par pages, les lignes blanches
 * qui précèdent un bloc lui sont comptées, comme sur la page.
 */
export function blockSeconds(blocks: readonly SBlock[], c: ScriptChrono): number[] {
  let prev: BlockType | undefined;
  return blocks.map((b) => {
    if (!counted(b)) return 0;
    if (c.method === 'pages') {
      const lines = blockLines(b).length + (prev ? blankLinesBefore(prev, b.type) : 0);
      prev = b.type;
      return (lines / SCRIPT_PAGE.lines) * c.pageSec;
    }
    const text = printedText(b.text);
    if (c.method === 'characters') {
      const n = c.spaces ? text.length : text.replace(/\s/g, '').length;
      return c.chars > 0 ? (n / c.chars) * c.charsSec : 0;
    }
    const key = RATE_OF[b.type];
    if (!key) return 0;
    const r = c[key];
    return r.paragraph + (text.length / 50) * r.per50;
  });
}

/**
 * Minutage du scénario, bloc par bloc, sur une seule source : celle de l'impression. Par pages, chaque
 * bloc commence là où l'impression le place (`layoutScript`) : les blancs de bas de page et les sauts
 * de page comptent, les notes, parties et résumés non. Les secondes ne sont jamais arrondies ici.
 */
export interface ChronoTimeline {
  /** Secondes au début de chaque bloc (mêmes indices que `blocks`). */
  start: number[];
  /** Part de chaque bloc : jusqu'au début du bloc minuté suivant (ou jusqu'à la fin). */
  secs: number[];
  total: number;
  /** Secondes à une position du texte (`null` sans curseur ou si le bloc n'existe pas). */
  at: (caret: { id: string; offset: number } | null) => number | null;
}

export function chronoTimeline(blocks: readonly SBlock[], c: ScriptChrono): ChronoTimeline {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  if (c.method !== 'pages') {
    const secs = blockSeconds(blocks, c);
    const start: number[] = [];
    let t = 0;
    for (const x of secs) {
      start.push(t);
      t += x;
    }
    return {
      start,
      secs,
      total: t,
      at: (caret) => {
        const i = caret ? index.get(caret.id) : undefined;
        if (!caret || i === undefined) return null;
        const len = blocks[i].text.length || 1;
        return start[i] + secs[i] * Math.min(1, Math.max(0, caret.offset / len));
      },
    };
  }
  const { pages } = layoutScript(blocks);
  const pos = (page: number, row: number) => (page + row / SCRIPT_PAGE.lines) * c.pageSec;
  // Lignes placées de chaque bloc, dans l'ordre.
  const lines = new Map<string, Array<{ page: number; row: number; text: string }>>();
  let total = 0;
  pages.forEach((p, k) =>
    p.lines.forEach((l) => {
      const list = lines.get(l.blockId) ?? [];
      list.push({ page: k, row: l.row, text: l.text });
      lines.set(l.blockId, list);
      total = Math.max(total, pos(k, l.row + 1));
    }),
  );
  const start: number[] = new Array<number>(blocks.length);
  const secs: number[] = new Array<number>(blocks.length).fill(0);
  let next = total;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const own = lines.get(blocks[i].id);
    if (own) {
      start[i] = pos(own[0].page, own[0].row);
      secs[i] = next - start[i];
      next = start[i];
    } else start[i] = next;
  }
  return {
    start,
    secs,
    total,
    at: (caret) => {
      const i = caret ? index.get(caret.id) : undefined;
      if (!caret || i === undefined) return null;
      const own = lines.get(caret.id);
      if (!own) return start[i];
      // Ligne imprimée qui contient le curseur (les coupures tombent sur des espaces).
      let k = 0;
      let seen = 0;
      for (let j = 0; j < own.length - 1; j++) {
        seen += own[j].text.length + 1;
        if (caret.offset >= seen) k = j + 1;
        else break;
      }
      return pos(own[k].page, own[k].row);
    },
  };
}

/** Durée jusqu'à un point du texte (bloc et position dans son texte), et durée totale, arrondies à la seconde. */
export function chronoAt(blocks: readonly SBlock[], c: ScriptChrono, caret: { id: string; offset: number } | null): { at: number | null; total: number } {
  const t = chronoTimeline(blocks, c);
  const at = t.at(caret);
  return { at: at === null ? null : Math.round(at), total: Math.round(t.total) };
}

/** Format « m:ss » (minutes non bornées). */
export const mmss = (sec: number) => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
