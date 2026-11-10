/**
 * Dépouillement depuis le texte : passage du scénario propre à une séquence, repérage des éléments
 * déjà dépouillés dans ce texte (sans accents ni casse), nettoyage d'une sélection avant ajout.
 */
import { addedCharacters, breakdownCategories, breakdownLabel, breakdownOf, derivedBreakdown, detectInText, type BreakdownCategory } from './breakdown';
import { fold } from './text';
import { matchSequence, scenesOf } from './fountain';
import type { ID, ProjectDoc } from './types';

/** Abréviations des catégories (pastilles et sélecteur). */
const ABBR: Record<string, string> = {
  personnages: 'PER',
  figurants: 'FIG',
  accessoires: 'ACC',
  costumes: 'COS',
  maquillage: 'MAQ',
  effets: 'EFF',
  vehicules: 'VÉH',
  machinerie: 'MAC',
  lumiere: 'LUM',
  son: 'SON',
};

export const categoryAbbr = (cat: BreakdownCategory): string => ABBR[cat] ?? breakdownLabel(cat).slice(0, 3).toLocaleUpperCase('fr');

/** Passage du scénario d'une séquence : son ancre si elle est valide, sinon la scène du même lieu. */
export function sceneRangeOf(doc: ProjectDoc, seqId: ID): { start: number; end: number } | null {
  const src = doc.scenario ?? '';
  if (!src.trim()) return null;
  const scenes = scenesOf(src);
  const a = doc.sequences[seqId]?.scenarioAnchor;
  if (a && a.end > a.start && a.end <= src.length) {
    const sc = scenes.find((x) => x.start === a.start) ?? scenes.find((x) => a.start >= x.start && a.start < x.end);
    if (sc) return { start: sc.start, end: sc.end };
  }
  const sc = scenes.find((x) => matchSequence(doc, x) === seqId);
  return sc ? { start: sc.start, end: sc.end } : null;
}

/** Repli caractère par caractère (même longueur que le texte) : minuscules, sans accents. */
export function foldKeepLength(s: string): string {
  let out = '';
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += f.length === ch.length ? f : ch.length === 1 ? (f[0] ?? ch) : ch;
  }
  return out;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Occurrences d'un terme dans un texte (mot entier, pluriel en s/x admis), positions du texte d'origine. */
export function findTerm(text: string, term: string): Array<[number, number]> {
  const hay = foldKeepLength(text);
  const needle = foldKeepLength(term.trim());
  if (!needle) return [];
  const out: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    let end = i + needle.length;
    if (/[sx]/.test(hay[end] ?? '') && !isWordChar(hay[end + 1])) end++;
    if (!isWordChar(hay[i - 1]) && !isWordChar(hay[end])) out.push([i, end]);
    from = i + needle.length;
  }
  return out;
}

export interface TagMark {
  start: number;
  end: number;
  cat: BreakdownCategory;
  item: string;
  /** Repéré dans le texte mais pas encore ajouté (suggestion). */
  suggested?: boolean;
  /** Déduit du découpage (plans, matériel) : ne se retire pas d'ici. */
  derived?: boolean;
}

/** Ce que le texte d'une séquence peut repérer, calculé une fois pour tous ses paragraphes. */
export interface TagContext {
  /** Termes connus, les plus longs d'abord (« rouge à lèvres » avant « rouge »). */
  known: Array<{ cat: BreakdownCategory; item: string; derived: boolean }>;
  /** Termes connus repliés (sans casse ni accents). */
  have: Set<string>;
}

export function tagContext(doc: ProjectDoc, seqId: ID): TagContext {
  const manual = breakdownOf(doc, seqId);
  const derived = derivedBreakdown(doc, seqId);
  // Personnages ajoutés à la séquence (pas nommés par ses plans) : saisis ici, donc retirables.
  const added = addedCharacters(doc, seqId);
  const known: TagContext['known'] = [];
  for (const cat of breakdownCategories(doc)) {
    for (const item of manual[cat] ?? []) known.push({ cat, item, derived: false });
    const mine = new Set((manual[cat] ?? []).map(fold));
    const free = new Set((added[cat] ?? []).map(fold));
    for (const item of derived[cat] ?? []) if (!mine.has(fold(item))) known.push({ cat, item, derived: !free.has(fold(item)) });
  }
  known.sort((x, y) => y.item.length - x.item.length);
  return { known, have: new Set(known.map((k) => foldKeepLength(k.item))) };
}

/** Repères d'un texte d'après le contexte de sa séquence. */
export function marksWith(ctx: TagContext, text: string): TagMark[] {
  const marks: TagMark[] = [];
  const taken = (a: number, b: number) => marks.some((m) => a < m.end && b > m.start);
  const add = (cat: BreakdownCategory, item: string, extra: Partial<TagMark>) => {
    for (const [a, b] of findTerm(text, item)) if (!taken(a, b)) marks.push({ start: a, end: b, cat, item, ...extra });
  };
  for (const k of ctx.known) add(k.cat, k.item, k.derived ? { derived: true } : {});
  for (const [cat, items] of Object.entries(detectInText(text)) as Array<[BreakdownCategory, string[]]>) for (const item of items) if (!ctx.have.has(foldKeepLength(item))) add(cat, item, { suggested: true });
  return marks.sort((x, y) => x.start - y.start);
}

/** Repères d'un texte : éléments déjà dépouillés (et déduits), puis suggestions du lexique. */
export function marksIn(doc: ProjectDoc, seqId: ID, text: string): TagMark[] {
  return marksWith(tagContext(doc, seqId), text);
}

/** Sélection → élément : sans ponctuation autour, espaces réduits, majuscule initiale. */
export function cleanTag(selection: string): string {
  const t = selection
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'«»“”‘’([{.,;:!?…–—-]+|[\s"'«»“”‘’)\]}.,;:!?…–—-]+$/g, '');
  if (!t) return '';
  return t.charAt(0).toLocaleUpperCase('fr') + t.slice(1);
}
