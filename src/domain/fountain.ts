/**
 * Analyse légère de la syntaxe Fountain (§13) : en-têtes de séquence, personnages, dialogues,
 * parenthèses, transitions, actions. Chaque élément garde sa position dans le texte source.
 */
import { addCharacter, addSequence } from './ops';
import { setSequenceDecorByName } from './registry';
import { fold } from './text';
import type { Effect, ID, IntExt, ProjectDoc } from './types';

export type ElementType =
  | 'heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'centered'
  | 'section'
  | 'synopsis'
  | 'pagebreak'
  | 'title';

export interface ScriptElement {
  type: ElementType;
  /** Texte affiché (sans marqueur de forçage). */
  text: string;
  /** Position du texte affiché dans la source. */
  start: number;
  end: number;
  /** Personnage qui parle (dialogue, parenthèse). */
  speaker?: string;
}

export interface Scene {
  index: number;
  heading: string;
  start: number;
  end: number;
  intExt?: IntExt;
  location: string;
  effect?: Effect;
  speakers: string[];
  elements: ScriptElement[];
}

const HEADING_RE = /^(int\.?\/ext|i\/e|int|ext|est)[.\s]/i;
const isUpper = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase('fr');

interface Line {
  text: string;
  start: number;
}

function splitLines(src: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of src.split('\n')) {
    out.push({ text: raw.replace(/\r$/, ''), start: pos });
    pos += raw.length + 1;
  }
  return out;
}

/** Retire les zones de commentaire `/* … *\/` en conservant les positions (remplacées par des espaces). */
function blankBoneyard(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\[\[[\s\S]*?\]\]/g, (m) => m.replace(/[^\n]/g, ' '));
}

export function parseFountain(source: string): ScriptElement[] {
  const src = blankBoneyard(source);
  const lines = splitLines(src);
  const els: ScriptElement[] = [];
  let i = 0;
  // Page de titre : « Clé: valeur » en tête de fichier.
  if (/^[A-Za-zÀ-ÿ ]+:\s?/.test(lines[0]?.text ?? '') && !HEADING_RE.test(lines[0].text)) {
    while (i < lines.length && lines[i].text.trim() !== '') {
      const l = lines[i];
      els.push({ type: 'title', text: l.text.trim(), start: l.start, end: l.start + l.text.length });
      i++;
    }
  }
  let speaker: string | undefined;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text.trim();
    const lead = l.text.length - l.text.trimStart().length;
    const s0 = l.start + lead;
    const prevBlank = i === 0 || lines[i - 1].text.trim() === '';
    const nextLine = lines[i + 1]?.text.trim() ?? '';
    const push = (type: ElementType, text: string, offset = 0, extra: Partial<ScriptElement> = {}) =>
      els.push({ type, text, start: s0 + offset, end: s0 + offset + text.length, ...extra });

    if (t === '') {
      speaker = undefined;
      continue;
    }
    if (speaker) {
      if (/^\(.*\)$/.test(t)) push('parenthetical', t, 0, { speaker });
      else push('dialogue', t, 0, { speaker });
      continue;
    }
    if (/^={3,}$/.test(t)) {
      push('pagebreak', t);
      continue;
    }
    if (t.startsWith('#')) {
      const m = /^#+\s*/.exec(t)![0];
      push('section', t.slice(m.length), m.length);
      continue;
    }
    if (t.startsWith('=')) {
      push('synopsis', t.replace(/^=\s*/, ''), t.length - t.replace(/^=\s*/, '').length);
      continue;
    }
    if (t.startsWith('>') && t.endsWith('<')) {
      push('centered', t.slice(1, -1).trim(), 1 + (t.slice(1).length - t.slice(1).trimStart().length));
      continue;
    }
    if ((t.startsWith('.') && !t.startsWith('..')) || (prevBlank && HEADING_RE.test(t))) {
      const forced = t.startsWith('.') ? 1 : 0;
      push('heading', t.slice(forced).replace(/\s*#[^#]+#\s*$/, ''), forced);
      continue;
    }
    if (t.startsWith('>') || (prevBlank && isUpper(t) && /(TO:|FONDU (AU NOIR|ENCHAÎNÉ)|CUT TO|COUPE FRANCHE)\.?$/.test(t) && lines[i + 1]?.text.trim() === '')) {
      const forced = t.startsWith('>') ? 1 : 0;
      push('transition', t.slice(forced).trim(), forced);
      continue;
    }
    if (t.startsWith('@') || (prevBlank && nextLine !== '' && isUpper(t.replace(/\(.*\)/g, '').replace(/\^$/, '')) && !t.startsWith('!'))) {
      const forced = t.startsWith('@') ? 1 : 0;
      const name = t.slice(forced).trim();
      speaker = characterName(name);
      push('character', name, forced);
      continue;
    }
    const forced = t.startsWith('!') ? 1 : 0;
    push('action', t.slice(forced), forced);
  }
  return els;
}

/** « LÉA (V.O.) » → « LÉA ». */
export function characterName(cue: string): string {
  return cue.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim();
}

/** « LÉA » → « Léa », « JEAN-PIERRE » → « Jean-Pierre ». */
export function displayName(name: string): string {
  return name
    .toLocaleLowerCase('fr')
    .replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toLocaleUpperCase('fr'));
}

const EFFECTS: Array<[Effect, string[]]> = [
  ['JOUR', ['jour', 'day', 'matin', 'apres-midi', 'midi']],
  ['NUIT', ['nuit', 'night']],
  ['AUBE', ['aube', 'dawn', 'petit matin']],
  ['CRÉPUSCULE', ['crepuscule', 'dusk', 'soir', 'soiree', 'sunset']],
];

export function parseHeading(heading: string): { intExt?: IntExt; location: string; effect?: Effect } {
  let h = heading.trim();
  let intExt: IntExt | undefined;
  const m = /^(int\.?\/ext\.?|i\/e\.?|int\.?|ext\.?|est\.?)\s*/i.exec(h);
  if (m) {
    const k = m[1].toLowerCase();
    intExt = k.startsWith('int') && k.includes('ext') ? 'INT/EXT' : k.startsWith('i/e') ? 'INT/EXT' : k.startsWith('int') ? 'INT' : 'EXT';
    h = h.slice(m[0].length);
  }
  let effect: Effect | undefined;
  const seps = [...h.matchAll(/\s+[-–—]\s+/g)];
  const last = seps.at(-1);
  if (last && last.index !== undefined) {
    const tail = fold(h.slice(last.index + last[0].length));
    const found = EFFECTS.find(([, words]) => words.some((w) => tail === w || tail.startsWith(`${w} `)));
    if (found) {
      effect = found[0];
      h = h.slice(0, last.index);
    }
  }
  return { intExt, location: h.trim(), effect };
}

/** Découpe le scénario en séquences (une par en-tête). */
export function scenesOf(source: string, elements = parseFountain(source)): Scene[] {
  const scenes: Scene[] = [];
  for (const el of elements) {
    if (el.type === 'heading') {
      const h = parseHeading(el.text);
      scenes.push({ index: scenes.length, heading: el.text, start: el.start, end: source.length, ...h, speakers: [], elements: [el] });
      if (scenes.length > 1) scenes[scenes.length - 2].end = el.start;
    } else if (scenes.length) {
      const sc = scenes[scenes.length - 1];
      sc.elements.push(el);
      if (el.type === 'character') {
        const n = characterName(el.text);
        if (!sc.speakers.includes(n)) sc.speakers.push(n);
      }
    }
  }
  return scenes;
}

export function sceneAt(scenes: readonly Scene[], offset: number): Scene | undefined {
  return scenes.find((s) => offset >= s.start && offset < s.end) ?? (offset >= (scenes.at(-1)?.end ?? Infinity) ? scenes.at(-1) : undefined);
}

/**
 * Synchronise le projet avec le scénario : chaque en-tête crée ou met à jour la séquence de même rang
 * (libellé = lieu, INT/EXT, effet, décor), chaque personnage parlant obtient une fiche.
 * Renvoie le nombre de séquences créées et de personnages créés.
 */
/** Séquence du découpage dont le libellé correspond au lieu de la scène (sans accents ni casse). */
export function matchSequence(doc: ProjectDoc, scene: Pick<Scene, 'location'>): ID | undefined {
  const key = fold(scene.location);
  return doc.project.sequenceIds.find((id) => fold(doc.sequences[id]?.label ?? '') === key);
}

/**
 * Le scénario est indicatif : il ne modifie jamais les séquences existantes.
 * Sur demande seulement, crée les séquences absentes du découpage (à la fin) et les personnages parlants.
 */
export function importScenes(doc: ProjectDoc, source: string): { sequences: number; characters: number } {
  doc.scenario = source;
  let createdSeq = 0;
  let createdChars = 0;
  for (const sc of scenesOf(source)) {
    let seqId = matchSequence(doc, sc);
    if (!seqId) {
      seqId = addSequence(doc, undefined, {}, false);
      const seq = doc.sequences[seqId];
      seq.label = sc.location.toUpperCase();
      seq.intExt = sc.intExt ?? seq.intExt;
      seq.effect = sc.effect ?? seq.effect;
      setSequenceDecorByName(doc, seqId, sc.location);
      createdSeq++;
    }
    doc.sequences[seqId].scenarioAnchor = { start: sc.start, end: sc.end };
    for (const sp of sc.speakers) {
      const name = displayName(sp);
      const exists = Object.values(doc.characters).some((c) => [c.name, ...(c.aliases ?? [])].some((n) => fold(n) === fold(name)));
      if (!exists) {
        addCharacter(doc, { name, kind: 'secondaire' });
        createdChars++;
      }
    }
  }
  return { sequences: createdSeq, characters: createdChars };
}

/**
 * Sépare une sélection du scénario en action et répliques (« NOM : réplique »).
 */
export function splitSelection(elements: readonly ScriptElement[], start: number, end: number): { action: string; dialogue: string; speakers: string[] } {
  const action: string[] = [];
  const dialogue: string[] = [];
  const speakers: string[] = [];
  for (const el of elements) {
    if (el.end <= start || el.start >= end) continue;
    const a = Math.max(start, el.start) - el.start;
    const b = Math.min(end, el.end) - el.start;
    const part = el.text.slice(a, b).trim();
    if (!part) continue;
    if (el.type === 'dialogue' && el.speaker) {
      const name = displayName(el.speaker);
      dialogue.push(`${name.toLocaleUpperCase('fr')} : ${part}`);
      if (!speakers.includes(name)) speakers.push(name);
    } else if (el.type === 'action' || el.type === 'centered') action.push(part);
  }
  return { action: action.join(' '), dialogue: dialogue.join(' '), speakers };
}

/** Décale une position après une modification [at, at + removed) → inserted caractères. */
export function shiftOffset(pos: number, at: number, removed: number, inserted: number): number {
  if (pos <= at) return pos;
  if (pos >= at + removed) return pos + inserted - removed;
  return at + inserted;
}

/** Repère la zone modifiée entre deux versions d'un texte (préfixe et suffixe communs). */
export function diffRange(a: string, b: string): { at: number; removed: number; inserted: number } {
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { at: p, removed: a.length - p - s, inserted: b.length - p - s };
}

/** Recale les ancres des actions et des séquences après une modification du scénario. */
export function shiftAnchors(doc: ProjectDoc, before: string, after: string): void {
  if (before === after) return;
  const { at, removed, inserted } = diffRange(before, after);
  const move = (r: { start: number; end: number }) => {
    r.start = shiftOffset(r.start, at, removed, inserted);
    r.end = Math.max(r.start, shiftOffset(r.end, at, removed, inserted));
  };
  for (const b of Object.values(doc.blocks)) if (b.scenarioAnchor) move(b.scenarioAnchor);
  for (const s of Object.values(doc.sequences)) if (s.scenarioAnchor) move(s.scenarioAnchor);
}

/**
 * Découpe une cellule « dialogue » en répliques : « LÉA : Encore une roue. MARC : Viens. »
 * Le nom de l'orateur précède les deux-points ; sans nom, la réplique reste anonyme.
 */
export function parseDialogue(text: string): Array<{ speaker?: string; line: string }> {
  const re = /(?:^|\s)([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þa-zà-öø-ÿ'’ -]{0,30}?)\s?:\s/g;
  const marks: Array<{ name: string; at: number; end: number }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) marks.push({ name: m[1].trim(), at: m.index, end: re.lastIndex });
  if (!marks.length) return text.trim() ? [{ line: text.trim() }] : [];
  const out: Array<{ speaker?: string; line: string }> = [];
  const lead = text.slice(0, marks[0].at).trim();
  if (lead) out.push({ line: lead });
  marks.forEach((m, i) => {
    const line = text.slice(m.end, marks[i + 1]?.at ?? text.length).trim();
    if (line) out.push({ speaker: m.name, line });
  });
  return out;
}
