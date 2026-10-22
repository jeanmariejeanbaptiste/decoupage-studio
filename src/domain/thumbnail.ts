import { horizontalFov } from './focal';
import { fold } from './text';
import { ANGLES, MOVEMENTS, SHOT_VALUES, matchVocab } from './vocabulary';

/**
 * Vignette provisoire d'un plan : un personnage vectoriel modélisé en volumes simples (3D), vu par une
 * caméra virtuelle placée d'après le découpage. La valeur de cadre fixe ce qui doit remplir l'image,
 * la focale (et le capteur) fixe l'angle de champ, donc la distance de prise de vue et la perspective ;
 * l'angle place la caméra autour du sujet ; l'ouverture règle le flou d'arrière-plan ; le mouvement
 * ajoute un flou de bougé. Tout est calculé ici, en fonctions pures ; l'affichage ne fait que dessiner.
 */

type V3 = [number, number, number];

export type Backdrop = 'interior' | 'street' | 'nature';

export interface ThumbInput {
  value: string;
  angle: readonly string[];
  movement: readonly string[];
  focal?: number;
  /** Ouverture (nombre f) : flou d'arrière-plan seulement si elle est renseignée. */
  aperture?: number;
  crop: number;
  /** Largeur / hauteur de l'image. */
  ratio: number;
  subject: string;
  /** Le sujet est un personnage (sinon un objet). */
  person: boolean;
  backdrop: Backdrop;
  /** Graine des variations (décor, objet) : stable pour un même plan. */
  seed: string;
}

export interface Ellipse {
  t: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  cls: string;
  z: number;
}
export interface Capsule {
  t: 'capsule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  cls: string;
  z: number;
}
export interface Poly {
  t: 'poly';
  d: string;
  cls: string;
  z: number;
}
export type Prim = Ellipse | Capsule | Poly;

export interface Motion {
  kind: 'h' | 'v' | 'radial' | 'shake';
  /** Sens : +1 vers la droite / le bas / vers l'avant. */
  dir: number;
}

export interface ThumbScene {
  w: number;
  h: number;
  /** Arrière-plan (décor), puis sujet, chacun trié du plus loin au plus proche. */
  back: Prim[];
  subject: Prim[];
  /** Objet dessiné (insert ou sujet non humain). */
  object?: { kind: ObjectKind; cx: number; cy: number; size: number; squash: number };
  /** Flou d'arrière-plan, en unités de l'image (écart type). */
  blur: number;
  motion?: Motion;
  /** Roulis (degrés). */
  roll: number;
  horizon: number;
  fovH: number;
  distanceCm: number;
}

export const THUMB_W = 160;

// --- Modèle du personnage (cm, debout, regard vers +z) -------------------------------------------

const HEAD: V3 = [0, 162, 0];
const HEAD_R: V3 = [8.6, 11, 9.6];

interface Part {
  a: V3;
  b?: V3;
  r: number | V3;
  cls: string;
}

const PARTS: Part[] = [
  // Jambes, bassin, buste, bras, cou, tête.
  { a: [-10, 92, 0], b: [-10.5, 50, 2], r: 7, cls: 'cloth2' },
  { a: [-10.5, 50, 2], b: [-10, 8, 0], r: 5.5, cls: 'cloth2' },
  { a: [10, 92, 0], b: [10.5, 50, 2], r: 7, cls: 'cloth2' },
  { a: [10.5, 50, 2], b: [10, 8, 0], r: 5.5, cls: 'cloth2' },
  { a: [-10, 4, 1], b: [-10, 3, 15], r: 4.2, cls: 'shoe' },
  { a: [10, 4, 1], b: [10, 3, 15], r: 4.2, cls: 'shoe' },
  { a: [0, 97, 0], r: [16.5, 11, 10.5], cls: 'cloth2' },
  { a: [0, 121, 0], r: [18, 25, 11], cls: 'cloth' },
  { a: [-19.5, 141, 0], b: [-23, 114, 2], r: 4.8, cls: 'cloth' },
  { a: [-23, 114, 2], b: [-24, 90, 5], r: 4, cls: 'cloth' },
  { a: [19.5, 141, 0], b: [23, 114, 2], r: 4.8, cls: 'cloth' },
  { a: [23, 114, 2], b: [24, 90, 5], r: 4, cls: 'cloth' },
  { a: [-24.2, 86, 6], r: [3.4, 4.6, 2.6], cls: 'skin' },
  { a: [24.2, 86, 6], r: [3.4, 4.6, 2.6], cls: 'skin' },
  { a: [0, 146, -0.5], b: [0, 153, 0], r: 5.2, cls: 'skin' },
  { a: [0, 165.5, -1.6], r: [9.3, 9.4, 10.2], cls: 'hair' },
  { a: HEAD, r: HEAD_R, cls: 'skin' },
];

// --- Valeurs de cadre : fenêtre verticale visible, en cm (bas, haut) -----------------------------

const WINDOW: Record<string, [number, number]> = {
  general: [-150, 560],
  ensemble: [-60, 290],
  moyen: [-8, 186],
  italien: [42, 184],
  americain: [62, 184],
  taille: [88, 182],
  rapproche: [115, 180],
  gros_plan: [148, 176],
  tres_gros_plan: [159.5, 167.5],
};

/** Axes : position de la caméra autour du sujet (degrés, 0 = de face). */
const YAW: Record<string, number> = {
  face: 0,
  trois_quarts_face: 38,
  profil: 90,
  profil_droit: 90,
  profil_gauche: -90,
  trois_quarts_dos: 145,
  dos: 180,
};

const ANGLE_KEYS = (tokens: readonly string[]) => tokens.map((t) => matchVocab(t, ANGLES)?.key).filter((k): k is string => !!k);
const MOVE_KEYS = (tokens: readonly string[]) => tokens.map((t) => matchVocab(t, MOVEMENTS)?.key).filter((k): k is string => !!k);

/** Graine numérique stable. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const rand = (seed: number, i: number) => ((hashSeed(`${seed}:${i}`) % 10000) / 10000);

// --- Vecteurs ------------------------------------------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));

export interface Camera {
  pos: V3;
  r: V3;
  u: V3;
  f: V3;
  /** Focale en unités d'image. */
  fpx: number;
  w: number;
  h: number;
}

/** Projette un point : coordonnées image et profondeur (null derrière la caméra). */
export function project(cam: Camera, p: V3): { x: number; y: number; z: number } | null {
  const d = sub(p, cam.pos);
  const z = dot(d, cam.f);
  if (z < 1) return null;
  return { x: cam.w / 2 + (dot(d, cam.r) / z) * cam.fpx, y: cam.h / 2 - (dot(d, cam.u) / z) * cam.fpx, z };
}

export function lookAt(pos: V3, target: V3, fpx: number, w: number, h: number): Camera {
  const f = norm(sub(target, pos));
  const up: V3 = Math.abs(f[1]) > 0.98 ? [0, 0, -1] : [0, 1, 0];
  const r = norm(cross(f, up));
  const u = cross(r, f);
  return { pos, r, u, f, fpx, w, h };
}

/** Objets reconnus dans le sujet (inserts et sujets non humains). */
export type ObjectKind = 'pot' | 'mug' | 'book' | 'phone' | 'poster' | 'hand' | 'key' | 'glass' | 'letter' | 'lamp' | 'car' | 'eye';

const OBJECT_WORDS: Array<[ObjectKind, string[]]> = [
  ['hand', ['main', 'mains', 'doigt', 'doigts', 'poing']],
  ['eye', ['oeil', 'yeux', 'regard']],
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

/** Objet évoqué par le sujet (premier mot reconnu), ou un objet au hasard stable. */
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
  if (characterNames.some((n) => n && f.includes(fold(n)))) return !OBJECT_WORDS.some(([, l]) => l.includes(f.split(/[^a-z0-9]+/)[0]));
  const first = f.split(/[^a-z0-9]+/)[0];
  if (OBJECT_WORDS.some(([, l]) => l.includes(first))) return false;
  return /^\p{Lu}/u.test(s);
}

const STREET = ['rue', 'ville', 'avenue', 'boulevard', 'place', 'parking', 'gare', 'quai', 'trottoir', 'centre', 'marche', 'pont', 'route', 'carrefour', 'terrasse', 'cour'];

/** Décor d'arrière-plan d'après INT/EXT et le nom du lieu. */
export function backdropFor(intExt: string | undefined, place: string): Backdrop {
  if (intExt !== 'EXT') return 'interior';
  const words = fold(place).split(/[^a-z0-9]+/);
  return words.some((w) => STREET.includes(w)) ? 'street' : 'nature';
}

/** Diamètre du cercle de flou (fraction de la largeur d'image) pour un plan net à `focusCm`. */
export function blurFraction(focalMm: number, aperture: number, focusCm: number, backCm: number, crop: number): number {
  const f = focalMm;
  const s = focusCm * 10;
  const b = backCm * 10;
  if (s <= f || b <= f) return 0;
  const c = ((f * f) / aperture) * (Math.abs(b - s) / (b * (s - f)));
  return c / (36 / crop);
}

/** Construit la scène de la vignette. */
export function buildThumbScene(i: ThumbInput): ThumbScene {
  const w = THUMB_W;
  const h = Math.round(THUMB_W / i.ratio);
  const valueKey = matchVocab(i.value, SHOT_VALUES)?.key ?? 'moyen';
  const angles = ANGLE_KEYS(i.angle);
  const moves = MOVE_KEYS(i.movement);
  const focal = i.focal ?? 35;
  const fovH = horizontalFov(focal, i.crop);
  const tanH = Math.tan((fovH * Math.PI) / 360);
  const fpx = w / 2 / tanH;
  const insert = valueKey === 'insert' || !i.person;
  const seed = hashSeed(i.seed);

  // Ce qui doit remplir le cadre : une partie du corps, ou l'objet (≈ 30 cm) pour un insert.
  const [lo, hi] = insert ? (valueKey === 'insert' || WINDOW[valueKey] === undefined ? [-4, 34] : objectWindow(valueKey)) : WINDOW[valueKey];
  const span = hi - lo;
  const tanV = tanH / i.ratio;
  const dist = span / 2 / tanV;
  const target: V3 = [0, (lo + hi) / 2, 0];

  // Place de la caméra : axe autour du sujet, puis hauteur (plongée, contre-plongée…).
  const yawKey = angles.find((k) => k in YAW);
  const yaw = ((yawKey ? YAW[yawKey] : 0) * Math.PI) / 180;
  const has = (k: string) => angles.includes(k);
  let elev = 0;
  let camY: number | undefined = insert ? undefined : Math.min(162, Math.max(target[1], 60));
  const ELEV: Record<string, number> = { plongee: 32, contre_plongee: -26, top_shot: 84 };
  for (const k of Object.keys(ELEV))
    if (has(k)) {
      elev = ELEV[k];
      camY = undefined;
    }
  if (has('low_angle')) {
    camY = 12;
    elev = 0;
  }
  if (insert && !has('contre_plongee') && !has('low_angle') && !has('top_shot') && !has('plongee')) elev = 28;
  const e = (elev * Math.PI) / 180;
  const horiz = camY === undefined ? Math.cos(e) * dist : Math.sqrt(Math.max(1, dist * dist - (camY - target[1]) ** 2));
  const pos: V3 = [Math.sin(yaw) * horiz, camY ?? target[1] + Math.sin(e) * dist, Math.cos(yaw) * horiz];
  const cam = lookAt(pos, target, fpx, w, h);

  // Décor.
  const back = backdropPrims(cam, i.backdrop, seed, valueKey);
  const horizonP = project(cam, add(pos, mul(norm([cam.f[0], 0, cam.f[2]]), 1e6)));
  const horizon = horizonP ? horizonP.y : cam.f[1] < 0 ? -h : 2 * h;

  // Sujet.
  const subject: Prim[] = [];
  let object: ThumbScene['object'];
  if (insert) {
    const c = project(cam, [0, 15, 0]);
    const size = c ? (38 / c.z) * fpx : w / 2;
    object = c ? { kind: objectFor(i.subject, i.seed), cx: c.x, cy: c.y, size, squash: Math.max(0.55, Math.cos(e) * 0.4 + 0.6) } : undefined;
  } else {
    subject.push(...figurePrims(cam, valueKey));
  }
  subject.sort((a, b) => b.z - a.z);

  // Flou d'arrière-plan (seulement si l'ouverture est donnée) : décor à quelques mètres derrière.
  const backDist = i.backdrop === 'interior' ? 320 : 1600;
  const blur = i.aperture ? Math.min(w * 0.06, (blurFraction(focal, i.aperture, dist, dist + backDist, i.crop) * w) / 2.2) : 0;

  // Flou de bougé.
  let motion: Motion | undefined;
  for (const k of moves) {
    if (k === 'pano_droite' || k === 'trav_lateral_droit' || k === 'trav_lateral' || k === 'trav_circulaire' || k === 'suivi' || k === 'pano') motion = { kind: 'h', dir: 1 };
    else if (k === 'pano_gauche' || k === 'trav_lateral_gauche') motion = { kind: 'h', dir: -1 };
    else if (k === 'tilt_up' || k === 'boom_up' || k === 'trav_vertical' || k === 'grue') motion = { kind: 'v', dir: -1 };
    else if (k === 'tilt_down' || k === 'boom_down') motion = { kind: 'v', dir: 1 };
    else if (k === 'trav_avant' || k === 'zoom_avant') motion = { kind: 'radial', dir: 1 };
    else if (k === 'trav_arriere' || k === 'zoom_arriere') motion = { kind: 'radial', dir: -1 };
    else if (k === 'epaule') motion = { kind: 'shake', dir: 1 };
    if (motion) break;
  }
  return { w, h, back, subject, object, blur, motion, roll: moves.includes('roll') ? 11 : 0, horizon, fovH, distanceCm: dist };
}

/** Sujet non humain cadré comme un personnage : l'objet grossit avec la valeur. */
function objectWindow(valueKey: string): [number, number] {
  const k: Record<string, number> = { general: 900, ensemble: 400, moyen: 200, italien: 140, americain: 120, taille: 90, rapproche: 60, gros_plan: 40, tres_gros_plan: 20 };
  const s = k[valueKey] ?? 40;
  return [15 - s / 2, 15 + s / 2];
}

function ellipsoid(cam: Camera, c: V3, r: V3, cls: string): Ellipse | null {
  const p = project(cam, c);
  if (!p) return null;
  const k = cam.fpx / p.z;
  const rx = k * Math.hypot(r[0] * cam.r[0], r[1] * cam.r[1], r[2] * cam.r[2]);
  const ry = k * Math.hypot(r[0] * cam.u[0], r[1] * cam.u[1], r[2] * cam.u[2]);
  return { t: 'ellipse', cx: p.x, cy: p.y, rx, ry, cls, z: p.z };
}

function capsule(cam: Camera, a: V3, b: V3, r: number, cls: string): Capsule | null {
  const pa = project(cam, a);
  const pb = project(cam, b);
  if (!pa || !pb) return null;
  const z = (pa.z + pb.z) / 2;
  return { t: 'capsule', x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, w: (2 * r * cam.fpx) / z, cls, z };
}

const polyD = (pts: Array<{ x: number; y: number }>, close = true) => pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + (close ? ' Z' : '');

/** Le personnage, puis les détails du visage visibles depuis la caméra. */
function figurePrims(cam: Camera, valueKey: string): Prim[] {
  const out: Prim[] = [];
  const headZ = project(cam, HEAD)?.z ?? 0;
  // Les cheveux passent derrière la tête, sauf vue de dos (ils couvrent alors la nuque et le crâne).
  const fromBack = dot(norm(sub(cam.pos, HEAD)), [0, 0, 1]) < -0.25;
  for (const p of PARTS) {
    const prim = p.b ? capsule(cam, p.a, p.b, p.r as number, p.cls) : ellipsoid(cam, p.a, p.r as V3, p.cls);
    if (!prim) continue;
    if (p.cls === 'hair') prim.z = fromBack ? headZ - 0.5 : headZ + 0.5;
    out.push(prim);
  }
  const toCam = (pt: V3) => norm(sub(cam.pos, pt));
  const visible = (pt: V3) => dot(norm(sub(pt, HEAD)), toCam(pt)) > 0.12;
  const at = (pt: V3) => project(cam, pt);
  const face: Prim[] = [];
  const zf = headZ - 0.01;
  const detail = valueKey === 'gros_plan' || valueKey === 'tres_gros_plan' || valueKey === 'rapproche';
  // Oreilles.
  for (const s of [-1, 1]) {
    const e = ellipsoid(cam, [s * 8.9, 161, -0.5], [1.4, 3, 2.2], 'skin');
    if (e && visible([s * 9.5, 161, -0.5])) face.push({ ...e, cls: 'skinShade', z: headZ + 0.02 });
  }
  // Yeux : amande, iris, pupille, reflet, cils ; sourcils.
  for (const s of [-1, 1]) {
    const c: V3 = [s * 3.5, 164, 8.25];
    if (!visible(c)) continue;
    const corner1 = at([s * 3.5 - 1.55, 164, 7.9]);
    const corner2 = at([s * 3.5 + 1.55, 164, 7.9]);
    const top = at([s * 3.5, 164.95, 8.7]);
    const bot = at([s * 3.5, 163.35, 8.55]);
    const ce = at(c);
    if (!corner1 || !corner2 || !top || !bot || !ce) continue;
    const scale = cam.fpx / ce.z;
    if (scale * 1.5 < 0.9) {
      face.push({ t: 'ellipse', cx: ce.x, cy: ce.y, rx: Math.max(0.35, scale * 0.6), ry: Math.max(0.35, scale * 0.6), cls: 'feature', z: zf });
    } else {
      const ctl = (p: { x: number; y: number }, k: number) => ({ x: ce.x + (p.x - ce.x) * k, y: ce.y + (p.y - ce.y) * k });
      const t2 = ctl(top, 2);
      const b2 = ctl(bot, 2);
      face.push({ t: 'poly', d: `M${corner1.x} ${corner1.y} Q${t2.x} ${t2.y} ${corner2.x} ${corner2.y} Q${b2.x} ${b2.y} ${corner1.x} ${corner1.y} Z`, cls: 'eyeWhite', z: zf });
      const iris = ellipsoid(cam, [s * 3.5, 164, 8.6], [0.62, 0.62, 0.2], 'iris');
      const pupil = ellipsoid(cam, [s * 3.5, 164, 8.75], [0.27, 0.27, 0.1], 'pupil');
      const glint = ellipsoid(cam, [s * 3.5 + 0.22, 164.25, 8.85], [0.1, 0.1, 0.05], 'glint');
      for (const x of [iris, pupil, glint]) if (x) face.push({ ...x, z: zf - 0.001 });
      face.push({ t: 'poly', d: `M${corner1.x} ${corner1.y} Q${t2.x} ${t2.y} ${corner2.x} ${corner2.y}`, cls: 'lid', z: zf - 0.002 });
      if (valueKey === 'tres_gros_plan') {
        // Cils et pli de la paupière.
        const lashes: string[] = [];
        for (let k = 1; k < 8; k++) {
          const u = k / 8;
          const px = (1 - u) * (1 - u) * corner1.x + 2 * u * (1 - u) * t2.x + u * u * corner2.x;
          const py = (1 - u) * (1 - u) * corner1.y + 2 * u * (1 - u) * t2.y + u * u * corner2.y;
          const len = scale * 0.55 * Math.sin(Math.PI * u);
          lashes.push(`M${px} ${py} l${(u - 0.5) * len * 0.8} ${-len}`);
        }
        face.push({ t: 'poly', d: lashes.join(' '), cls: 'lash', z: zf - 0.003 });
        const fold1 = at([s * 3.5 - 1.4, 164.9, 8.1]);
        const fold2 = at([s * 3.5 + 1.4, 164.9, 8.1]);
        const foldTop = at([s * 3.5, 165.9, 8.6]);
        if (fold1 && fold2 && foldTop) face.push({ t: 'poly', d: `M${fold1.x} ${fold1.y} Q${foldTop.x} ${foldTop.y} ${fold2.x} ${fold2.y}`, cls: 'crease', z: zf - 0.003 });
      }
    }
    const b1 = at([s * 3.5 - 1.8, 166.6, 8.3]);
    const b2 = at([s * 3.5 + 1.9, 166.9, 8.1]);
    const bm = at([s * 3.5, 167.4, 8.7]);
    if (b1 && b2 && bm && scale > 0.6) face.push({ t: 'poly', d: `M${b1.x} ${b1.y} Q${bm.x} ${bm.y} ${b2.x} ${b2.y}`, cls: 'brow', z: zf });
  }
  // Nez et bouche.
  const tip = at([0, 159.4, 10.3]);
  const root = at([0, 162.4, 9.4]);
  const nl = at([-1.5, 158.6, 8.9]);
  const nr = at([1.5, 158.6, 8.9]);
  if (tip && root && nl && nr && visible([0, 159.4, 10.3])) face.push({ t: 'poly', d: `M${root.x} ${root.y} L${tip.x} ${tip.y} M${nl.x} ${nl.y} Q${tip.x} ${tip.y + 0.01} ${nr.x} ${nr.y}`, cls: 'nose', z: zf });
  const m1 = at([-3, 155, 8.3]);
  const m2 = at([3, 155, 8.3]);
  const mt = at([0, 155.25, 9.3]);
  const mb = at([0, 153.8, 9.1]);
  if (m1 && m2 && mt && mb && visible([0, 155, 9])) {
    face.push({ t: 'poly', d: `M${m1.x} ${m1.y} Q${mt.x} ${mt.y} ${m2.x} ${m2.y} Q${mb.x} ${mb.y} ${m1.x} ${m1.y} Z`, cls: detail ? 'lips' : 'mouth', z: zf });
  }
  return [...out, ...face];
}

/** Décor projeté : sol, horizon, murs ou bâtiments ou collines et arbres. */
function backdropPrims(cam: Camera, kind: Backdrop, seed: number, valueKey: string): Prim[] {
  const out: Prim[] = [];
  const toCam = norm([cam.pos[0], 0, cam.pos[2]]);
  const side: V3 = [toCam[2], 0, -toCam[0]];
  const behind = (d: number, s: number, y: number): V3 => add(add(mul(toCam, -d), mul(side, s)), [0, y, 0]);
  const quad = (pts: V3[], cls: string): Poly | null => {
    const ps = pts.map((p) => project(cam, p));
    if (ps.some((p) => !p)) return null;
    const q = ps as Array<{ x: number; y: number; z: number }>;
    return { t: 'poly', d: polyD(q), cls, z: Math.max(...q.map((p) => p.z)) };
  };
  // Sol : bande de lignes en perspective.
  const ground: string[] = [];
  for (let d = -600; d <= 4000; d += valueKey === 'general' ? 400 : 150) {
    const a = project(cam, behind(d, -3000, 0));
    const b = project(cam, behind(d, 3000, 0));
    if (a && b) ground.push(`M${a.x} ${a.y} L${b.x} ${b.y}`);
  }
  for (let s = -1800; s <= 1800; s += 300) {
    const a = project(cam, behind(-400, s, 0));
    const b = project(cam, behind(3000, s, 0));
    if (a && b) ground.push(`M${a.x} ${a.y} L${b.x} ${b.y}`);
  }
  if (ground.length) out.push({ t: 'poly', d: ground.join(' '), cls: 'groundLine', z: 1e9 });
  if (kind === 'interior') {
    const D = 320;
    const wall = quad([behind(D, -700, 0), behind(D, 700, 0), behind(D, 700, 270), behind(D, -700, 270)], 'wall');
    if (wall) out.push(wall);
    // Murs latéraux et plafond, pour la profondeur de la pièce.
    for (const s of [-1, 1]) {
      const sw = quad([behind(D, s * 700, 0), behind(-500, s * 700, 0), behind(-500, s * 700, 270), behind(D, s * 700, 270)], 'wallSide');
      if (sw) out.push(sw);
    }
    // Fenêtre ou porte sur le mur du fond, et un cadre.
    const wx = (rand(seed, 1) - 0.5) * 500;
    const isDoor = rand(seed, 2) > 0.5;
    const win = isDoor
      ? quad([behind(D - 1, wx - 45, 0), behind(D - 1, wx + 45, 0), behind(D - 1, wx + 45, 210), behind(D - 1, wx - 45, 210)], 'opening')
      : quad([behind(D - 1, wx - 80, 95), behind(D - 1, wx + 80, 95), behind(D - 1, wx + 80, 215), behind(D - 1, wx - 80, 215)], 'window');
    if (win) out.push(win);
    const fx = wx + (wx > 0 ? -260 : 260);
    const frame = quad([behind(D - 1, fx - 35, 130), behind(D - 1, fx + 35, 130), behind(D - 1, fx + 35, 180), behind(D - 1, fx - 35, 180)], 'frame');
    if (frame) out.push(frame);
  } else if (kind === 'street') {
    // Rangée d'immeubles, fenêtres en grille.
    let s = -2600;
    let k = 0;
    while (s < 2600) {
      const bw = 380 + rand(seed, 10 + k) * 420;
      const bh = 700 + rand(seed, 30 + k) * 1300;
      const D = 1500;
      const b = quad([behind(D, s, 0), behind(D, s + bw, 0), behind(D, s + bw, bh), behind(D, s, bh)], k % 2 ? 'building' : 'building2');
      if (b) out.push(b);
      const wins: string[] = [];
      for (let y = 180; y < bh - 120; y += 300)
        for (let x = s + 70; x < s + bw - 100; x += 170) {
          const pts = [behind(D - 1, x, y), behind(D - 1, x + 80, y), behind(D - 1, x + 80, y + 140), behind(D - 1, x, y + 140)].map((p) => project(cam, p));
          if (pts.every(Boolean)) wins.push(polyD(pts as Array<{ x: number; y: number }>));
        }
      if (wins.length && b) out.push({ t: 'poly', d: wins.join(' '), cls: 'buildingWin', z: b.z - 0.5 });
      s += bw + 40;
      k++;
    }
    const kerb = quad([behind(700, -3000, 0), behind(700, 3000, 0), behind(700, 3000, 14), behind(700, -3000, 14)], 'kerb');
    if (kerb) out.push(kerb);
  } else {
    // Collines au loin, puis arbres à différentes distances.
    for (const [D, amp, cls] of [[9000, 900, 'hill2'], [5000, 500, 'hill']] as const) {
      const pts: Array<{ x: number; y: number }> = [];
      for (let s = -14000; s <= 14000; s += 1000) {
        const p = project(cam, behind(D, s, amp * (0.4 + 0.6 * Math.sin(s / 2300 + rand(seed, D)))));
        if (p) pts.push(p);
      }
      const l = project(cam, behind(D, 14000, -2000));
      const r = project(cam, behind(D, -14000, -2000));
      if (pts.length > 2 && l && r) out.push({ t: 'poly', d: polyD([...pts, l, r]), cls, z: D * 10 });
    }
    for (let k = 0; k < 7; k++) {
      const D = 700 + rand(seed, 50 + k) * 2600;
      const s = (rand(seed, 70 + k) - 0.5) * 3600;
      const trunk = capsule(cam, behind(D, s, 0), behind(D, s, 260), 18, 'trunk');
      const crown = ellipsoid(cam, behind(D, s, 330), [150, 170, 150], 'crown');
      if (trunk && crown) out.push({ ...trunk, z: trunk.z + 1 }, crown);
    }
  }
  return out.sort((a, b) => b.z - a.z);
}
