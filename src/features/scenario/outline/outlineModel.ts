/**
 * Séquencier à l'écran : calculs purs (déplacements au clavier et par glisser, intertitres, filtre des
 * étapes, colonnes du tissage). Les écritures passent toutes par une `SourceEdit` du domaine.
 */
import { mmss } from '../../../domain/chronometry';
import type { OutlineItem, OutlineMeasures, OutlinePart, OutlineSequence, SourceEdit } from '../../../domain/outline';
import { TRUBY_STEPS, type TrubyStep } from '../../../domain/truby';
import { fold } from '../../../domain/text';

export type Move = { to: number; edge: 'top' | 'bottom' };

/**
 * ⌥↑ / ⌥↓ : un pas à la fois. Un intertitre juste au-dessus (ou au-dessous) se franchit d'abord seul :
 * la séquence sort de sa partie, puis, au pas suivant, passe sa voisine. `null` : rien à faire.
 */
export function stepMove(items: readonly OutlineItem[], n: number, dir: -1 | 1): Move | null {
  const k = items.findIndex((x) => x.kind === 'sequence' && x.n === n);
  if (k < 0) return null;
  const total = items.reduce((c, x) => c + (x.kind === 'sequence' ? 1 : 0), 0);
  const neighbour = items[k + dir];
  if (neighbour?.kind === 'part') return { to: n, edge: dir < 0 ? 'top' : 'bottom' };
  if (dir < 0 ? n <= 1 : n >= total) return null;
  return { to: n + dir, edge: dir < 0 ? 'bottom' : 'top' };
}

/**
 * Dépôt d'un glisser : la séquence `from` lâchée avant ou après la séquence `n`. Avant : elle rejoint
 * la partie de `n` (sous son intertitre) ; après : elle reste au-dessus de l'intertitre suivant.
 */
export function dropMove(from: number, n: number, place: 'before' | 'after'): Move {
  if (place === 'before') return { to: from < n ? n - 1 : n, edge: 'bottom' };
  return { to: from <= n ? n : n + 1, edge: 'top' };
}

/** Dépôt sur un intertitre : en tête de cette partie (avant sa première séquence, ou à la fin). */
export function dropOnPart(items: readonly OutlineItem[], from: number, partIndex: number): Move {
  let p = -1;
  let k = 0;
  for (; k < items.length; k++) if (items[k].kind === 'part' && ++p === partIndex) break;
  const next = items.slice(k + 1).find((x): x is OutlineSequence => x.kind === 'sequence');
  if (next) return dropMove(from, next.n, 'before');
  const total = items.reduce((c, x) => c + (x.kind === 'sequence' ? 1 : 0), 0);
  return { to: total, edge: 'bottom' };
}

/** Renomme l'intertitre d'une partie (« # titre », profondeur gardée) ; le reste du texte ne bouge pas. */
export function renamePart(source: string, part: Pick<OutlinePart, 'start' | 'end'>, title: string): SourceEdit {
  const t = title.replace(/\s+/g, ' ').trim();
  const a = part.start;
  const b = part.end;
  const line = source.slice(a, b);
  const hashes = /^\s*(#+)/.exec(line)?.[1];
  if (!t || !hashes) return { source, map: (p) => p };
  const text = `${hashes} ${t}`;
  if (line === text) return { source, map: (p) => p };
  const delta = text.length - (b - a);
  const next = source.slice(0, a) + text + source.slice(b);
  return { source: next, map: (p) => (p <= a ? p : p >= b ? p + delta : Math.min(p, a + text.length)) };
}

/** Index de partie (dans `outlineOf`) de l'intertitre qui commence en `start`. */
export function partIndexAt(items: readonly OutlineItem[], start: number): number {
  return items.filter((x) => x.kind === 'part').findIndex((x) => x.start === start);
}

/** Étapes de Truby retenues par le filtre tapé (numéro, ou mots du libellé, sans accents). */
export function filterSteps(query: string): ReadonlyArray<TrubyStep> {
  const q = fold(query.trim());
  if (!q) return TRUBY_STEPS;
  if (/^\d+$/.test(q)) return TRUBY_STEPS.filter((s) => String(s.n).startsWith(q));
  const words = q.split(/\s+/);
  // La plus proche d'abord : le libellé commence par ce qui est tapé, puis chaque mot commence un mot.
  const wordStart = (l: string, w: string) => l.split(/[\s'’(),/-]+/).some((x) => x.startsWith(w));
  const rank = (l: string) => (l.startsWith(q) ? 0 : words.every((w) => wordStart(l, w)) ? 1 : 2);
  return TRUBY_STEPS.map((s) => ({ s, l: fold(s.label) }))
    .filter(({ l }) => words.every((w) => l.includes(w)))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.s.n - b.s.n)
    .map(({ s }) => s);
}

/** Durée lisible : « 1:20 », au-delà d'une heure « 1:38:12 ». */
export function clock(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  if (t < 3600) return mmss(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Colonnes du tissage : une par intrigue retenue, avec son nombre de séquences et sa durée cumulée. */
export function weaveColumns(seqs: readonly OutlineSequence[], keys: readonly string[], m: Pick<OutlineMeasures, 'byN'>): Array<{ key: string; count: number; sec: number }> {
  return keys.map((key) => {
    const mine = seqs.filter((x) => x.plot === key);
    return { key, count: mine.length, sec: mine.reduce((t, x) => t + (m.byN.get(x.n)?.sec ?? 0), 0) };
  });
}

/** Intrigues à l'écran : celles du projet, puis celles lues dans le texte mais non déclarées. */
export function plotKeys(declared: ReadonlyArray<{ key: string }>, seqs: readonly OutlineSequence[]): string[] {
  const out = declared.map((p) => p.key);
  for (const x of seqs) if (!out.includes(x.plot)) out.push(x.plot);
  return out;
}

/** Choix d'une liste (lieux, moments) pour ce qui est tapé : début du mot d'abord, sans accents. */
export function pickChoices(all: readonly string[], query: string, limit = 8): string[] {
  const q = fold(query.trim());
  const uniq = [...new Set(all.filter(Boolean))];
  if (!q) return uniq.slice(0, limit);
  const starts = uniq.filter((x) => fold(x).startsWith(q));
  const inside = uniq.filter((x) => !fold(x).startsWith(q) && fold(x).includes(q));
  return [...starts, ...inside].filter((x) => fold(x) !== q).slice(0, limit);
}
