/**
 * Analyse légère de la syntaxe Fountain (§13) : en-têtes de séquence, personnages, dialogues,
 * parenthèses, transitions, actions. Chaque élément garde sa position dans le texte source.
 */
import { addCharacter, addSequence } from './ops';
import { setSequenceDecorByName } from './registry';
import { fold } from './text';
import { diffRange, offsetMapper, shiftOffset } from './textDiff';
import type { Effect, ID, IntExt, ProjectDoc } from './types';

export { diffRange, shiftOffset };

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
  | 'note'
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

/** En-tête de séquence : INT. / EXT. / INT./EXT. / EXT./INT. / I/E, éventuellement précédé de son numéro (« 12. INT. … »). */
export const HEADING_RE = /^(?:\d+[A-Z]?[.)-]?\s+)?(int\.?\s*\/\s*ext|ext\.?\s*\/\s*int|i\/e|int|ext|est)(?:[.\s\-–—]|$)/i;
/** Transitions usuelles, en français comme en anglais (« COUPE FRANCHE : », « FONDU AU NOIR. », « CUT TO: »). */
export const TRANSITION_RE = /(TO\s?:|FONDU (AU NOIR|ENCHAÎNÉ|AU BLANC)|CUT TO|COUPE FRANCHE|ENCHAÎNÉ)\s?:?\.?$/;
const isUpper = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase('fr');
const NOTE_LINE = /^\s*\[\[([^\]]*)\]\]\s*$/;

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
  const original = splitLines(source);
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
      // Note seule sur sa ligne (« [[…]] ») : gardée comme élément, hors du minutage et des séquences.
      const note = NOTE_LINE.exec(original[i]?.text ?? '');
      if (note) {
        const at = original[i].start + original[i].text.indexOf('[[') + 2;
        els.push({ type: 'note', text: note[1], start: at, end: at + note[1].length });
      }
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
    if (t.startsWith('>') || (prevBlank && isUpper(t) && TRANSITION_RE.test(t) && (lines[i + 1]?.text.trim() ?? '') === '')) {
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
  ['AUBE', ['aube', 'dawn', 'petit matin', 'lever du jour']],
  ['CRÉPUSCULE', ['crepuscule', 'dusk', 'soir', 'soiree', 'sunset', 'fin de journee', 'tombee de la nuit']],
  ['JOUR', ['jour', 'day', 'matin', 'apres-midi', 'midi']],
  ['NUIT', ['nuit', 'night']],
];

export function parseHeading(heading: string): { intExt?: IntExt; location: string; effect?: Effect } {
  // Numéro de séquence en tête (« 12. », « 12A ») et numéro Fountain en fin (« #12# ») : ignorés.
  let h = heading.trim().replace(/^\d+[A-Z]?[.)-]?\s+/, '').replace(/\s*#[^#]+#\s*$/, '');
  let intExt: IntExt | undefined;
  const m = /^(int\.?\s*\/\s*ext\.?|ext\.?\s*\/\s*int\.?|i\/e\.?|int\.?|ext\.?|est\.?)\s*/i.exec(h);
  if (m) {
    const k = m[1].toLowerCase().replace(/\s+/g, '');
    intExt = k.includes('/') ? 'INT/EXT' : k.startsWith('int') ? 'INT' : 'EXT';
    // Séparateur après le préfixe : « INT - CUISINE », « INT. — CUISINE ».
    h = h.slice(m[0].length).replace(/^[-–—.:]\s*/, '');
  }
  let effect: Effect | undefined;
  // Effet en fin d'en-tête, après un tiret ou un point : « CUISINE - JOUR », « CUISINE. NUIT ».
  const seps = [...h.matchAll(/\s*[-–—]\s+|\s+[-–—]\s*|\.\s+/g)];
  const last = seps.at(-1);
  if (last && last.index !== undefined) {
    const tail = fold(h.slice(last.index + last[0].length)).replace(/[.\s]+$/, '');
    const found = EFFECTS.find(([, words]) => words.some((w) => tail === w || tail.startsWith(`${w} `) || tail.startsWith(`${w}/`)));
    if (found) {
      effect = found[0];
      h = h.slice(0, last.index);
    }
  }
  return { intExt, location: h.trim().replace(/[.\s]+$/, ''), effect };
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
/**
 * Séquence du découpage qui correspond à une scène : même lieu, et déjà liée à cette scène précise ;
 * sinon une séquence du même lieu qui n'est encore liée à aucune scène. Deux scènes
 * successives au même lieu (« OPEN SPACE » trois fois) donnent ainsi trois séquences distinctes.
 */
export function matchSequence(doc: ProjectDoc, scene: Pick<Scene, 'location'> & Partial<Pick<Scene, 'start' | 'end'>>): ID | undefined {
  const key = fold(scene.location);
  const ids = doc.project.sequenceIds;
  if (scene.start === undefined || scene.end === undefined) return ids.find((id) => fold(doc.sequences[id]?.label ?? '') === key);
  const { start, end } = scene;
  const inScene = (a?: { start: number; end: number }) => !!a && a.start >= start && a.start < end;
  const same = (id: ID) => fold(doc.sequences[id]?.label ?? '') === key;
  // La séquence ancrée dans cette scène, même renommée ; sinon une séquence du même lieu encore libre.
  return ids.find((id) => inScene(doc.sequences[id]?.scenarioAnchor)) ?? ids.find((id) => same(id) && !doc.sequences[id]?.scenarioAnchor);
}

/**
 * Le scénario est indicatif : il ne modifie jamais les séquences existantes.
 * Sur demande seulement, crée les séquences absentes du découpage (à la fin) et les personnages parlants.
 */
export function importScenes(doc: ProjectDoc, source: string): { sequences: number; characters: number } {
  doc.scenario = source;
  let createdSeq = 0;
  let createdChars = 0;
  let rank = 0;
  for (const sc of scenesOf(source)) {
    let seqId = matchSequence(doc, sc);
    if (seqId) rank = Math.max(rank, doc.project.sequenceIds.indexOf(seqId) + 1);
    if (!seqId) {
      // À sa place : après la séquence de la scène précédente.
      seqId = addSequence(doc, rank, {}, false);
      rank = doc.project.sequenceIds.indexOf(seqId) + 1;
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

/** Recale les ancres des actions et des séquences après une modification du scénario. */
export function shiftAnchors(doc: ProjectDoc, before: string, after: string): void {
  if (before === after) return;
  const map = offsetMapper(before, after);
  const move = (r: { start: number; end: number }) => {
    const empty = r.end <= r.start;
    r.start = map(r.start, 'start');
    r.end = empty ? r.start : Math.max(r.start, map(r.end, 'end'));
  };
  for (const b of Object.values(doc.blocks)) if (b.scenarioAnchor) move(b.scenarioAnchor);
  for (const s of Object.values(doc.sequences)) if (s.scenarioAnchor) move(s.scenarioAnchor);
}

/** Fins de ligne Windows / anciens Mac et marque d'ordre d'octets retirées, ancres recalées au caractère près. */
export function normalizeScenario(doc: ProjectDoc): void {
  const src = doc.scenario;
  if (!src || !/\r|\uFEFF/.test(src)) return;
  const removed: number[] = [];
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\uFEFF' || (c === '\r' && src[i + 1] === '\n')) {
      removed.push(i);
      continue;
    }
    out += c === '\r' ? '\n' : c;
  }
  const map = (p: number) => {
    let lo = 0;
    let hi = removed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (removed[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    return p - lo;
  };
  for (const b of Object.values(doc.blocks)) if (b.scenarioAnchor) b.scenarioAnchor = { start: map(b.scenarioAnchor.start), end: map(b.scenarioAnchor.end) };
  for (const q of Object.values(doc.sequences)) if (q.scenarioAnchor) q.scenarioAnchor = { start: map(q.scenarioAnchor.start), end: map(q.scenarioAnchor.end) };
  doc.scenario = out;
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
