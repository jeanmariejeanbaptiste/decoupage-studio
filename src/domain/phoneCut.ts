/**
 * Découpage sur téléphone : ce que les feuilles du bas calculent (mouvements à pictogrammes, échelle
 * de focales, axe et hauteur, insertion au curseur, passages du scénario, numéro d'un plan à venir).
 * Fonctions pures ; l'écriture passe toujours par `setCellText`.
 */
import { characterName, displayName, parseFountain, type ScriptElement } from './fountain';
import { formatShotCode, sequenceNumber } from './numbering';
import { printedPassage, sentenceSpans } from './scriptToShot';
import { mergeKey } from './text';
import type { Focal, ID, ProjectDoc, VocabEntry } from './types';
import { angleKind, AXES, HEIGHTS, matchVocab, MOVEMENTS } from './vocabulary';

// --- Mouvements -----------------------------------------------------------------------------------

/** Une case de la feuille Mouvement : un mouvement de base, et ses deux sens s'il en a. */
export interface MovementTile {
  key: string;
  label: string;
  /** Les deux sens (clés du vocabulaire) et leur libellé court. */
  ways?: readonly [{ key: string; label: string }, { key: string; label: string }];
}

export const MOVEMENT_TILES: readonly MovementTile[] = [
  { key: 'fixe', label: 'Fixe' },
  { key: 'pano', label: 'Panoramique', ways: [{ key: 'pano_gauche', label: 'Gauche' }, { key: 'pano_droite', label: 'Droite' }] },
  { key: 'tilt', label: 'Tilt', ways: [{ key: 'tilt_up', label: 'Haut' }, { key: 'tilt_down', label: 'Bas' }] },
  { key: 'trav_avant', label: 'Trav. avant' },
  { key: 'trav_arriere', label: 'Trav. arrière' },
  { key: 'trav_lateral', label: 'Trav. latéral', ways: [{ key: 'trav_lateral_gauche', label: 'Gauche' }, { key: 'trav_lateral_droit', label: 'Droite' }] },
  { key: 'trav_circulaire', label: 'Circulaire' },
  { key: 'trav_vertical', label: 'Vertical', ways: [{ key: 'boom_up', label: 'Montant' }, { key: 'boom_down', label: 'Descendant' }] },
  { key: 'zoom_avant', label: 'Zoom avant' },
  { key: 'zoom_arriere', label: 'Zoom arrière' },
  { key: 'suivi', label: 'Suivi' },
  { key: 'epaule', label: 'Épaule' },
  { key: 'steadicam', label: 'Steadicam' },
  { key: 'drone', label: 'Drone' },
  { key: 'grue', label: 'Grue' },
];

const entry = (key: string): VocabEntry | undefined => MOVEMENTS.find((m) => m.key === key);

/** Case d'un jeton de mouvement saisi (« Pano droite » → pano), sinon `undefined`. */
export function tileOf(token: string): MovementTile | undefined {
  const key = matchVocab(token, MOVEMENTS)?.key;
  if (!key) return undefined;
  return MOVEMENT_TILES.find((t) => t.key === key || t.ways?.some((w) => w.key === key));
}

/**
 * Touche une case : retirée si un de ses jetons y est, ajoutée en dernier sinon. « Fixe » exclut les
 * autres mouvements, et inversement.
 */
export function toggleTile(tokens: readonly string[], tileKey: string): string[] {
  const has = tokens.some((t) => tileOf(t)?.key === tileKey);
  if (has) return tokens.filter((t) => tileOf(t)?.key !== tileKey);
  const short = entry(tileKey)?.short ?? tileKey;
  if (tileKey === 'fixe') return [short];
  return [...tokens.filter((t) => tileOf(t)?.key !== 'fixe'), short];
}

/** Sens d'un mouvement : remplace son jeton à la même place (`undefined` : sens à préciser). */
export function setWay(tokens: readonly string[], tileKey: string, wayKey: string | undefined): string[] {
  const short = entry(wayKey ?? tileKey)?.short ?? tileKey;
  return tokens.map((t) => (tileOf(t)?.key === tileKey ? short : t));
}

/** Clé du vocabulaire d'un jeton (sens compris), sinon `undefined`. */
export const movementKey = (token: string): string | undefined => matchVocab(token, MOVEMENTS)?.key;

/** Libellé lisible d'un jeton : « Trav arrière » → « Travelling arrière » ; un jeton libre reste tel quel. */
export function movementLabel(token: string): string {
  const m = matchVocab(token, MOVEMENTS);
  if (!m) return token.trim();
  return m.long.replace(/\s*\(.*\)\s*$/, '');
}

/**
 * La suite des mouvements, à lire : « Travelling arrière », puis « zoom avant ». Le premier garde sa
 * majuscule ; `joiner` vaut « puis » (mouvements successifs) ou « + » (simultanés).
 */
export function movementPhrase(tokens: readonly string[], sep: string = ', '): Array<{ joiner?: 'puis' | '+'; text: string }> {
  return tokens
    .map((t) => movementLabel(t))
    .filter(Boolean)
    .map((text, i) => (i === 0 ? { text } : { joiner: sep.includes('+') ? '+' : 'puis', text: text.charAt(0).toLocaleLowerCase('fr') + text.slice(1) }));
}

// --- Focales --------------------------------------------------------------------------------------

export const FOCAL_SCALE: readonly number[] = [18, 24, 35, 50, 70, 85, 135];

/** Échelle proposée : les focales usuelles et celles du plan, dans l'ordre. */
export function focalScale(f: Focal, base: readonly number[] = FOCAL_SCALE): number[] {
  const all = new Set(base);
  if (f.from !== undefined) all.add(f.from);
  if (f.to !== undefined) all.add(f.to);
  return [...all].sort((a, b) => a - b);
}

/** Zoom : premier toucher la focale de départ, second celle d'arrivée ; un troisième recommence. */
export function pickZoomFocal(f: Focal, mm: number): Focal {
  if (f.from === undefined || f.to !== undefined) return { from: mm };
  if (mm === f.from) return { from: mm };
  return { from: f.from, to: mm };
}

/** Focale fixe : la toucher la choisit (le zoom garde son arrivée) ; toucher la seule choisie l'efface. */
export function pickFocal(f: Focal, mm: number): Focal {
  if (f.from === mm && f.to === undefined) return {};
  return f.to !== undefined && f.to !== mm ? { from: mm, to: f.to } : { from: mm };
}

/** Texte de la cellule Focale (« 50 → 85 », « 35 », vide). */
export function focalText(f: Focal): string {
  if (f.from === undefined) return '';
  return f.to !== undefined ? `${f.from} → ${f.to}` : String(f.from);
}

/** Libellé lu : « 50 → 85 mm ». */
export function focalLabel(f: Focal): string {
  const t = focalText(f);
  return t ? `${t.replace(' → ', ' → ')} mm` : '';
}

// --- Angle : un axe, une hauteur -----------------------------------------------------------------

export const AXIS_CHOICES: readonly VocabEntry[] = AXES;
export const HEIGHT_CHOICES: readonly VocabEntry[] = HEIGHTS;

/** L'axe et la hauteur d'un angle saisi (le subjectif compte comme une hauteur). */
export function angleParts(tokens: readonly string[]): { axis?: string; height?: string } {
  const out: { axis?: string; height?: string } = {};
  for (const t of tokens) {
    const k = angleKind(t);
    if (k === 'axis') out.axis ??= t;
    else if (k === 'height' || k === 'pov') out.height ??= t;
  }
  return out;
}

/**
 * Choisit l'axe ou la hauteur : remplace celui qui est saisi (à sa place), l'ajoute sinon (l'axe en
 * tête, la hauteur après lui) ; `undefined` le retire. Les autres jetons restent.
 */
export function setAnglePart(tokens: readonly string[], kind: 'axis' | 'height', value: string | undefined): string[] {
  const is = (t: string) => {
    const k = angleKind(t);
    return kind === 'axis' ? k === 'axis' : k === 'height' || k === 'pov';
  };
  const i = tokens.findIndex(is);
  const rest = tokens.filter((t, j) => j === i || !is(t));
  if (i >= 0) {
    const at = rest.findIndex(is);
    return value ? rest.map((t, j) => (j === at ? value : t)) : rest.filter((_, j) => j !== at);
  }
  if (!value) return [...rest];
  return kind === 'axis' ? [value, ...rest] : [...rest, value];
}

/** Même terme du vocabulaire ? (« 3/4 face » = « 3/4 Face » = « trois quarts face ») */
export function sameTerm(a: string | undefined, b: VocabEntry, entries: readonly VocabEntry[]): boolean {
  if (!a) return false;
  return matchVocab(a, entries)?.key === b.key || mergeKey(a) === mergeKey(b.short);
}

// --- Texte -----------------------------------------------------------------------------------------

/**
 * Insère un passage au curseur, séparé par une espace de ce qui l'entoure. Renvoie le texte, le
 * curseur après le passage et la place du passage.
 */
export function insertAtCaret(text: string, caret: number, snippet: string): { text: string; caret: number; start: number; end: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const start = before.length + lead.length;
  const end = start + snippet.length;
  return { text: `${before}${lead}${snippet}${trail}${after}`, caret: end, start, end };
}

/** Plages (début, fin) des passages trouvés dans le texte, sans chevauchement, dans l'ordre. */
export function markRanges(text: string, snippets: readonly string[]): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const sn of [...new Set(snippets.map((x) => x.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    for (let i = text.indexOf(sn); i >= 0; i = text.indexOf(sn, i + sn.length)) {
      const j = i + sn.length;
      if (!found.some(([a, b]) => i < b && j > a)) found.push([i, j]);
    }
  }
  return found.sort((a, b) => a[0] - b[0]);
}

// --- Scénario d'une séquence, phrase par phrase ---------------------------------------------------

export interface ScriptPiece {
  kind: 'heading' | 'sentence' | 'reply';
  /** Paragraphe d'action auquel la phrase appartient (phrases d'un même paragraphe côte à côte). */
  para?: number;
  who?: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Texte de la scène d'une séquence, à toucher : l'en-tête, les phrases d'action (une à une) et les
 * répliques entières. Vide sans scène liée.
 */
export function scriptPieces(doc: ProjectDoc, seqId: ID, elements?: readonly ScriptElement[]): ScriptPiece[] {
  const source = doc.scenario ?? '';
  const a = doc.sequences[seqId]?.scenarioAnchor;
  if (!a || a.end <= a.start || a.end > source.length) return [];
  const out: ScriptPiece[] = [];
  let reply: ScriptPiece | null = null;
  let para = 0;
  for (const el of elements ?? parseFountain(source)) {
    if (el.start < a.start || el.start >= a.end) continue;
    if (el.type === 'heading') {
      reply = null;
      out.push({ kind: 'heading', text: printedPassage(el.text), start: el.start, end: el.end });
    } else if (el.type === 'character') {
      reply = { kind: 'reply', who: displayName(characterName(el.text)), text: '', start: el.start, end: el.end };
      out.push(reply);
    } else if ((el.type === 'dialogue' || el.type === 'parenthetical') && reply) {
      if (el.type === 'dialogue') reply.text = [reply.text, printedPassage(el.text)].filter(Boolean).join(' ');
      reply.end = Math.min(el.end, a.end);
    } else if (el.type === 'action' || el.type === 'centered') {
      reply = null;
      para++;
      for (const [s0, s1] of sentenceSpans(el.text)) {
        const text = printedPassage(el.text.slice(s0, s1));
        if (text) out.push({ kind: 'sentence', para, text, start: el.start + s0, end: el.start + s1 });
      }
    } else reply = null;
  }
  return out.filter((p) => p.kind !== 'reply' || p.text);
}

// --- Numéros ---------------------------------------------------------------------------------------

/** Numéro que prendrait un plan inséré à la place `at` de la séquence (les caméras d'un cadre d'interview partagent le leur). */
export function shotCodeAt(doc: ProjectDoc, seqId: ID, at: number): string {
  const ids = doc.sequences[seqId]?.shotIds ?? [];
  let n = 0;
  let prev: string | undefined;
  for (const id of ids.slice(0, Math.max(0, at))) {
    const setup = doc.shots[id]?.interview?.setupId;
    if (!setup || setup !== prev) n++;
    prev = setup;
  }
  return formatShotCode(sequenceNumber(doc, seqId), n + 1, doc.project.settings.shotCodeFormat);
}

