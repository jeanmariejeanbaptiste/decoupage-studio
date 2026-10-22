import { fold } from './text';
import { ANGLES, MOVEMENTS, SHOT_VALUES, matchVocab } from './vocabulary';

/**
 * Icône provisoire d'un plan sans image : un pictogramme au trait, sans couleur, qui combine ce que
 * dit le découpage (valeur de cadre, axe, hauteur, mouvement, focale, ouverture, INT/EXT, sujet).
 * Ce module ne fait que décider quoi dessiner ; le dessin reste quelques traits.
 */

export type Backdrop = 'interior' | 'street' | 'nature';
export type Axis = 'face' | 'tq' | 'profil' | 'tqdos' | 'dos';
export type Height = 'eye' | 'high' | 'low' | 'top';
export type MoveGlyph = 'right' | 'left' | 'up' | 'down' | 'in' | 'out' | 'around' | 'shake';
export type ObjectKind = 'pot' | 'mug' | 'book' | 'phone' | 'poster' | 'hand' | 'key' | 'glass' | 'letter' | 'lamp' | 'car';

export interface IconInput {
  value: string;
  angle: readonly string[];
  movement: readonly string[];
  focal?: number;
  /** Ouverture, seulement si la colonne est affichée. */
  aperture?: number;
  subject: string;
  person: boolean;
  backdrop: Backdrop;
  seed: string;
}

export interface IconSpec {
  valueKey: string;
  /** Fenêtre visible de la silhouette (0 = sommet du crâne, 100 = pieds). */
  window: [number, number];
  axis: Axis;
  /** Côté vers lequel regarde le personnage de profil ou de trois-quarts (+1 = droite). */
  side: 1 | -1;
  height: Height;
  move?: MoveGlyph;
  roll: boolean;
  /** Ouverture de la perspective du sol : 0 (téléobjectif, lignes presque parallèles) à 1 (grand-angle). */
  wide: number;
  /** Arrière-plan estompé (0 net → 1 très flou), d'après l'ouverture. */
  soft: number;
  backdrop: Backdrop;
  object?: ObjectKind;
  /** Variante stable du décor (porte ou fenêtre, position…). */
  variant: number;
}

/** Fenêtres de cadrage, en unités de silhouette. */
const WINDOW: Record<string, [number, number]> = {
  general: [-170, 240],
  ensemble: [-60, 135],
  moyen: [-6, 104],
  italien: [-4, 78],
  americain: [-4, 68],
  taille: [-3, 56],
  rapproche: [-3, 36],
  gros_plan: [-2, 19],
  tres_gros_plan: [3, 12],
};

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const OBJECT_WORDS: Array<[ObjectKind, string[]]> = [
  ['hand', ['main', 'mains', 'doigt', 'doigts', 'poing']],
  ['poster', ['affiche', 'poster', 'tableau', 'photo', 'cadre', 'portrait', 'ecran', 'miroir']],
  ['phone', ['telephone', 'portable', 'smartphone', 'tel', 'mobile']],
  ['mug', ['tasse', 'cafe', 'the', 'bol', 'mug']],
  ['glass', ['verre', 'bouteille', 'vin', 'eau']],
  ['book', ['livre', 'carnet', 'cahier', 'journal', 'magazine']],
  ['letter', ['lettre', 'papier', 'enveloppe', 'feuille', 'document', 'note', 'mot']],
  ['key', ['cle', 'cles', 'serrure', 'clef']],
  ['lamp', ['lampe', 'bougie', 'lumiere', 'ampoule']],
  ['car', ['voiture', 'auto', 'taxi', 'camion', 'moto', 'velo']],
  ['pot', ['fleur', 'fleurs', 'plante', 'pot', 'bouquet', 'vase']],
];
const OBJECT_FALLBACK: ObjectKind[] = ['pot', 'mug', 'book', 'lamp', 'glass', 'letter'];

/** Objet évoqué par le sujet (premier mot reconnu), sinon un objet stable choisi au hasard. */
export function objectFor(subject: string, seed: string): ObjectKind {
  const words = fold(subject).split(/[^a-z0-9]+/);
  for (const [kind, list] of OBJECT_WORDS) if (words.some((w) => list.includes(w))) return kind;
  return OBJECT_FALLBACK[hashSeed(seed) % OBJECT_FALLBACK.length];
}

/**
 * Personnage ou objet ? Un nom de personnage connu, ou un nom propre (majuscule initiale qui n'est pas
 * un objet courant), désigne un personnage ; un nom commun désigne un objet.
 */
export function isPersonSubject(subject: string, characterNames: readonly string[]): boolean {
  const s = subject.trim();
  if (!s) return true;
  const f = fold(s);
  const first = f.split(/[^a-z0-9]+/)[0];
  if (OBJECT_WORDS.some(([, l]) => l.includes(first))) return false;
  if (characterNames.some((n) => n && f.includes(fold(n)))) return true;
  return /^\p{Lu}/u.test(s);
}

const STREET = ['rue', 'ville', 'avenue', 'boulevard', 'place', 'parking', 'gare', 'quai', 'trottoir', 'centre', 'marche', 'pont', 'route', 'carrefour', 'terrasse', 'cour'];

/** Décor d'arrière-plan d'après INT/EXT et le nom du lieu. */
export function backdropFor(intExt: string | undefined, place: string): Backdrop {
  if (intExt !== 'EXT') return 'interior';
  const words = fold(place).split(/[^a-z0-9]+/);
  return words.some((w) => STREET.includes(w)) ? 'street' : 'nature';
}

const AXIS: Record<string, [Axis, 1 | -1]> = {
  face: ['face', 1],
  trois_quarts_face: ['tq', 1],
  profil: ['profil', 1],
  profil_droit: ['profil', 1],
  profil_gauche: ['profil', -1],
  trois_quarts_dos: ['tqdos', 1],
  dos: ['dos', 1],
};

const MOVE: Record<string, MoveGlyph> = {
  pano_droite: 'right',
  trav_lateral_droit: 'right',
  trav_lateral: 'right',
  pano: 'right',
  suivi: 'right',
  pano_gauche: 'left',
  trav_lateral_gauche: 'left',
  tilt_up: 'up',
  boom_up: 'up',
  trav_vertical: 'up',
  grue: 'up',
  tilt_down: 'down',
  boom_down: 'down',
  trav_avant: 'in',
  zoom_avant: 'in',
  trav_arriere: 'out',
  zoom_arriere: 'out',
  trav_circulaire: 'around',
  trav_courbe: 'around',
  epaule: 'shake',
};

/** Ce que l'icône doit montrer pour ce plan. */
export function iconSpec(i: IconInput): IconSpec {
  const valueKey = matchVocab(i.value, SHOT_VALUES)?.key ?? 'moyen';
  const angles = i.angle.map((t) => matchVocab(t, ANGLES)?.key).filter((k): k is string => !!k);
  const moves = i.movement.map((t) => matchVocab(t, MOVEMENTS)?.key).filter((k): k is string => !!k);
  const ax = angles.map((k) => AXIS[k]).find(Boolean) ?? AXIS.face;
  const height: Height = angles.includes('top_shot') ? 'top' : angles.includes('plongee') ? 'high' : angles.includes('contre_plongee') || angles.includes('low_angle') ? 'low' : 'eye';
  const focal = i.focal ?? 35;
  const tight = ['taille', 'rapproche', 'gros_plan', 'tres_gros_plan', 'insert'].includes(valueKey);
  // Plus la focale est longue et l'ouverture grande, plus le fond se fond.
  const soft = i.aperture ? Math.max(0, Math.min(1, (focal / i.aperture / 30) * (tight ? 1 : 0.4))) : 0;
  const insert = valueKey === 'insert' || !i.person;
  return {
    valueKey,
    window: WINDOW[valueKey] ?? WINDOW.moyen,
    axis: ax[0],
    side: ax[1],
    height,
    move: moves.map((k) => MOVE[k]).find(Boolean),
    roll: moves.includes('roll'),
    wide: Math.max(0, Math.min(1, (50 - focal) / 36 + 0.35)),
    soft,
    backdrop: i.backdrop,
    object: insert ? objectFor(i.subject, i.seed) : undefined,
    variant: hashSeed(i.seed),
  };
}
