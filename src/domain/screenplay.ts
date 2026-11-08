/**
 * Scénario en blocs, pour l'éditeur mis en page : la source Fountain reste la référence (ancres des
 * plans, séquences, personnages), l'éditeur travaille sur une liste de blocs typés. Un bloc intact
 * garde son texte source exact : seule la zone modifiée change, et les ancres se recalent sans perte.
 */
import { HEADING_RE, TRANSITION_RE, parseFountain } from './fountain';

export { HEADING_RE, TRANSITION_RE };

export type BlockType =
  | 'heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'centered'
  | 'note'
  | 'section'
  | 'synopsis'
  | 'pagebreak'
  | 'title';

export interface SBlock {
  id: string;
  type: BlockType;
  /** Texte affiché ; plusieurs lignes séparées par « \n » (action, réplique, page de titre). */
  text: string;
  /** Texte source exact tant que le bloc est intact. */
  raw?: string;
  /** Position de chaque ligne affichée dans `raw` (bloc intact). */
  lineOffsets?: number[];
  /** Séparateur d'origine placé avant le bloc, et rang d'origine du bloc. */
  sep?: string;
  orig?: number;
}

export interface ScriptDoc {
  blocks: SBlock[];
  /** Texte d'origine après le dernier bloc (fin de fichier). */
  trail: string;
}

/** Point du texte : bloc et position dans son texte affiché. */
export interface Caret {
  id: string;
  offset: number;
}

export interface Edit {
  doc: ScriptDoc;
  caret: Caret;
}

/** Libellés de l'interface, dans l'ordre du menu des éléments. */
export const BLOCK_LABELS: ReadonlyArray<[BlockType, string]> = [
  ['heading', 'Séquence'],
  ['action', 'Action'],
  ['character', 'Personnage'],
  ['parenthetical', 'Didascalie'],
  ['dialogue', 'Réplique'],
  ['transition', 'Transition'],
  ['note', 'Note'],
  ['centered', 'Centré'],
];

export const blockLabel = (t: BlockType): string =>
  BLOCK_LABELS.find(([k]) => k === t)?.[1] ?? { section: 'Partie', synopsis: 'Résumé', pagebreak: 'Saut de page', title: 'Page de titre' }[t as 'section'] ?? t;

let counter = 0;
const nid = () => `b${(++counter).toString(36)}`;

const isUpper = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase('fr');
const upper = (s: string) => s.toLocaleUpperCase('fr');
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
const MARKER = /^(!|@|\.(?!\.)|>|#|=|~|\[\[|\/\*)/;

const DIALOGUE_GROUP: ReadonlySet<BlockType> = new Set(['character', 'parenthetical', 'dialogue']);

/** Un bloc vide n'existe que dans l'éditeur : il n'écrit rien dans la source. */
export const isEmptyBlock = (b: SBlock): boolean => b.type !== 'pagebreak' && (b.type === 'parenthetical' ? b.text.replace(/[()\s]/g, '') === '' : b.text.trim() === '');

/** Découpe une source Fountain en blocs, en gardant le texte exact de chacun. */
export function blocksFromSource(source: string): ScriptDoc {
  const lines: Array<{ start: number; text: string }> = [];
  let pos = 0;
  for (const raw of source.split('\n')) {
    lines.push({ start: pos, text: raw });
    pos += raw.length + 1;
  }
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const groups: Array<{ type: BlockType; texts: string[]; starts: number[]; first: number; last: number }> = [];
  for (const el of parseFountain(source)) {
    const li = lineAt(el.start);
    const type = el.type as BlockType;
    const g = groups[groups.length - 1];
    if (g && li === g.last + 1 && g.type === type && (type === 'action' || type === 'dialogue' || type === 'title')) {
      g.texts.push(el.text);
      g.starts.push(el.start);
      g.last = li;
      continue;
    }
    groups.push({ type, texts: [el.text], starts: [el.start], first: li, last: li });
  }
  const blocks: SBlock[] = [];
  let prevEnd = 0;
  groups.forEach((g, i) => {
    const rawStart = lines[g.first].start;
    const lastLine = lines[g.last];
    const rawEnd = lastLine.start + lastLine.text.replace(/\r$/, '').length;
    blocks.push({
      id: nid(),
      type: g.type,
      text: g.texts.join('\n'),
      raw: source.slice(rawStart, rawEnd),
      lineOffsets: g.starts.map((s) => s - rawStart),
      sep: source.slice(prevEnd, rawStart),
      orig: i,
    });
    prevEnd = rawEnd;
  });
  return { blocks, trail: source.slice(prevEnd) };
}

/** Séparateur attendu entre deux blocs : retour simple dans une réplique, ligne vide ailleurs. */
export function ruleSep(prev: BlockType, next: BlockType): string {
  return DIALOGUE_GROUP.has(prev) && (next === 'dialogue' || next === 'parenthetical') ? '\n' : '\n\n';
}

const sepKind = (s: string) => (/\n[^\S\n]*\r?\n/.test(s) ? 'blank' : 'single');

/** Une ligne d'action serait-elle lue autrement (en-tête, personnage, transition, marqueur) ? */
function actionNeedsForce(line: string, first: boolean, nextLine: string): boolean {
  const t = line.trim();
  if (MARKER.test(t) || /^={3,}$/.test(t)) return true;
  if (!first) return false;
  if (HEADING_RE.test(t)) return true;
  if (nextLine.trim() !== '' && isUpper(t.replace(/\(.*\)/g, '').replace(/\^$/, ''))) return true;
  return nextLine.trim() === '' && isUpper(t) && TRANSITION_RE.test(t);
}

/** Texte source d'un bloc modifié, et position de chacune de ses lignes affichées. */
function rawOf(b: SBlock, next: SBlock | undefined): { raw: string; lineOffsets: number[] } {
  const single = (prefix: string, text: string, suffix = '') => ({ raw: prefix + text + suffix, lineOffsets: [prefix.length] });
  switch (b.type) {
    case 'heading': {
      const t = upper(oneLine(b.text));
      return HEADING_RE.test(t) ? single('', t) : single('.', t);
    }
    case 'character': {
      const t = upper(oneLine(b.text));
      const plain = !!next && (next.type === 'dialogue' || next.type === 'parenthetical') && !isEmptyBlock(next) && isUpper(t.replace(/\(.*\)/g, '').replace(/\^$/, '')) && !MARKER.test(t) && !HEADING_RE.test(t) && !TRANSITION_RE.test(t);
      return plain ? single('', t) : single('@', t);
    }
    case 'parenthetical': {
      const inner = oneLine(b.text).replace(/^\(+|\)+$/g, '').trim();
      return single('', `(${inner})`);
    }
    case 'transition': {
      const t = upper(oneLine(b.text));
      return isUpper(t) && TRANSITION_RE.test(t) && !MARKER.test(t) ? single('', t) : single('> ', t);
    }
    case 'centered':
      return single('> ', oneLine(b.text), ' <');
    case 'note':
      return single('[[', oneLine(b.text), ']]');
    case 'section':
      return single('# ', oneLine(b.text));
    case 'synopsis':
      return single('= ', oneLine(b.text));
    case 'pagebreak':
      return single('', '===');
    case 'title':
    case 'dialogue':
    case 'action': {
      const lines = b.text.split('\n').filter((l, _i, all) => l.trim() !== '' || all.length === 1);
      let raw = '';
      const lineOffsets: number[] = [];
      lines.forEach((l, i) => {
        if (i) raw += '\n';
        const force = b.type === 'action' && actionNeedsForce(l, i === 0, lines[i + 1] ?? '');
        if (force) raw += '!';
        lineOffsets.push(raw.length);
        // Page de titre : « Clé: valeur » au bord, suite d'une valeur en retrait (règle Fountain).
        raw += b.type === 'title' ? (i === 0 || /^\s*[^:\s][^:]{0,29}:/.test(l) ? l.trim() : `    ${l.trim()}`) : l;
      });
      return { raw, lineOffsets };
    }
  }
}

export interface Span {
  id: string;
  /** Début et fin du bloc dans la source. */
  start: number;
  end: number;
  /** Position dans la source de chaque ligne affichée. */
  lines: number[];
}

/** Recompose la source Fountain, avec la place exacte de chaque bloc. */
export function serialize(doc: ScriptDoc): { source: string; spans: Span[] } {
  const emitted = doc.blocks.filter((b) => !isEmptyBlock(b));
  let out = '';
  const spans: Span[] = [];
  let prev: SBlock | undefined;
  emitted.forEach((b, i) => {
    const adjacent = prev ? prev.orig !== undefined && b.orig === prev.orig + 1 : b.orig === 0;
    let sep: string;
    if (!prev) sep = adjacent && b.sep !== undefined ? b.sep : '';
    else {
      const rule = ruleSep(prev.type, b.type);
      sep = adjacent && b.sep !== undefined && sepKind(b.sep) === sepKind(rule) ? b.sep : rule;
    }
    out += sep;
    const start = out.length;
    const { raw, lineOffsets } = b.raw !== undefined && b.lineOffsets ? { raw: b.raw, lineOffsets: b.lineOffsets } : rawOf(b, emitted[i + 1]);
    out += raw;
    spans.push({ id: b.id, start, end: out.length, lines: lineOffsets.map((o) => start + o) });
    prev = b;
  });
  out += doc.trail;
  return { source: out, spans };
}

/** Position dans la source d'un point du texte affiché. */
export function caretToSource(blocks: readonly SBlock[], spans: readonly Span[], c: Caret): number | null {
  const span = spans.find((s) => s.id === c.id);
  const b = blocks.find((x) => x.id === c.id);
  if (!span || !b) {
    // Bloc vide (absent de la source) : la position du bloc suivant qui existe.
    const i = blocks.findIndex((x) => x.id === c.id);
    for (let k = i + 1; k < blocks.length && i >= 0; k++) {
      const sp = spans.find((s) => s.id === blocks[k].id);
      if (sp) return sp.start;
    }
    return spans.length ? spans[spans.length - 1].end : 0;
  }
  const lines = b.text.split('\n');
  let off = c.offset;
  for (let j = 0; j < lines.length; j++) {
    if (off <= lines[j].length || j === lines.length - 1) return (span.lines[Math.min(j, span.lines.length - 1)] ?? span.start) + Math.min(off, lines[j].length);
    off -= lines[j].length + 1;
  }
  return span.start;
}

/** Point du texte affiché correspondant à une position de la source (bornée au bloc le plus proche). */
export function sourceToCaret(blocks: readonly SBlock[], spans: readonly Span[], pos: number): Caret | null {
  if (!spans.length) return blocks[0] ? { id: blocks[0].id, offset: 0 } : null;
  let k = spans.findIndex((s) => pos < s.end || (pos === s.end));
  if (k < 0) k = spans.length - 1;
  const span = spans[k];
  const b = blocks.find((x) => x.id === span.id);
  if (!b) return null;
  if (pos <= span.start) return { id: b.id, offset: 0 };
  const lines = b.text.split('\n');
  let disp = 0;
  for (let j = 0; j < lines.length; j++) {
    const ls = span.lines[j] ?? span.start;
    const le = ls + lines[j].length;
    if (pos <= le || j === lines.length - 1) return { id: b.id, offset: disp + Math.max(0, Math.min(pos - ls, lines[j].length)) };
    disp += lines[j].length + 1;
  }
  return { id: b.id, offset: b.text.length };
}

// --- Édition --------------------------------------------------------------------------------

const touch = (b: SBlock, patch: Partial<SBlock> = {}): SBlock => ({ ...b, raw: undefined, lineOffsets: undefined, ...patch });

/** Le bloc et ses voisins sont réécrits : leur forme dépend du contexte (personnage suivi d'une réplique…). */
function touchAround(blocks: SBlock[], i: number): SBlock[] {
  return blocks.map((b, k) => (Math.abs(k - i) <= 1 && b.raw !== undefined ? touch(b) : b));
}

const indexOf = (doc: ScriptDoc, id: string) => doc.blocks.findIndex((b) => b.id === id);

export function setBlockText(doc: ScriptDoc, id: string, text: string): ScriptDoc {
  const i = indexOf(doc, id);
  if (i < 0 || doc.blocks[i].text === text) return doc;
  const blocks = doc.blocks.slice();
  blocks[i] = touch(blocks[i], { text });
  return { ...doc, blocks: blocks[i].text.trim() === '' || doc.blocks[i].text.trim() === '' ? touchAround(blocks, i) : blocks };
}

/** Texte d'un bloc converti vers un autre type (parenthèses ajoutées ou retirées, une seule ligne au besoin). */
export function convertText(text: string, from: BlockType, to: BlockType): string {
  let t = text;
  if (from === 'parenthetical' && to !== 'parenthetical') t = t.replace(/^\(\s*/, '').replace(/\s*\)$/, '');
  if (to === 'parenthetical' && from !== 'parenthetical') t = `(${oneLine(t).replace(/^\(+|\)+$/g, '')})`;
  if (to !== 'action' && to !== 'dialogue' && to !== 'title') t = t.replace(/\n+/g, ' ');
  return t;
}

export function setBlockType(doc: ScriptDoc, id: string, type: BlockType): { doc: ScriptDoc; text: string } {
  const i = indexOf(doc, id);
  if (i < 0) return { doc, text: '' };
  const b = doc.blocks[i];
  if (b.type === type) return { doc, text: b.text };
  const text = convertText(b.text, b.type, type);
  const blocks = doc.blocks.slice();
  blocks[i] = touch(b, { type, text });
  return { doc: { ...doc, blocks: touchAround(blocks, i) }, text };
}

/** Type du bloc créé par Entrée, selon le bloc quitté (usage des logiciels d'écriture). */
export function nextTypeOnEnter(t: BlockType): BlockType {
  switch (t) {
    case 'character':
    case 'parenthetical':
      return 'dialogue';
    // Après une réplique, un autre personnage parle le plus souvent (Entrée sur le nom vide : retour à l'action).
    case 'dialogue':
      return 'character';
    case 'transition':
      return 'heading';
    default:
      return 'action';
  }
}

/** Tab : le bloc courant change de type, dans un ordre fixe (Maj + Tab : en sens inverse). */
export function cycleType(t: BlockType, dir: 1 | -1 = 1): BlockType {
  if (t === 'dialogue' || t === 'parenthetical') return t === 'dialogue' ? 'parenthetical' : 'dialogue';
  const order: BlockType[] = ['action', 'character', 'transition', 'heading'];
  const i = order.indexOf(t);
  if (i < 0) return 'action';
  return order[(i + dir + order.length) % order.length];
}

/** Entrée : coupe le bloc au curseur ; le nouveau bloc prend le type qui suit d'usage. */
/**
 * Type reconnu à la validation d'une ligne d'action (Entrée en fin de ligne) : « INT. GARE - JOUR »
 * devient un en-tête, « NINA » un personnage, « FONDU AU NOIR : » une transition.
 */
export function smartType(text: string, type: BlockType): BlockType {
  const t = text.trim();
  // Une action, ou un nom de personnage proposé d'office après une réplique.
  if ((type !== 'action' && type !== 'character') || !t || t.includes('\n')) return type;
  if (HEADING_RE.test(t) && /^\S+[.\s]/.test(t)) return 'heading';
  const isCaps = /\p{L}/u.test(t) && t === upper(t);
  if (!isCaps || t.startsWith('!')) return type;
  if (TRANSITION_RE.test(t)) return 'transition';
  if (type === 'character') return type;
  // Nom en capitales (extension « (V.O.) » permise), sans ponctuation finale d'une phrase criée.
  const name = t.replace(/\s*\([^)]*\)\s*$/, '');
  if (name.length <= 38 && !/[.!?…:;,]$/.test(name) && /^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u.test(name)) return 'character';
  return type;
}

export function splitBlock(doc: ScriptDoc, c: Caret): Edit {
  const i = indexOf(doc, c.id);
  if (i < 0) return { doc, caret: c };
  let b = doc.blocks[i];
  // Entrée dans un bloc vide (hors action) : il redevient une action, comme dans les logiciels d'écriture.
  if (isEmptyBlock(b) && b.type !== 'action') {
    const { doc: d2 } = setBlockType(doc, b.id, 'action');
    return { doc: setBlockText(d2, b.id, ''), caret: { id: b.id, offset: 0 } };
  }
  // Entrée dans une action vide : rien (l'espacement des blocs est automatique).
  if (isEmptyBlock(b)) return { doc, caret: c };
  // Ligne validée : en-tête, personnage ou transition reconnus d'après le texte.
  if (c.offset >= b.text.length) {
    const st = smartType(b.text, b.type);
    if (st !== b.type) {
      const r = setBlockType(doc, b.id, st);
      doc = r.doc;
      b = doc.blocks[i];
      c = { id: b.id, offset: b.text.length };
    }
  }
  let before = b.text.slice(0, c.offset);
  let after = b.text.slice(c.offset);
  if (b.type === 'parenthetical') {
    // Entrée dans « (…) » : la parenthèse se ferme, la réplique suit.
    before = before.replace(/\)?\s*$/, '') + ')';
    after = after.replace(/^\s*\)?/, '');
  }
  const type = after.trim() && b.type !== 'character' && b.type !== 'parenthetical' ? b.type : nextTypeOnEnter(b.type);
  const created: SBlock = { id: nid(), type, text: type === 'parenthetical' ? `(${after})` : after.replace(/^\n+/, '') };
  const blocks = doc.blocks.slice();
  blocks[i] = touch(b, { text: before.replace(/\n+$/, '') });
  blocks.splice(i + 1, 0, created);
  return { doc: { ...doc, blocks: touchAround(blocks, i + 1) }, caret: { id: created.id, offset: type === 'parenthetical' ? 1 : 0 } };
}

/** Insère un bloc vide d'un type donné après le bloc courant. */
export function insertBlockAfter(doc: ScriptDoc, id: string, type: BlockType): Edit {
  const i = indexOf(doc, id);
  const created: SBlock = { id: nid(), type, text: type === 'parenthetical' ? '()' : '' };
  const blocks = doc.blocks.slice();
  blocks.splice(i + 1, 0, created);
  return { doc: { ...doc, blocks: touchAround(blocks, i + 1) }, caret: { id: created.id, offset: type === 'parenthetical' ? 1 : 0 } };
}

/** Retour arrière en début de bloc : le bloc rejoint le précédent. */
export function mergeWithPrevious(doc: ScriptDoc, id: string): Edit | null {
  const i = indexOf(doc, id);
  if (i <= 0) return null;
  const prev = doc.blocks[i - 1];
  const cur = doc.blocks[i];
  const blocks = doc.blocks.slice();
  // La page de titre ne se fond jamais dans le texte ; un saut de page, lui, s'efface.
  if (prev.type === 'title') return null;
  if (prev.type === 'pagebreak') {
    blocks.splice(i - 1, 1);
    return { doc: { ...doc, blocks: touchAround(blocks, i - 1) }, caret: { id: cur.id, offset: 0 } };
  }
  if (isEmptyBlock(cur)) {
    blocks.splice(i, 1);
    return { doc: { ...doc, blocks: touchAround(blocks, i - 1) }, caret: { id: prev.id, offset: prev.text.length } };
  }
  if (isEmptyBlock(prev)) {
    blocks.splice(i - 1, 1);
    return { doc: { ...doc, blocks: touchAround(blocks, i - 1) }, caret: { id: cur.id, offset: 0 } };
  }
  const head = prev.type === 'parenthetical' ? prev.text.replace(/\)\s*$/, '') : prev.text;
  const tail = convertText(cur.text, cur.type, prev.type === 'parenthetical' ? 'action' : prev.type);
  const glue = head && tail && !/\s$/.test(head) && !/^\s/.test(tail) && prev.type !== 'parenthetical' ? ' ' : '';
  const text = prev.type === 'parenthetical' ? `${head}${glue}${tail})` : head + glue + tail;
  blocks[i - 1] = touch(prev, { text });
  blocks.splice(i, 1);
  return { doc: { ...doc, blocks: touchAround(blocks, i - 1) }, caret: { id: prev.id, offset: head.length + glue.length } };
}

/** Suppr en fin de bloc : le bloc suivant rejoint celui-ci. */
export function mergeWithNext(doc: ScriptDoc, id: string): Edit | null {
  const i = indexOf(doc, id);
  if (i < 0 || i >= doc.blocks.length - 1) return null;
  return mergeWithPrevious(doc, doc.blocks[i + 1].id);
}

/** Remplace la plage [a, b) (a avant b) par un texte, éventuellement sur plusieurs blocs. */
export function replaceRange(doc: ScriptDoc, a: Caret, b: Caret, insert = ''): Edit {
  const ia = indexOf(doc, a.id);
  const ib = indexOf(doc, b.id);
  if (ia < 0 || ib < 0) return { doc, caret: a };
  const A = doc.blocks[ia];
  const B = doc.blocks[ib];
  const blocks = doc.blocks.slice();
  let tail = B.text.slice(b.offset);
  if (ib !== ia) {
    // Fin d'un autre bloc rattachée au premier : elle en prend la forme.
    if (B.type === 'parenthetical') tail = tail.replace(/\)\s*$/, '').replace(/^\(/, '');
    if (A.type === 'parenthetical') tail = tail.replace(/\)?\s*$/, ')');
    if (A.type !== 'action' && A.type !== 'dialogue' && A.type !== 'title') tail = tail.replace(/\n+/g, ' ');
  }
  const text = A.text.slice(0, a.offset) + insert + tail;
  blocks[ia] = touch(A, { text });
  if (ib > ia) blocks.splice(ia + 1, ib - ia);
  return { doc: { ...doc, blocks: touchAround(blocks, ia) }, caret: { id: A.id, offset: a.offset + insert.length } };
}

/** Colle du texte : sur une ligne, dans le bloc ; sur plusieurs, comme des blocs Fountain insérés au curseur. */
export function insertText(doc: ScriptDoc, at: Caret, text: string): Edit {
  const clean = text.replace(/\r\n?/g, '\n');
  if (!clean.includes('\n')) return replaceRange(doc, at, at, clean);
  const i = indexOf(doc, at.id);
  if (i < 0) return { doc, caret: at };
  const cur = doc.blocks[i];
  const pasted = blocksFromSource(clean.replace(/^\n+|\n+$/g, '')).blocks.map((b) => touch(b, { id: nid(), sep: undefined, orig: undefined }));
  if (!pasted.length) return { doc, caret: at };
  const before = cur.text.slice(0, at.offset);
  const after = cur.text.slice(at.offset);
  const blocks = doc.blocks.slice();
  const out: SBlock[] = [];
  if (before.trim()) out.push(touch(cur, { text: before.replace(/\s+$/, '') }));
  out.push(...pasted);
  const last = out[out.length - 1];
  const caret: Caret = { id: last.id, offset: last.text.length };
  if (after.trim()) out.push({ id: before.trim() ? nid() : cur.id, type: cur.type, text: after.replace(/^\s+/, '') });
  blocks.splice(i, 1, ...out);
  return { doc: { ...doc, blocks: touchAround(touchAround(blocks, i), i + out.length - 1) }, caret };
}

/** Texte brut d'une plage (copier) : les blocs complets deviennent du Fountain. */
export function rangeText(doc: ScriptDoc, a: Caret, b: Caret): string {
  const ia = indexOf(doc, a.id);
  const ib = indexOf(doc, b.id);
  if (ia < 0 || ib < 0) return '';
  if (ia === ib) return doc.blocks[ia].text.slice(a.offset, b.offset);
  const parts: SBlock[] = doc.blocks.slice(ia, ib + 1).map((x, k, all) => {
    let t = x.text;
    if (k === all.length - 1) t = t.slice(0, b.offset);
    if (k === 0) t = t.slice(a.offset);
    return { id: x.id, type: x.type, text: t };
  });
  return serialize({ blocks: parts, trail: '' }).source;
}

// --- Lecture ---------------------------------------------------------------------------------

/** Numéro de séquence de chaque en-tête, dans l'ordre. */
export function headingNumbers(blocks: readonly SBlock[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const b of blocks) if (b.type === 'heading' && !isEmptyBlock(b)) out.set(b.id, ++n);
  return out;
}

/** Noms de personnages déjà employés dans le scénario (pour l'autocomplétion). */
export function speakersOf(blocks: readonly SBlock[]): string[] {
  const seen = new Map<string, string>();
  for (const b of blocks) {
    if (b.type !== 'character') continue;
    const name = upper(b.text.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim());
    if (name && !seen.has(name)) seen.set(name, name);
  }
  return [...seen.values()];
}

/** Lieux déjà employés dans les en-têtes (« INT. GARE — HALL » → « GARE — HALL »). */
export function locationsOf(blocks: readonly SBlock[]): string[] {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type !== 'heading') continue;
    const loc = upper(b.text)
      .replace(/^(INT\.?\/EXT|I\/E|INT|EXT|EST)\.?\s*/i, '')
      .replace(/\s+[-–—]\s+[^-–—]*$/, '')
      .trim();
    if (loc) out.add(loc);
  }
  return [...out];
}

export const EFFECT_WORDS = ['JOUR', 'NUIT', 'AUBE', 'CRÉPUSCULE', 'MATIN', 'SOIR'] as const;
export const HEADING_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. '] as const;

export interface ScriptStats {
  scenes: number;
  words: number;
  dialogueWords: number;
  characters: Array<{ name: string; replies: number; words: number; scenes: number }>;
  intExt: Record<'INT' | 'EXT' | 'INT/EXT' | '—', number>;
  effects: Record<string, number>;
}

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Statistiques du scénario : séquences, mots, répliques par personnage, intérieurs et extérieurs. */
export function scriptStats(blocks: readonly SBlock[]): ScriptStats {
  const stats: ScriptStats = { scenes: 0, words: 0, dialogueWords: 0, characters: [], intExt: { INT: 0, EXT: 0, 'INT/EXT': 0, '—': 0 }, effects: {} };
  const chars = new Map<string, { name: string; replies: number; words: number; scenes: Set<number> }>();
  let speaker: string | null = null;
  for (const b of blocks) {
    if (isEmptyBlock(b)) continue;
    if (b.type !== 'title' && b.type !== 'note') stats.words += wordCount(b.text);
    if (b.type === 'heading') {
      stats.scenes++;
      const h = upper(b.text).trim();
      const ie = /^(INT\.?\/EXT|I\/E)/.test(h) ? 'INT/EXT' : /^INT/.test(h) ? 'INT' : /^EXT/.test(h) ? 'EXT' : '—';
      stats.intExt[ie]++;
      const eff = /\s[-–—]\s*([^-–—]+)$/.exec(h)?.[1]?.trim();
      if (eff) stats.effects[eff] = (stats.effects[eff] ?? 0) + 1;
      speaker = null;
      continue;
    }
    if (b.type === 'character') {
      speaker = upper(b.text.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim());
      const c = chars.get(speaker) ?? { name: speaker, replies: 0, words: 0, scenes: new Set<number>() };
      c.replies++;
      c.scenes.add(stats.scenes);
      chars.set(speaker, c);
      continue;
    }
    if (b.type === 'dialogue' && speaker) {
      const w = wordCount(b.text);
      stats.dialogueWords += w;
      chars.get(speaker)!.words += w;
      continue;
    }
    if (b.type !== 'parenthetical') speaker = null;
  }
  stats.characters = [...chars.values()].map((c) => ({ name: c.name, replies: c.replies, words: c.words, scenes: c.scenes.size })).sort((x, y) => y.words - x.words || y.replies - x.replies);
  return stats;
}

// --- Page de titre ------------------------------------------------------------------------------

/** Champs de la page de titre (clés Fountain) et leur intitulé. */
export const TITLE_FIELDS: ReadonlyArray<[string, string]> = [
  ['Title', 'Titre'],
  ['Credit', 'Crédit'],
  ['Author', 'Auteur'],
  ['Source', 'D’après'],
  ['Draft date', 'Date'],
  ['Contact', 'Contact'],
];
const TITLE_ALIASES: Record<string, string> = { titre: 'Title', title: 'Title', credit: 'Credit', crédit: 'Credit', author: 'Author', authors: 'Author', auteur: 'Author', auteurs: 'Author', source: 'Source', 'draft date': 'Draft date', date: 'Draft date', contact: 'Contact' };

/** Lit la page de titre : « Clé: valeur », les lignes suivantes sans clé prolongent la valeur. */
export function parseTitlePage(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = '';
  for (const raw of text.split('\n')) {
    const m = /^\s*([^:]{1,30}):\s*(.*)$/.exec(raw);
    if (m) {
      key = TITLE_ALIASES[m[1].trim().toLowerCase()] ?? m[1].trim();
      out[key] = m[2].trim();
    } else if (key && raw.trim()) out[key] = out[key] ? `${out[key]}\n${raw.trim()}` : raw.trim();
  }
  return out;
}

/** Écrit la page de titre (créée en tête au besoin, retirée si tout est vide). */
export function setTitlePage(doc: ScriptDoc, fields: Record<string, string>): ScriptDoc {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const parts = v.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!parts.length) continue;
    lines.push(`${k}: ${parts[0]}`, ...parts.slice(1).map((l) => `    ${l}`));
  }
  const i = doc.blocks.findIndex((b) => b.type === 'title');
  const blocks = doc.blocks.slice();
  if (!lines.length) {
    if (i < 0) return doc;
    blocks.splice(i, 1);
    return { ...doc, blocks: touchAround(blocks, Math.max(0, i - 1)) };
  }
  const text = lines.join('\n');
  if (i >= 0) {
    if (blocks[i].text === text) return doc;
    blocks[i] = touch(blocks[i], { text });
    return { ...doc, blocks: touchAround(blocks, i) };
  }
  blocks.unshift({ id: nid(), type: 'title', text });
  return { ...doc, blocks: touchAround(blocks, 0) };
}
