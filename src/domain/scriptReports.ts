/**
 * Rapports du scénario (personnages, décors, présence), tirés du texte : répliques, séquences
 * parlantes et muettes, première apparition, répliques d'un rôle (« sides »), durée cumulée d'un décor.
 * Durée : selon la méthode de minutage du projet (par défaut une page de 58 lignes par minute).
 */
import { isEmptyBlock, type SBlock } from './screenplay';
import { chronoOf, chronoTimeline, stripMarks, type ScriptChrono } from './chronometry';
import { NOT_PRINTED } from './scriptLayout';
import { fold } from './text';
import type { ProjectDoc } from './types';
import { shiftCommentAnchors } from './comments';

const upper = (s: string) => s.toLocaleUpperCase('fr');
/** Nom d'un personnage tel qu'au-dessus de sa réplique, sans extension « (OFF) » ni « ^ ». */
export const speakerName = (text: string) => upper(text.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim());

export interface SceneInfo {
  /** Numéro de séquence (1, 2…). */
  n: number;
  /** Bloc d'en-tête (pour y aller dans l'éditeur). */
  id: string;
  heading: string;
  /** Lieu (« GARE — HALL »), sans INT/EXT ni effet. */
  location: string;
  intExt: string;
  effect: string;
  /** Durée en secondes, non arrondie (l'affichage arrondit). */
  durationSec: number;
  /** Part de l'action et des dialogues dans la durée (secondes). */
  actionSec: number;
  dialogueSec: number;
  /** Répliques par personnage. */
  replies: Map<string, number>;
  /** Personnages présents : ceux qui parlent, et ceux nommés dans l'action. */
  present: Set<string>;
}

/** Découpe d'un en-tête : « INT. GARE — HALL - JOUR » → INT, GARE — HALL, JOUR (tirets « - », « – », « — »). */
export function parseHeading(text: string): { intExt: string; location: string; effect: string } {
  const h = upper(text).trim();
  const ie = /^(INT\.?\/EXT|I\/E)/.test(h) ? 'INT/EXT' : /^INT/.test(h) ? 'INT' : /^EXT/.test(h) ? 'EXT' : '';
  const rest = h.replace(/^(INT\.?\/EXT|I\/E|INT|EXT|EST)\.?\s*/, '');
  const m = /^(.*?)\s+[-–—]\s+([^-–—]+)$/.exec(rest);
  return { intExt: ie, location: (m ? m[1] : rest).trim(), effect: (m ? m[2] : '').trim() };
}

/** Séquences du scénario, avec durée, répliques et présence des personnages. */
export function sceneReports(source: readonly SBlock[], knownNames: readonly string[] = [], chrono?: Partial<ScriptChrono>): SceneInfo[] {
  const blocks = printed(source);
  // Même minutage que la barre du scénario (impression, secondes non arrondies) : les sommes concordent.
  const { secs } = chronoTimeline(source, chronoOf(chrono));
  const scenes: SceneInfo[] = [];
  const speakers = new Set<string>(knownNames.map(upper));
  for (const b of blocks) if (b.type === 'character' && !isEmptyBlock(b)) speakers.add(speakerName(b.text));
  // Noms cherchés dans l'action : du plus long au plus court (« LA MÈRE » avant « MÈRE »).
  const names = [...speakers].filter(Boolean).sort((a, b) => b.length - a.length);
  let cur: SceneInfo | null = null;
  let speaker: string | null = null;
  let total = 0;
  let action = 0;
  let dialogue = 0;
  const close = () => {
    if (!cur) return;
    cur.durationSec = total;
    cur.actionSec = action;
    cur.dialogueSec = dialogue;
  };
  for (const [i, b] of blocks.entries()) {
    if (isEmptyBlock(b) || b.type === 'title' || NOT_PRINTED.has(b.type)) continue;
    if (b.type === 'heading') {
      close();
      const p = parseHeading(b.text);
      cur = { n: scenes.length + 1, id: b.id, heading: upper(b.text).trim(), ...p, durationSec: 0, actionSec: 0, dialogueSec: 0, replies: new Map(), present: new Set() };
      scenes.push(cur);
      speaker = null;
      total = 0;
      action = 0;
      dialogue = 0;
    }
    total += secs[i];
    if (b.type === 'action') action += secs[i];
    if (b.type === 'dialogue' || b.type === 'parenthetical' || b.type === 'character') dialogue += secs[i];
    if (!cur || b.type === 'heading') continue;
    if (b.type === 'character') {
      speaker = speakerName(b.text);
      cur.replies.set(speaker, (cur.replies.get(speaker) ?? 0) + 1);
      cur.present.add(speaker);
      continue;
    }
    if (b.type === 'action') {
      const text = ` ${fold(b.text)} `;
      for (const n of names) if (new RegExp(`[^\\p{L}]${escapeRe(fold(n))}[^\\p{L}]`, 'u').test(text)) cur.present.add(n);
    }
    if (b.type !== 'dialogue' && b.type !== 'parenthetical') speaker = null;
  }
  close();
  return scenes;
}

/** Blocs tels qu'imprimés : sans marques d'emphase ni de surlignage. */
const printed = (blocks: readonly SBlock[]): readonly SBlock[] => blocks.map((b) => (/[*_[]/.test(b.text) ? { ...b, text: stripMarks(b.text) } : b));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface CharacterReport {
  name: string;
  replies: number;
  speaking: number;
  silent: number;
  total: number;
  /** Première séquence où il apparaît. */
  first: number;
}

/** Rapport des personnages : répliques, séquences parlantes et muettes, première apparition. */
export function characterReports(scenes: readonly SceneInfo[]): CharacterReport[] {
  const map = new Map<string, CharacterReport>();
  for (const sc of scenes)
    for (const name of sc.present) {
      const r = map.get(name) ?? { name, replies: 0, speaking: 0, silent: 0, total: 0, first: sc.n };
      const n = sc.replies.get(name) ?? 0;
      r.replies += n;
      r.total++;
      if (n) r.speaking++;
      else r.silent++;
      map.set(name, r);
    }
  return [...map.values()].sort((a, b) => a.first - b.first || b.replies - a.replies);
}

export interface LocationReport {
  location: string;
  intExt: string[];
  effects: string[];
  scenes: number[];
  durationSec: number;
}

/** Rapport des décors : séquences regroupées par lieu, durée cumulée. */
export function locationReports(scenes: readonly SceneInfo[]): LocationReport[] {
  const map = new Map<string, LocationReport>();
  for (const sc of scenes) {
    const key = fold(sc.location);
    const r = map.get(key) ?? { location: sc.location, intExt: [], effects: [], scenes: [], durationSec: 0 };
    if (sc.intExt && !r.intExt.includes(sc.intExt)) r.intExt.push(sc.intExt);
    if (sc.effect && !r.effects.includes(sc.effect)) r.effects.push(sc.effect);
    r.scenes.push(sc.n);
    r.durationSec += sc.durationSec;
    map.set(key, r);
  }
  return [...map.values()];
}

/** Répliques d'un rôle, séquence par séquence (à remettre au comédien). */
export function sidesOf(source: readonly SBlock[], name: string): Array<{ n: number; heading: string; lines: Array<{ paren?: string; text: string }> }> {
  const blocks = printed(source);
  const out: Array<{ n: number; heading: string; lines: Array<{ paren?: string; text: string }> }> = [];
  let n = 0;
  let heading = '';
  let mine = false;
  let paren: string | undefined;
  for (const b of blocks) {
    if (isEmptyBlock(b)) continue;
    if (b.type === 'heading') {
      n++;
      heading = upper(b.text).trim();
      mine = false;
      continue;
    }
    if (b.type === 'character') {
      mine = speakerName(b.text) === name;
      paren = undefined;
      continue;
    }
    if (mine && b.type === 'parenthetical') {
      paren = b.text.trim();
      continue;
    }
    if (mine && b.type === 'dialogue') {
      let sc = out[out.length - 1];
      if (!sc || sc.n !== n) out.push((sc = { n, heading, lines: [] }));
      sc.lines.push({ paren, text: b.text });
      paren = undefined;
      continue;
    }
    mine = false;
  }
  return out;
}

// --- Renommer un personnage ou un décor dans tout le projet ---------------------------------------

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Même casse que le mot remplacé : CAPITALES, Capitale initiale, ou tel quel. */
function sameCase(found: string, next: string): string {
  if (found === found.toLocaleUpperCase('fr') && /\p{L}/u.test(found)) return next.toLocaleUpperCase('fr');
  if (found[0] === found[0].toLocaleUpperCase('fr')) return next.charAt(0).toLocaleUpperCase('fr') + next.slice(1);
  return next;
}

/**
 * Remplace un nom, mot entier et sans tenir compte de la casse (la casse de chaque occurrence est gardée),
 * dans les lignes retenues par `inLine`. Renvoie le texte et de quoi recaler une position.
 */
export function replaceName(source: string, from: string, to: string, inLine: (line: string) => boolean = () => true): { text: string; shift: (pos: number) => number } {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(from)}(?![\\p{L}\\p{N}])`, 'giu');
  const edits: Array<{ at: number; len: number; by: string }> = [];
  let pos = 0;
  for (const line of source.split('\n')) {
    if (inLine(line)) for (const m of line.matchAll(re)) edits.push({ at: pos + m.index!, len: m[0].length, by: sameCase(m[0], to) });
    pos += line.length + 1;
  }
  let text = '';
  let last = 0;
  for (const e of edits) {
    text += source.slice(last, e.at) + e.by;
    last = e.at + e.len;
  }
  text += source.slice(last);
  const shift = (p: number) => {
    let d = 0;
    for (const e of edits) {
      if (e.at >= p) break;
      d += e.by.length - e.len;
    }
    return p + d;
  };
  return { text, shift };
}

/** Lignes d'en-tête de séquence (où vit le nom d'un décor). */
export const isHeadingLine = (line: string) => /^\s*(?:\.(?!\.)|(?:INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s])/i.test(line);

/** Recale les passages du découpage liés au scénario après une modification du texte. */
function shiftAnchors(doc: ProjectDoc, shift: (p: number) => number): void {
  for (const o of [...Object.values(doc.blocks), ...Object.values(doc.sequences)]) {
    const a = o.scenarioAnchor;
    if (a) o.scenarioAnchor = { start: shift(a.start), end: shift(a.end) };
  }
  shiftCommentAnchors(doc, (p) => shift(p));
}

/** Renomme un personnage partout : scénario (répliques et mentions), fiche, plans et actions du découpage. */
export function renameCharacter(doc: ProjectDoc, from: string, to: string): void {
  const next = to.trim();
  if (!next || fold(next) === fold(from)) return;
  if (doc.scenario) {
    const r = replaceName(doc.scenario, from, next, (l) => !isHeadingLine(l));
    doc.scenario = r.text;
    shiftAnchors(doc, r.shift);
  }
  for (const c of Object.values(doc.characters)) {
    if (fold(c.name) === fold(from)) c.name = sameCase(c.name, next);
    if (c.aliases) c.aliases = c.aliases.map((a) => (fold(a) === fold(from) ? next : a));
  }
  for (const sh of Object.values(doc.shots)) if (sh.subject) sh.subject = replaceName(sh.subject, from, next).text;
  for (const b of Object.values(doc.blocks)) {
    if (b.text) b.text = replaceName(b.text, from, next).text;
    if (b.dialogue) b.dialogue = replaceName(b.dialogue, from, next).text;
  }
}

/** Renomme un décor partout : en-têtes du scénario, fiche du décor, libellés des séquences. */
export function renameDecor(doc: ProjectDoc, from: string, to: string): void {
  const next = to.trim();
  if (!next || fold(next) === fold(from)) return;
  if (doc.scenario) {
    const r = replaceName(doc.scenario, from, next, isHeadingLine);
    doc.scenario = r.text;
    shiftAnchors(doc, r.shift);
  }
  for (const d of Object.values(doc.decors)) if (fold(d.name) === fold(from)) d.name = sameCase(d.name, next);
  for (const q of Object.values(doc.sequences)) if (q.label) q.label = replaceName(q.label, from, next).text;
}
