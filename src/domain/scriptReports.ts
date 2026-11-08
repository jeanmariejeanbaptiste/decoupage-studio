/**
 * Rapports du scénario (personnages, décors, présence), tirés du texte : répliques, séquences
 * parlantes et muettes, première apparition, répliques d'un rôle (« sides »), durée cumulée d'un décor.
 * Durée : une page (58 lignes) par minute, comme le chronomètre de l'éditeur.
 */
import { isEmptyBlock, type SBlock } from './screenplay';
import { blankLinesBefore, blockLines, NOT_PRINTED, SCRIPT_PAGE } from './scriptLayout';
import { fold } from './text';

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
  durationSec: number;
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
export function sceneReports(blocks: readonly SBlock[], knownNames: readonly string[] = []): SceneInfo[] {
  const scenes: SceneInfo[] = [];
  const speakers = new Set<string>(knownNames.map(upper));
  for (const b of blocks) if (b.type === 'character' && !isEmptyBlock(b)) speakers.add(speakerName(b.text));
  // Noms cherchés dans l'action : du plus long au plus court (« LA MÈRE » avant « MÈRE »).
  const names = [...speakers].filter(Boolean).sort((a, b) => b.length - a.length);
  let cur: SceneInfo | null = null;
  let speaker: string | null = null;
  let prev: SBlock['type'] | undefined;
  let lines = 0;
  const close = () => {
    if (cur) cur.durationSec = Math.round((lines / SCRIPT_PAGE.lines) * 60);
  };
  for (const b of blocks) {
    if (isEmptyBlock(b) || b.type === 'title' || NOT_PRINTED.has(b.type)) continue;
    if (b.type === 'heading') {
      close();
      const p = parseHeading(b.text);
      cur = { n: scenes.length + 1, id: b.id, heading: upper(b.text).trim(), ...p, durationSec: 0, replies: new Map(), present: new Set() };
      scenes.push(cur);
      speaker = null;
      lines = 0;
      prev = undefined;
    }
    lines += blockLines(b).length + (prev ? blankLinesBefore(prev, b.type) : 0);
    prev = b.type;
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
export function sidesOf(blocks: readonly SBlock[], name: string): Array<{ n: number; heading: string; lines: Array<{ paren?: string; text: string }> }> {
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
