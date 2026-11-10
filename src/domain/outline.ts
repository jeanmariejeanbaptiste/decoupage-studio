/**
 * Séquencier : une lecture du texte du scénario. Chaque séquence est un en-tête, suivi d'une ligne
 * de résumé Fountain « = » non imprimée (la phrase), qui peut porter en fin de ligne une note
 * « [[ds:etape=9;intrigue=B]] » (étape de Truby, intrigue). Les parties sont les lignes « # ».
 * Une seule vérité, donc versionnée, comparée et exportée avec le texte.
 *
 * Toutes les fonctions d'écriture rendent une modification de la source (`SourceEdit`) : le nouveau
 * texte et la correspondance des positions, qu'`applyScenarioEdit` (ops.ts) applique au projet.
 */
import { isDraft } from 'immer';
import { alignScenes } from './sceneAlign';
import { chronoOf, chronoTimeline } from './chronometry';
import { matchSequence, parseFountain, scenesOf, HEADING_RE, type ScriptElement } from './fountain';
import { blocksFromSource, isEmptyBlock, outlineTagOf, OUTLINE_TAG_RE, EFFECT_WORDS, HEADING_PREFIXES, type SBlock } from './screenplay';
import { scriptOutline } from './scriptLayout';
import { shiftOffset } from './textDiff';
import type { ID, ProjectDoc } from './types';

// --- Types -------------------------------------------------------------------------------------

/** Nouvelle source et correspondance des positions de l'ancienne vers la nouvelle. */
export interface SourceEdit {
  source: string;
  map: (pos: number, side: 'start' | 'end') => number;
  /**
   * Correspondance d'une plage (ancre) : par défaut, ses deux bornes passent par `map`. Un
   * déplacement ramène une ancre à cheval sur deux morceaux dans le morceau de son début ; `null` :
   * le passage a disparu (séquence supprimée), l'ancre doit être retirée.
   */
  range?: (start: number, end: number) => [number, number] | null;
}

export type OutlineItem =
  | { kind: 'part'; title: string; start: number; end: number }
  | {
      kind: 'sequence';
      /** Numéro de la séquence (celui de l'éditeur et de l'impression). */
      n: number;
      /** Morceau de la séquence : de sa ligne d'en-tête jusqu'à l'en-tête ou la partie suivante. */
      start: number;
      end: number;
      /** Ligne d'en-tête (sans le retour). */
      headingStart: number;
      headingEnd: number;
      /** En-tête tel qu'écrit, sans « . » de forçage ni numéro « #12# ». */
      heading: string;
      /** « INT. », « EXT. », « INT./EXT. » (ou le préfixe écrit s'il est autre). */
      intExt?: string;
      location: string;
      /** Moment : ce qui suit le dernier tiret entouré d'espaces. */
      effect?: string;
      /** Numéro de scène imposé (« #12# » → « 12 »). */
      forced?: string;
      /** Numéro écrit en tête de l'en-tête (« 12. INT. … » → « 12. »), gardé à la réécriture. */
      lead?: string;
      phrase: string;
      /** Plage de la phrase dans la source (sans « = » ni note). */
      phraseRange?: [number, number];
      /** Note brute « [[ds:…]] ». */
      meta?: string;
      step?: number | string;
      plot: string;
      /** La séquence a du texte imprimé sous son en-tête. */
      hasBody: boolean;
    };

export type OutlineSequence = Extract<OutlineItem, { kind: 'sequence' }>;
export type OutlinePart = Extract<OutlineItem, { kind: 'part' }>;

export interface OutlineTag {
  step?: number | string;
  plot?: string;
  /** Paires inconnues, réécrites telles quelles (« cle=valeur;autre=x »). */
  extra?: string;
}

export const DEFAULT_PLOT = 'A';
export const DEFAULT_PLOTS: ReadonlyArray<{ key: string; name: string }> = [{ key: DEFAULT_PLOT, name: 'Intrigue principale' }];

// --- Note ---------------------------------------------------------------------------------------

/** Lit une note « [[ds:etape=9;intrigue=B]] » (ou son contenu seul). */
export function parseOutlineTag(s: string | undefined): OutlineTag {
  const out: OutlineTag = {};
  if (!s) return out;
  const inner = /^\s*\[\[ds:([^\]]*)\]\]\s*$/.exec(s)?.[1] ?? s;
  const extra: string[] = [];
  for (const pair of inner.split(';')) {
    if (!pair.trim()) continue;
    const eq = pair.indexOf('=');
    const key = (eq < 0 ? pair : pair.slice(0, eq)).trim();
    const value = eq < 0 ? '' : pair.slice(eq + 1).trim();
    if (key === 'etape' && value && out.step === undefined) {
      const n = /^\d+$/.test(value) ? Number(value) : NaN;
      out.step = n >= 1 && n <= 22 ? n : value;
    } else if (key === 'intrigue' && value && out.plot === undefined) out.plot = value;
    else extra.push(pair.trim());
  }
  if (extra.length) out.extra = extra.join(';');
  return out;
}

/** Écrit une note ; rien quand il n'y a ni étape, ni autre intrigue que A, ni paire inconnue. */
export function formatOutlineTag(t: OutlineTag): string {
  const pairs: string[] = [];
  const step = t.step !== undefined ? tagValue(String(t.step)) : '';
  if (step) pairs.push(`etape=${step}`);
  const plot = t.plot ? tagValue(t.plot) : '';
  if (plot && plot !== DEFAULT_PLOT) pairs.push(`intrigue=${plot}`);
  const extra = t.extra?.replace(/[[\]\r\n]/g, '').trim();
  if (extra) pairs.push(extra);
  return pairs.length ? `[[ds:${pairs.join(';')}]]` : '';
}

// --- Lecture ------------------------------------------------------------------------------------

interface Line {
  start: number;
  /** Fin de la ligne, sans « \r ». */
  end: number;
  text: string;
}

function linesOf(source: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of source.split('\n')) {
    const text = raw.replace(/\r$/, '');
    out.push({ start: pos, end: pos + text.length, text });
    pos += raw.length + 1;
  }
  return out;
}

function lineIndexAt(lines: readonly Line[], pos: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].start <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const eolOf = (source: string) => (source.includes('\r\n') ? '\r\n' : '\n');
/**
 * Texte écrit dans le scénario par le séquencier, sur une ligne, sans « [[ », « ]] », « /* » ni « *\/ » :
 * ils ouvriraient une note ou une zone écartée et feraient disparaître les scènes suivantes.
 */
const oneLine = (s: string) =>
  s
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\[\[/g, '[ [')
    .replace(/\]\]/g, '] ]')
    .replace(/\/\*/g, '/ *')
    .replace(/\*\//g, '* /')
    .trim();
/** Valeur d'une note : ni crochet, ni séparateur, ni retour. */
const tagValue = (v: string) => v.replace(/[[\];=\r\n]/g, '').trim();
const upper = (s: string) => s.toLocaleUpperCase('fr');

/** Moments reconnus en fin d'en-tête (après un tiret) ; autrement, la fin de l'en-tête reste au lieu. */
const MOMENT_RE =
  /^(JOUR|NUIT|AUBE|CR[ÉE]PUSCULE|MATIN|MATIN[ÉE]E|SOIR|SOIR[ÉE]E|MIDI|APR[ÈE]S-MIDI|PETIT MATIN|FIN DE JOURN[ÉE]E|TOMB[ÉE]E DE LA NUIT|LEVER DU JOUR|CONTINU|CONTINUIT[ÉE]|SUITE|PLUS TARD|MOMENTS? PLUS TARD|M[ÊE]ME MOMENT|AU M[ÊE]ME MOMENT|FLASH-?BACK|DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|CONTINUOUS|LATER)(\s*\(.*\))?\.?$/;
const isMoment = (s: string) => MOMENT_RE.test(upper(s.trim())) || (EFFECT_WORDS as readonly string[]).includes(upper(s.trim()));

/**
 * Découpe d'un en-tête tel qu'écrit : numéro en tête (« 12. »), préfixe, lieu, moment. Le moment est la
 * fin après le dernier tiret entouré d'espaces, seulement si c'est un moment connu (« GARE — CONSIGNE »
 * reste un lieu entier).
 */
export function headingParts(heading: string): { lead?: string; intExt?: string; location: string; effect?: string } {
  let h = heading.trim();
  const num = /^(\d+[A-Z]?[.)-]?)\s+(?=\S)/.exec(h);
  const lead = num && /^(int|ext|est|i\/e)/i.test(h.slice(num[0].length)) ? num[1] : undefined;
  if (lead) h = h.slice(num![0].length);
  let intExt: string | undefined;
  const m = /^(int\.?\s*\/\s*ext\.?|ext\.?\s*\/\s*int\.?|i\/e\.?|int\.?|ext\.?|est\.?)(?=[\s.\-–—:]|$)/i.exec(h);
  if (m) {
    const k = m[1].toLowerCase().replace(/\s+/g, '');
    intExt = k.includes('/') ? 'INT./EXT.' : k.startsWith('int') ? 'INT.' : k.startsWith('ext') ? 'EXT.' : upper(m[1]);
    h = h.slice(m[0].length).replace(/^\s*[-–—.:]?\s*/, '');
  }
  const e = /^(.*?)\s+[-–—]\s+([^-–—]+)$/.exec(h);
  const known = !!e && isMoment(e[2]);
  return { ...(lead ? { lead } : {}), intExt, location: (known ? e![1] : h).trim(), effect: known ? e![2].trim() : undefined };
}

interface Unit {
  kind: 'part' | 'sequence';
  /** Début de la ligne qui ouvre le morceau. */
  start: number;
  /** Fin du dernier caractère non blanc du morceau (sans retour). */
  contentEnd: number;
  /** Début du morceau suivant (ou fin de la source). */
  end: number;
  line: number;
  el: ScriptElement;
}

interface Scan {
  source: string;
  lines: Line[];
  elements: ScriptElement[];
  units: Unit[];
  /** Fin du dernier caractère non blanc avant le premier morceau. */
  preludeEnd: number;
  items: OutlineItem[];
}

const scanCache = { source: '', scan: null as Scan | null };

function scan(source: string): Scan {
  if (scanCache.scan && scanCache.source === source) return scanCache.scan;
  const lines = linesOf(source);
  const elements = parseFountain(source);
  const opens = elements.filter((el) => (el.type === 'heading' && el.text.trim() !== '') || el.type === 'section');
  const lastFilled = (fromLine: number, toLine: number) => {
    for (let k = toLine; k >= fromLine; k--) if (lines[k].text.trim() !== '') return lines[k].end;
    return lines[fromLine]?.start ?? 0;
  };
  const units: Unit[] = [];
  opens.forEach((el) => {
    const line = lineIndexAt(lines, el.start);
    if (units.length && units[units.length - 1].line === line) return;
    units.push({ kind: el.type === 'section' ? 'part' : 'sequence', start: lines[line].start, contentEnd: 0, end: source.length, line, el });
  });
  units.forEach((u, k) => {
    const next = units[k + 1];
    u.end = next ? next.start : source.length;
    const lastLine = next ? next.line - 1 : lines.length - 1;
    u.contentEnd = lastFilled(u.line, lastLine);
  });
  const preludeEnd = units.length ? (units[0].line > 0 ? lastFilled(0, units[0].line - 1) : 0) : lastFilled(0, lines.length - 1);
  const items: OutlineItem[] = [];
  let n = 0;
  for (const u of units) {
    if (u.kind === 'part') {
      items.push({ kind: 'part', title: u.el.text.trim(), start: u.start, end: lines[u.line].end });
      continue;
    }
    n++;
    const lineText = lines[u.line].text;
    const forced = /#([^#]+)#\s*$/.exec(lineText)?.[1]?.trim();
    const heading = u.el.text.trim();
    const parts = headingParts(heading);
    // La phrase : le premier résumé après l'en-tête, avant tout bloc imprimé (notes permises).
    let phrase = '';
    let phraseRange: [number, number] | undefined;
    let meta: string | undefined;
    let hasBody = false;
    let looking = true;
    for (const el of elements) {
      if (el.start <= u.el.start) continue;
      if (el.start >= u.end) break;
      if (looking) {
        if (el.type === 'note') continue;
        if (el.type === 'synopsis') {
          const li = lines[lineIndexAt(lines, el.start)];
          meta = outlineTagOf(li.text);
          const body = meta ? li.text.replace(OUTLINE_TAG_RE, '') : li.text;
          const at = li.start + body.length - body.replace(/^\s*=\s*/, '').length;
          const end = li.start + body.trimEnd().length;
          phrase = source.slice(at, Math.max(at, end));
          phraseRange = [at, Math.max(at, end)];
          looking = false;
          continue;
        }
        looking = false;
      }
      if (el.type !== 'note' && el.type !== 'synopsis' && el.type !== 'section' && el.type !== 'pagebreak' && el.text.trim()) hasBody = true;
    }
    const tag = parseOutlineTag(meta);
    items.push({
      kind: 'sequence',
      n,
      start: u.start,
      end: u.end,
      headingStart: u.start,
      headingEnd: lines[u.line].end,
      heading,
      ...(parts.intExt ? { intExt: parts.intExt } : {}),
      location: parts.location,
      ...(parts.effect ? { effect: parts.effect } : {}),
      ...(forced ? { forced } : {}),
      ...(parts.lead ? { lead: parts.lead } : {}),
      phrase,
      ...(phraseRange ? { phraseRange } : {}),
      ...(meta ? { meta } : {}),
      ...(tag.step !== undefined ? { step: tag.step } : {}),
      plot: tag.plot ?? DEFAULT_PLOT,
      hasBody,
    });
  }
  const s: Scan = { source, lines, elements, units, preludeEnd, items };
  scanCache.source = source;
  scanCache.scan = s;
  return s;
}

/** Entrées du séquencier : parties et séquences, dans l'ordre du texte. Le texte avant le premier en-tête n'est jamais listé. */
export function outlineOf(source: string): OutlineItem[] {
  return scan(source).items;
}

/** Séquences du séquencier seulement. */
export const outlineSequences = (source: string): OutlineSequence[] => outlineOf(source).filter((x): x is OutlineSequence => x.kind === 'sequence');

/** Ce bloc de l'éditeur est-il la phrase d'une séquence (premier résumé sous un en-tête, notes permises) ? */
export function isOutlinePhrase(blocks: readonly SBlock[], i: number): boolean {
  const b = blocks[i];
  if (!b || b.type !== 'synopsis' || isEmptyBlock(b)) return false;
  for (let j = i - 1; j >= 0; j--) {
    const p = blocks[j];
    if (p.type === 'heading') return !isEmptyBlock(p);
    if (p.type === 'note' || isEmptyBlock(p)) continue;
    return false;
  }
  return false;
}

function sequenceAt(source: string, n: number): OutlineSequence {
  const it = outlineSequences(source).find((x) => x.n === n);
  if (!it) throw new Error(`Séquence ${n} introuvable.`);
  return it;
}

// --- Écriture -----------------------------------------------------------------------------------

/** Remplace [a, b) par `text`. */
function replaceEdit(source: string, a: number, b: number, text: string): SourceEdit {
  const next = source.slice(0, a) + text + source.slice(b);
  return { source: next, map: (pos, side) => shiftOffset(Math.max(0, Math.min(pos, source.length)), a, b - a, text.length, side) };
}

/** Ligne de résumé : « = phrase [[ds:…]] », « = [[ds:…]] », ou rien. */
function phraseLine(text: string, meta: string | undefined): string {
  const t = oneLine(text);
  if (!t && !meta) return '';
  return `=${t ? ` ${t}` : ''}${meta ? ` ${meta}` : ''}`;
}

/** Écrit (ou retire) la ligne de phrase d'une séquence. */
function writePhrase(source: string, it: OutlineSequence, text: string, meta: string | undefined): SourceEdit {
  const eol = eolOf(source);
  const { lines } = scan(source);
  const line = phraseLine(text, meta);
  if (it.phraseRange) {
    const li = lineIndexAt(lines, it.phraseRange[0]);
    const L = lines[li];
    if (line) {
      // Seul le texte et la note changent : « = » et ce qui précède restent.
      const t = oneLine(text);
      const base = L.text.slice(0, it.phraseRange[0] - L.start).replace(/\s+$/, '');
      const rest = `${t ? ` ${t}` : ''}${meta ? ` ${meta}` : ''}`;
      if (L.text.slice(base.length) === rest) return { source, map: (p) => p };
      return replaceEdit(source, L.start + base.length, L.end, rest);
    }
    // Ligne retirée, avec les lignes vides qui la suivent (ou qui la précèdent en fin de texte).
    let k = li + 1;
    while (k < lines.length && lines[k].text.trim() === '') k++;
    if (k < lines.length) return replaceEdit(source, L.start, lines[k].start, '');
    let p = li - 1;
    while (p >= 0 && lines[p].text.trim() === '') p--;
    return replaceEdit(source, p >= 0 ? lines[p].end : L.start, L.end, '');
  }
  if (!line) return { source, map: (p) => p };
  const li = lineIndexAt(lines, it.headingStart);
  const next = lines[li + 1];
  const insert = next && next.text.trim() !== '' ? `${eol}${eol}${line}${eol}` : `${eol}${eol}${line}`;
  return replaceEdit(source, lines[li].end, lines[li].end, insert);
}

/** Écrit la phrase d'une séquence : crée la ligne « = » sous l'en-tête ou la remplace ; la note reste. */
export function setPhrase(source: string, n: number, phrase: string): SourceEdit {
  const it = sequenceAt(source, n);
  return writePhrase(source, it, phrase, it.meta);
}

/** Change l'étape et l'intrigue d'une séquence (clé présente : changée, `undefined` ou `null` : retirée). */
export function setOutlineTag(source: string, n: number, t: { step?: number | string | null; plot?: string | null }): SourceEdit {
  const it = sequenceAt(source, n);
  const tag = parseOutlineTag(it.meta);
  if ('step' in t) tag.step = t.step === null || t.step === undefined || String(t.step).trim() === '' ? undefined : t.step;
  if ('plot' in t) tag.plot = t.plot || undefined;
  const meta = formatOutlineTag(tag) || undefined;
  return writePhrase(source, it, it.phrase, meta);
}

/** Préfixe normalisé (« INT » → « INT. », « INT/EXT » → « INT./EXT. »). */
function prefixOf(intExt: string | undefined): string {
  const t = (intExt ?? '').trim();
  if (!t) return '';
  const k = t.toLowerCase().replace(/[\s.]/g, '');
  if (k === 'int/ext' || k === 'ext/int' || k === 'i/e') return 'INT./EXT.';
  if (k === 'int') return 'INT.';
  if (k === 'ext') return 'EXT.';
  return HEADING_PREFIXES.map((p) => p.trim()).find((p) => p === upper(t)) ?? upper(t);
}

function headingLine(intExt: string | undefined, location: string, effect: string | undefined, forced?: string, lead?: string): string {
  const prefix = prefixOf(intExt);
  const body = [prefix ? lead : undefined, prefix, upper(oneLine(location))].filter(Boolean).join(' ') + (effect && oneLine(effect) ? ` - ${upper(oneLine(effect))}` : '');
  const line = HEADING_RE.test(body) ? body : `.${body}`;
  return forced ? `${line} #${forced}#` : line;
}

/** Réécrit l'en-tête d'une séquence ; un champ absent garde sa valeur, le numéro « #12# » est gardé. */
export function setHeading(source: string, n: number, h: { intExt?: string; location?: string; effect?: string }): SourceEdit {
  const it = sequenceAt(source, n);
  const location = h.location ?? it.location;
  if (!oneLine(location)) throw new Error('Lieu manquant.');
  const line = headingLine('intExt' in h ? h.intExt : it.intExt, location, 'effect' in h ? h.effect : it.effect, it.forced, it.lead);
  const { lines } = scan(source);
  const L = lines[lineIndexAt(lines, it.headingStart)];
  if (L.text === line) return { source, map: (p) => p };
  return replaceEdit(source, L.start, L.end, line);
}

/** Texte d'une entrée nouvelle : en-tête, ligne vide, phrase. */
function entryText(eol: string, e: { intExt?: string; location: string; effect?: string; phrase?: string }, meta?: string): string {
  const head = headingLine(e.intExt, e.location, e.effect);
  const line = phraseLine(e.phrase ?? '', meta);
  return line ? `${head}${eol}${eol}${line}` : head;
}

/** Insère `text` comme un morceau entier, avant le morceau qui commence en `at`, ou à la fin. */
function insertUnit(source: string, text: string, before: Unit | undefined): SourceEdit {
  const eol = eolOf(source);
  if (before) {
    // L'en-tête inséré n'est lu comme tel qu'après une ligne vide.
    const head = source.slice(0, before.start);
    const blank = !head.trim() || /\n[^\S\n]*\r?\n$/.test(head);
    return replaceEdit(source, before.start, before.start, `${blank ? '' : eol}${text}${eol}${eol}`);
  }
  if (!source.trim()) return replaceEdit(source, 0, source.length, `${text}${eol}`);
  const trailing = /(\r?\n)*$/.exec(source)![0].split('\n').length - 1;
  return replaceEdit(source, source.length, source.length, `${eol.repeat(Math.max(0, 2 - trailing))}${text}${eol}`);
}

/**
 * Nouvelle séquence après la séquence `after` (0 : en tête, sous l'intertitre éventuel ; 'end' : à la
 * fin du texte). Sans lieu, l'appel est refusé. Renvoie aussi le numéro de la séquence créée.
 */
export function insertEntry(
  source: string,
  after: number | 'end',
  e: { intExt?: string; location: string; effect?: string; phrase?: string; step?: number | string; plot?: string },
): SourceEdit & { n: number } {
  if (!oneLine(e.location ?? '')) throw new Error('Lieu manquant.');
  const s = scan(source);
  const seqUnits = s.units.filter((u) => u.kind === 'sequence');
  const meta = formatOutlineTag({ step: e.step, plot: e.plot }) || undefined;
  const text = entryText(eolOf(source), e, meta);
  if (after === 'end' || after >= seqUnits.length) return { ...insertUnit(source, text, undefined), n: seqUnits.length + 1 };
  if (after <= 0) return { ...insertUnit(source, text, seqUnits[0]), n: 1 };
  const k = s.units.indexOf(seqUnits[after - 1]);
  return { ...insertUnit(source, text, s.units[k + 1]), n: after + 1 };
}

/** Intertitre de partie « # titre », juste avant l'en-tête de la séquence `beforeN` (au-delà : à la fin). */
export function insertPart(source: string, beforeN: number, title: string): SourceEdit {
  const t = oneLine(title);
  if (!t) throw new Error('Titre manquant.');
  const seqUnits = scan(source).units.filter((u) => u.kind === 'sequence');
  return insertUnit(source, `# ${t}`, seqUnits[beforeN - 1]);
}

/** Retire l'intertitre d'une partie (sa ligne seulement), `partIndex` comptant les parties à partir de 0. */
export function removePart(source: string, partIndex: number): SourceEdit {
  const { units, lines } = scan(source);
  const u = units.filter((x) => x.kind === 'part')[partIndex];
  if (!u) throw new Error(`Partie ${partIndex + 1} introuvable.`);
  let k = u.line + 1;
  while (k < lines.length && lines[k].text.trim() === '') k++;
  if (k < lines.length) return replaceEdit(source, lines[u.line].start, lines[k].start, '');
  let p = u.line - 1;
  while (p >= 0 && lines[p].text.trim() === '') p--;
  return replaceEdit(source, p >= 0 ? lines[p].end : lines[u.line].start, lines[u.line].end, '');
}

/** Supprime une séquence : de sa ligne d'en-tête jusqu'au morceau suivant. */
export function removeEntry(source: string, n: number): SourceEdit {
  const s = scan(source);
  const seqUnits = s.units.filter((u) => u.kind === 'sequence');
  const u = seqUnits[n - 1];
  if (!u) throw new Error(`Séquence ${n} introuvable.`);
  const k = s.units.indexOf(u);
  // Dernier morceau : la fin du texte (retour final) reste, le séparateur qui le précédait part.
  const edit = k < s.units.length - 1 ? replaceEdit(source, u.start, u.end, '') : replaceEdit(source, k > 0 ? s.units[k - 1].contentEnd : s.preludeEnd, u.contentEnd, '');
  // Une ancre qui commence dans la séquence supprimée disparaît avec elle (sinon elle tomberait sur la suivante).
  const gone = (p: number) => p >= u.start && p <= u.contentEnd;
  return { ...edit, range: (a, b) => (gone(a) ? null : defaultRange(edit.map, a, b)) };
}

/**
 * Déplace la séquence `from` pour qu'elle devienne la séquence `to`. Les parties restent en place,
 * le prélude (texte avant le premier morceau) ne bouge jamais, et une ligne vide exactement sépare
 * deux morceaux. Le morceau d'une séquence va de sa ligne d'en-tête jusqu'avant l'en-tête ou la
 * partie suivante (un « === » placé juste avant l'en-tête suivant lui appartient donc).
 *
 * Quand des intertitres séparent les deux voisines d'arrivée, `edge` dit où se poser : 'top', juste
 * après la séquence précédente (avant les intertitres) ; 'bottom', juste avant la suivante (sous
 * l'intertitre : la séquence rejoint sa partie). Par défaut : 'top' en descendant, 'bottom' en
 * montant. Avec `from === to`, `edge` fait passer une séquence d'une partie à sa voisine.
 */
export function moveEntry(source: string, from: number, to: number, opts: { edge?: 'top' | 'bottom' } = {}): SourceEdit {
  const s = scan(source);
  const seqUnits = s.units.filter((u) => u.kind === 'sequence');
  const moved = seqUnits[from - 1];
  if (!moved) throw new Error(`Séquence ${from} introuvable.`);
  const target = Math.max(1, Math.min(to, seqUnits.length));
  if (target === from && !opts.edge) return { source, map: (p) => p };
  const edge = opts.edge ?? (target > from ? 'top' : 'bottom');
  const rest = s.units.filter((u) => u !== moved);
  const restSeq = seqUnits.filter((u) => u !== moved);
  const t = target - 1;
  const prev = t > 0 ? restSeq[t - 1] : undefined;
  const next = restSeq[t];
  let at: number;
  if (edge === 'top') at = prev ? rest.indexOf(prev) + 1 : 0;
  else at = next ? rest.indexOf(next) : rest.length;
  const order = rest.slice();
  order.splice(at, 0, moved);
  if (order.every((u, k) => u === s.units[k])) return { source, map: (p) => p };
  const eol = eolOf(source);
  const sep = eol + eol;
  const first = s.units[0];
  const last = s.units[s.units.length - 1];
  const prelude = source.slice(0, first.start);
  const tail = source.slice(last.contentEnd);
  let out = prelude;
  const placed = new Map<Unit, number>();
  order.forEach((u, k) => {
    if (k) out += sep;
    placed.set(u, out.length);
    out += source.slice(u.start, u.contentEnd);
  });
  out += tail;
  const oldLen = source.length;
  const newLen = out.length;
  const units = s.units;
  const newStart = (u: Unit) => placed.get(u)!;
  const newEnd = (u: Unit) => placed.get(u)! + (u.contentEnd - u.start);
  /** Région d'une position : -1 prélude, k morceau, units.length fin. */
  const regionOf = (p: number, side: 'start' | 'end'): number => {
    if (p < first.start) return -1;
    if (p > last.contentEnd) return units.length;
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      const nx = units[k + 1];
      if (p >= u.start && p <= u.contentEnd) {
        // La position qui ouvre un morceau, vue comme une fin, termine le précédent.
        if (side === 'end' && p === u.start && k > 0 && p > units[k - 1].contentEnd) return k - 1;
        return k;
      }
      if (nx && p > u.contentEnd && p < nx.start) return side === 'start' ? k + 1 : k;
    }
    return units.length;
  };
  const map = (pos: number, side: 'start' | 'end'): number => {
    const p = Math.max(0, Math.min(pos, oldLen));
    const r = regionOf(p, side);
    if (r < 0) return p;
    if (r >= units.length) return newLen - (oldLen - p);
    const u = units[r];
    if (p < u.start) return newStart(u);
    if (p > u.contentEnd) return newEnd(u);
    return newStart(u) + (p - u.start);
  };
  const range = (a: number, b: number): [number, number] | null => {
    const ms = map(a, 'start');
    if (b <= a) return [ms, ms];
    const ra = regionOf(Math.max(0, Math.min(a, oldLen)), 'start');
    const rb = regionOf(Math.max(0, Math.min(b, oldLen)), 'end');
    if (ra === rb) return [ms, Math.max(ms, map(b, 'end'))];
    // À cheval sur deux morceaux : ramenée dans celui de son début.
    const end = ra < 0 ? first.start : ra >= units.length ? newLen : newEnd(units[ra]);
    return [ms, Math.max(ms, end)];
  };
  return { source: out, map, range };
}

function defaultRange(map: SourceEdit['map'], start: number, end: number): [number, number] {
  const s = map(start, 'start');
  return [s, end <= start ? s : Math.max(s, map(end, 'end'))];
}

/** Plage d'une ancre après une modification ; `null` si son passage a disparu. */
export function mapRange(edit: SourceEdit, start: number, end: number): [number, number] | null {
  return edit.range ? edit.range(start, end) : defaultRange(edit.map, start, end);
}

/** Textes des lignes « = » d'une séquence (sans note). */
function synopsisLines(source: string, it: OutlineSequence): string[] {
  return source
    .slice(it.start, it.end)
    .split('\n')
    .filter((l) => /^\s*=(?!==)/.test(l))
    .map((l) => l.replace(/\r$/, '').replace(OUTLINE_TAG_RE, '').replace(/^\s*=\s*/, '').trim());
}

/**
 * Nouveau texte (version, réimport, réécriture) : chaque scène rapprochée de l'ancienne reprend sa
 * phrase si elle n'en a pas, et sa note si elle n'en a pas (un texte relu de Final Draft garde la
 * phrase mais perd la note). Rien n'est jamais écrasé.
 */
export function carryOutline(before: string, after: string): string {
  if (!before || !after || before === after) return after;
  const oldItems = outlineSequences(before);
  if (!oldItems.some((x) => x.phrase || x.meta)) return after;
  const al = alignScenes(before, after);
  const byStart = (items: OutlineSequence[], at: number) => items.find((x) => at >= x.headingStart && at <= x.headingEnd);
  const newItems = outlineSequences(after);
  const todo: Array<{ to: OutlineSequence; phrase: string; meta?: string }> = [];
  for (const m of al.matches) {
    const from = byStart(oldItems, al.oldScenes[m.from].start);
    const to = byStart(newItems, al.newScenes[m.to].start);
    if (!from || !to) continue;
    // Le nouveau texte porte déjà cette phrase sur une ligne « = » de la scène : rien à reprendre.
    if (!to.phrase && from.phrase && synopsisLines(after, to).includes(from.phrase.trim())) continue;
    // Chacune séparément : la phrase si la scène n'en a pas, la note si elle n'en a pas (texte venu de Final Draft).
    const phrase = to.phrase || from.phrase;
    const meta = to.meta ?? from.meta;
    if (phrase !== to.phrase || meta !== to.meta) todo.push({ to, phrase, meta });
  }
  todo.sort((a, b) => b.to.headingStart - a.to.headingStart);
  let src = after;
  for (const { to, phrase, meta } of todo) src = writePhrase(src, to, phrase, meta).source;
  return src;
}

// --- Intrigues ----------------------------------------------------------------------------------

/** Intrigues employées dans le texte courant et dans celui de toutes les versions. */
export function plotsInUse(doc: Pick<ProjectDoc, 'scenario' | 'versions'>): Set<string> {
  const out = new Set<string>();
  const texts = [doc.scenario ?? '', ...(doc.versions ?? []).map((v) => v.slice?.scenario ?? '')];
  for (const t of texts) if (t) for (const it of outlineSequences(t)) out.add(it.plot);
  return out;
}

/** Intrigues du projet (par défaut, l'intrigue principale seule). */
export const plotsOf = (doc: Pick<ProjectDoc, 'plots'>): ReadonlyArray<{ key: string; name: string }> => (doc.plots?.length ? doc.plots : DEFAULT_PLOTS);

/** Nom d'une intrigue ; une lettre lue dans le texte mais inconnue s'affiche « Intrigue X ». */
export function plotName(doc: Pick<ProjectDoc, 'plots'>, key: string): string {
  return plotsOf(doc).find((p) => p.key === key)?.name ?? `Intrigue ${key}`;
}

/** Première lettre libre pour une nouvelle intrigue (ni déclarée, ni lue dans un texte). */
export function nextPlotKey(doc: Pick<ProjectDoc, 'plots' | 'scenario' | 'versions'>): string | undefined {
  const taken = new Set([...plotsOf(doc).map((p) => p.key), ...plotsInUse(doc)]);
  for (let c = 65; c <= 90; c++) if (!taken.has(String.fromCharCode(c))) return String.fromCharCode(c);
  return undefined;
}

// --- Mesures ------------------------------------------------------------------------------------

export interface OutlineMeasures {
  /** Page imprimée et durée (secondes, non arrondies) de chaque séquence, par numéro. */
  byN: Map<number, { page: number; sec: number }>;
  pages: number;
  total: number;
}

const measureCache = { source: '', chrono: undefined as unknown, value: null as OutlineMeasures | null };

/** Page de l'impression (`scriptOutline`) et durée (`chronoTimeline`, d'un en-tête au suivant) de chaque séquence. */
export function outlineMeasures(doc: Pick<ProjectDoc, 'scenario' | 'project'>): OutlineMeasures {
  const source = doc.scenario ?? '';
  const chrono = doc.project.settings.scriptChrono;
  if (measureCache.value && measureCache.source === source && measureCache.chrono === chrono) return measureCache.value;
  const blocks = blocksFromSource(source).blocks;
  const { items, pages } = scriptOutline(blocks);
  const tl = chronoTimeline(blocks, chronoOf(chrono));
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const byN = new Map<number, { page: number; sec: number }>();
  items.forEach((it, k) => {
    const start = tl.start[index.get(it.id)!] ?? 0;
    const nx = items[k + 1];
    const end = nx ? (tl.start[index.get(nx.id)!] ?? tl.total) : tl.total;
    byN.set(it.n, { page: it.page, sec: Math.max(0, end - start) });
  });
  const value = { byN, pages, total: tl.total };
  measureCache.source = source;
  measureCache.chrono = chrono;
  measureCache.value = value;
  return value;
}

// --- Résumé unique ------------------------------------------------------------------------------

/** Numéro de scène (séquencier) de chaque séquence du découpage rapprochée du texte (`matchSequence`). */
export function sequenceScenes(doc: ProjectDoc): Map<ID, number> {
  const out = new Map<ID, number>();
  const src = doc.scenario ?? '';
  if (!src) return out;
  const taken = new Set<ID>();
  scenesOf(src)
    .filter((sc) => sc.heading.trim() !== '')
    .forEach((sc, k) => {
      const id = matchSequence(doc, sc);
      if (id && !taken.has(id)) {
        taken.add(id);
        out.set(id, k + 1);
      }
    });
  return out;
}

const scenesMemo = new WeakMap<object, { scenario: string | undefined; ids: readonly ID[]; map: Map<ID, number> }>();

function sceneMap(doc: ProjectDoc): Map<ID, number> {
  if (isDraft(doc) || isDraft(doc.sequences)) return sequenceScenes(doc);
  const hit = scenesMemo.get(doc.sequences);
  if (hit && hit.scenario === doc.scenario && hit.ids === doc.project.sequenceIds) return hit.map;
  const map = sequenceScenes(doc);
  scenesMemo.set(doc.sequences, { scenario: doc.scenario, ids: doc.project.sequenceIds, map });
  return map;
}

/** Numéro de la scène du texte rapprochée de cette séquence (mémoïsé hors brouillon). */
export function sceneOfSequence(doc: ProjectDoc, seqId: ID): number | undefined {
  return sceneMap(doc).get(seqId);
}

/** Le résumé d'une séquence : la phrase du texte si elle est rapprochée d'une scène qui en a une, sinon `seq.summary`. */
export function sequenceSummary(doc: ProjectDoc, seqId: ID): string | undefined {
  const n = sceneOfSequence(doc, seqId);
  if (n !== undefined) {
    const phrase = outlineSequences(doc.scenario ?? '').find((x) => x.n === n)?.phrase.trim();
    if (phrase) return phrase;
  }
  return doc.sequences[seqId]?.summary?.trim() || undefined;
}
