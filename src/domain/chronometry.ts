/**
 * Minutage du scénario, selon les trois méthodes de KIT Scenarist :
 * - par pages : les lignes occupées sur la page imprimée (58 lignes), à N secondes la page (60 par défaut) ;
 * - par caractères : N caractères valent M secondes (1000 = 60 s), espaces comptées ou non ;
 * - par type : forfait par paragraphe + secondes par tranche de 50 caractères, pour l'en-tête,
 *   l'action et la réplique ; personnage, didascalie et transition ne comptent pas.
 * Notes, parties et résumés ne sont jamais minutés.
 */
import { isEmptyBlock, type BlockType, type SBlock } from './screenplay';
import { blankLinesBefore, blockLines, NOT_PRINTED, parseEmphasis, SCRIPT_PAGE } from './scriptLayout';

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

/** Durée jusqu'à un point du texte (bloc et position dans son texte), et durée totale. */
export function chronoAt(blocks: readonly SBlock[], c: ScriptChrono, caret: { id: string; offset: number } | null): { at: number | null; total: number } {
  const secs = blockSeconds(blocks, c);
  let total = 0;
  let at: number | null = null;
  blocks.forEach((b, i) => {
    if (caret && b.id === caret.id) {
      const len = b.text.length || 1;
      at = total + secs[i] * Math.min(1, Math.max(0, caret.offset / len));
    }
    total += secs[i];
  });
  return { at: at === null ? null : Math.round(at), total: Math.round(total) };
}

/** Format « m:ss » (minutes non bornées). */
export const mmss = (sec: number) => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
