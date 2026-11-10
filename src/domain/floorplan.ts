import { newId } from './factory';
import { horizontalFov } from './focal';
import { shotCode } from './numbering';
import type { ID, ProjectDoc } from './types';

export interface Point {
  x: number;
  y: number;
}

export type FloorItem =
  | { id: ID; kind: 'camera'; x: number; y: number; rot: number; shotIds: ID[]; label?: string; beat?: number }
  | { id: ID; kind: 'actor'; x: number; y: number; characterId?: ID; label: string; to?: Point; beat?: number; rot?: number }
  | {
      id: ID;
      kind: 'wall' | 'rail';
      x: number;
      y: number;
      x2: number;
      y2: number;
      /** Mur blanc : renvoie un peu de lumière. */
      white?: boolean;
      /** Mur tracé depuis les dimensions de la pièce (suit les dimensions et se déplace avec elle). */
      room?: boolean;
      /** Côté de la pièce : nord (haut), est, sud, ouest. */
      side?: RoomSide;
    }
  | { id: ID; kind: 'door' | 'window'; x: number; y: number; rot: number; width: number }
  | {
      id: ID;
      kind: 'light';
      x: number;
      y: number;
      rot: number;
      label?: string;
      spread?: number;
      range?: number;
      /** Puissance de la source (1 = normale). */
      power?: number;
      /** Lumière de jeu (lampe visible dans le champ) : rayonne tout autour. */
      practical?: boolean;
      /** Projecteur réel : modèle, puissance électrique (W), température de couleur (K). */
      model?: string;
      watts?: number;
      kelvin?: number;
    }
  | { id: ID; kind: 'reflector' | 'diffuser' | 'flag'; x: number; y: number; x2: number; y2: number; label?: string };

/** Éléments tracés comme un segment (cliquer-glisser). */
export const LINE_KINDS = ['wall', 'rail', 'reflector', 'diffuser', 'flag'] as const;
export const isLineKind = (k: string): k is (typeof LINE_KINDS)[number] => (LINE_KINDS as readonly string[]).includes(k);

export type FloorKind = FloorItem['kind'];

export interface FloorPlan {
  items: FloorItem[];
  /** Séquence et nom des plans supplémentaires ; le plan par défaut est rangé sous la clé de la séquence. */
  seqId?: ID;
  name?: string;
  /** Vue propre à un plan-séquence (clé `ps-<plan>`). */
  oneShotId?: ID;
  /** Plan des locaux en fond, pour dessiner par-dessus. */
  /** Image de fond : position et largeur dans le repère du plan ; `ratio` = hauteur / largeur de l'image. */
  bg?: { blobKey: string; opacity: number; x: number; y: number; w: number; ratio?: number };
  /** Épaisseur des traits (murs, rails, portes, fenêtres, réflecteurs…) : multiplicateur, 1 par défaut. */
  stroke?: number;
  /** Dimensions réelles de la pièce, en mètres (1 unité du plan = 1 cm). */
  room?: Room;
}

export interface Room {
  w: number;
  l: number;
  h?: number;
}

export type RoomSide = 'n' | 'e' | 's' | 'w';
type Wall = Extract<FloorItem, { kind: 'wall' | 'rail' }>;

/** Gabarits de pièce (largeur × longueur × hauteur, en mètres). */
export const ROOM_PRESETS: ReadonlyArray<{ label: string; room: Room }> = [
  { label: 'Petite', room: { w: 5, l: 6, h: 2.5 } },
  { label: 'Moyenne', room: { w: 6, l: 7.5, h: 3 } },
  { label: 'Grande', room: { w: 8, l: 10, h: 5 } },
];

/** Nombre en français, sans zéros inutiles : 7,5 ; 2,25. */
const frNum = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Dimensions en bref : « 6 × 7,5 × 3 m » (sans hauteur : « 6 × 7,5 m »). */
export const formatRoom = (r: Room) => `${[r.w, r.l, r.h].filter((x): x is number => !!x).map(frNum).join(' × ')} m`;

/** Gabarit qui correspond exactement à la pièce (aucun : la pièce est personnalisée). */
export function roomPreset(r: Room | undefined): string | undefined {
  if (!r) return undefined;
  return ROOM_PRESETS.find((p) => p.room.w === r.w && p.room.l === r.l && p.room.h === r.h)?.label;
}

/** Bornes des dimensions d'une pièce (m) : au-delà, la saisie est sans doute une erreur d'unité. */
export const ROOM_LIMITS = { side: [0.5, 100], h: [1, 30] } as const;

/** Dimensions admissibles (hauteur facultative). */
export function roomValid(r: Room): boolean {
  const ok = (v: number, [a, b]: readonly [number, number]) => Number.isFinite(v) && v >= a && v <= b;
  return ok(r.w, ROOM_LIMITS.side) && ok(r.l, ROOM_LIMITS.side) && (r.h === undefined || ok(r.h, ROOM_LIMITS.h));
}

/** Superficie (m²) et volume (m³) d'une pièce. */
export function roomSize(r: Room): { area: number; volume?: number } {
  const area = Math.round(r.w * r.l * 100) / 100;
  return { area, volume: r.h ? Math.round(area * r.h * 10) / 10 : undefined };
}

export const isRoomWall = (i: FloorItem): i is Wall => i.kind === 'wall' && !!i.room;

/** Côté d'un mur de la pièce ; pour un mur tracé avant que le côté soit noté, d'après sa position. */
function sideOf(w: Wall, walls: readonly Wall[]): RoomSide {
  if (w.side) return w.side;
  const xs = walls.flatMap((x) => [x.x, x.x2]);
  const ys = walls.flatMap((x) => [x.y, x.y2]);
  if (Math.abs(w.y2 - w.y) <= Math.abs(w.x2 - w.x)) return w.y <= (Math.min(...ys) + Math.max(...ys)) / 2 ? 'n' : 's';
  return w.x <= (Math.min(...xs) + Math.max(...xs)) / 2 ? 'w' : 'e';
}

/** Boîte englobante d'éléments (repère du plan). */
function bounds(items: readonly FloorItem[]): { x0: number; y0: number; x1: number; y1: number } | undefined {
  if (!items.length) return undefined;
  const xs = items.flatMap((i) => ('x2' in i ? [i.x, i.x2] : [i.x]));
  const ys = items.flatMap((i) => ('y2' in i ? [i.y, i.y2] : [i.y]));
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Dimensions de la pièce : celles du plan ou, pour une vue dupliquée avant que ses dimensions la
 * suivent, celles que dessinent ses murs.
 */
export function roomOf(plan: Pick<FloorPlan, 'room' | 'items'>): Room | undefined {
  if (plan.room) return plan.room;
  const b = bounds(plan.items.filter(isRoomWall));
  if (!b || b.x1 - b.x0 < 1 || b.y1 - b.y0 < 1) return undefined;
  return { w: Math.round(b.x1 - b.x0) / 100, l: Math.round(b.y1 - b.y0) / 100 };
}

/** Rectangle de la pièce sur le plan (repère du plan, en cm), retrouvé d'après ses murs. */
export function roomRect(plan: Pick<FloorPlan, 'room' | 'items'>): { x: number; y: number; w: number; l: number } | undefined {
  const r = roomOf(plan);
  const walls = plan.items.filter(isRoomWall);
  if (!r || !walls.length) return undefined;
  const W = Math.round(r.w * 100);
  const L = Math.round(r.l * 100);
  const w = walls[0];
  const [mx, my] = [Math.min(w.x, w.x2), Math.min(w.y, w.y2)];
  const o = { n: { x: mx, y: w.y }, s: { x: mx, y: w.y - L }, w: { x: w.x, y: my }, e: { x: w.x - W, y: my } }[sideOf(w, walls)];
  return { ...o, w: W, l: L };
}

/** Segment d'un côté de la pièce, dans le sens des aiguilles d'une montre. */
function sideSegment(side: RoomSide, x: number, y: number, W: number, L: number) {
  return {
    n: { x, y, x2: x + W, y2: y },
    e: { x: x + W, y, x2: x + W, y2: y + L },
    s: { x: x + W, y: y + L, x2: x, y2: y + L },
    w: { x, y: y + L, x2: x, y2: y },
  }[side];
}

/**
 * Coin d'une nouvelle pièce : celui des murs déjà tracés (plan des locaux importé), sinon celui de
 * l'image de fond, sinon l'origine du plan.
 */
function newRoomCorner(plan: FloorPlan): Point {
  const b = bounds(plan.items.filter((i) => i.kind === 'wall' && !i.room));
  if (b) return { x: b.x0, y: b.y0 };
  return plan.bg ? { x: Math.round(plan.bg.x), y: Math.round(plan.bg.y) } : { x: 0, y: 0 };
}

/**
 * Pose ou redimensionne la pièce : ses murs suivent les dimensions, son coin en haut à gauche reste
 * en place (pour une nouvelle pièce : au coin du plan des locaux, ou à l'origine). Un côté retiré le
 * reste, un mur blanc reste blanc ; sans dimensions, la pièce et ses murs sont retirés ; des
 * dimensions hors bornes sont ignorées. Les autres éléments ne bougent pas.
 */
export function setRoom(doc: ProjectDoc, planKey: string, room: Room | undefined): void {
  if (!room && !doc.floorPlans?.[planKey]) return;
  const valid: Room | undefined = room && { w: room.w, l: room.l, ...(room.h ? { h: room.h } : {}) };
  if (valid && !roomValid(valid)) return;
  const plan = ensure(doc, planKey);
  // La hauteur seule ne change pas le tracé : les murs (et leurs retouches) restent.
  if (valid && plan.room && valid.w === plan.room.w && valid.l === plan.room.l && plan.items.some(isRoomWall)) {
    plan.room = valid;
    return;
  }
  if (!valid) {
    plan.items = plan.items.filter((i) => !isRoomWall(i));
    delete plan.room;
    return;
  }
  const W = Math.round(valid.w * 100);
  const L = Math.round(valid.l * 100);
  const corner = roomRect(plan) ?? newRoomCorner(plan);
  // La pièce agrandie reste dans l'espace de travail.
  const at = { x: Math.max(WORLD.min, Math.min(corner.x, WORLD.max - W)), y: Math.max(WORLD.min, Math.min(corner.y, WORLD.max - L)) };
  const walls = plan.items.filter(isRoomWall);
  const sides = walls.map((w) => sideOf(w, walls));
  plan.room = valid;
  if (!walls.length) {
    for (const side of ['n', 'e', 's', 'w'] as const) plan.items.push({ id: newId(), kind: 'wall', ...sideSegment(side, at.x, at.y, W, L), room: true, side });
    return;
  }
  walls.forEach((w, k) => Object.assign(w, sideSegment(sides[k], at.x, at.y, W, L), { side: sides[k] }));
}

/** Distance d'un point à un segment. */
function distToSegment(p: Point, w: { x: number; y: number; x2: number; y2: number }): number {
  const [dx, dy] = [w.x2 - w.x, w.y2 - w.y];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - w.x) * dx + (p.y - w.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (w.x + t * dx), p.y - (w.y + t * dy));
}

/** Écart (cm) en deçà duquel une porte ou une fenêtre est percée dans un mur de la pièce. */
const OPENING_SNAP = 15;

/**
 * Éléments à déplacer ensemble : un mur de la pièce entraîne toute la pièce, avec les portes et
 * fenêtres percées dans ses murs.
 */
export function withRoomWalls(items: readonly FloorItem[], ids: readonly ID[]): ID[] {
  const set = new Set(ids);
  if (!items.some((i) => set.has(i.id) && isRoomWall(i))) return [...set];
  const walls = items.filter(isRoomWall);
  for (const w of walls) set.add(w.id);
  for (const i of items) {
    if ((i.kind === 'door' || i.kind === 'window') && walls.some((w) => distToSegment(i, w) <= OPENING_SNAP)) set.add(i.id);
  }
  return [...set];
}

/** Cote d'un côté de la pièce : trait parallèle au mur, à l'extérieur, et valeur en mètres. */
export interface RoomDimension {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Lignes d'attache, du coin de la pièce jusqu'au-delà du trait de cote. */
  ext: Array<[number, number, number, number]>;
  label: string;
  tx: number;
  ty: number;
  /** Rotation du texte (degrés) : la longueur se lit de bas en haut. */
  rot: number;
  /** Taille du texte (repère du plan). */
  font: number;
  /** Demi-longueur des obliques aux extrémités du trait de cote. */
  tick: number;
}

/** Écart entre le mur et sa cote, et taille du texte, à l'échelle 1 (repère du plan). */
export const DIMENSION_GAP = 32;
export const DIMENSION_FONT = 13;
/** Place prise par une cote au-delà du mur (écart, retrait et hauteur du texte), à l'échelle 1. */
export const DIMENSION_REACH = DIMENSION_GAP + 6 + DIMENSION_FONT;

/**
 * Cotes de la pièce : largeur au-dessus du mur du haut, longueur à gauche du mur de gauche.
 * `scale` agrandit écart, texte et obliques (à l'écran : taille constante en pixels quel que soit le zoom).
 */
export function roomDimensions(plan: Pick<FloorPlan, 'room' | 'items'>, scale = 1): RoomDimension[] {
  const r = roomRect(plan);
  const room = roomOf(plan);
  if (!r || !room) return [];
  const [gap, off, font, tick] = [DIMENSION_GAP, 6, DIMENSION_FONT, 4].map((v) => v * scale);
  const top = r.y - gap;
  const left = r.x - gap;
  return [
    {
      ...{ x1: r.x, y1: top, x2: r.x + r.w, y2: top },
      ext: [
        [r.x, r.y - off, r.x, top - off],
        [r.x + r.w, r.y - off, r.x + r.w, top - off],
      ],
      ...{ label: formatMeters(room.w), tx: r.x + r.w / 2, ty: top - off, rot: 0, font, tick },
    },
    {
      ...{ x1: left, y1: r.y, x2: left, y2: r.y + r.l },
      ext: [
        [r.x - off, r.y, left - off, r.y],
        [r.x - off, r.y + r.l, left - off, r.y + r.l],
      ],
      ...{ label: formatMeters(room.l), tx: left - off, ty: r.y + r.l / 2, rot: -90, font, tick },
    },
  ];
}

/** Projecteurs courants : puissance et température par défaut. */
export const LIGHT_PRESETS: ReadonlyArray<{ model: string; watts: number; kelvin: number }> = [
  { model: 'Fresnel 650 W', watts: 650, kelvin: 3200 },
  { model: 'Fresnel 1 kW', watts: 1000, kelvin: 3200 },
  { model: 'Fresnel 2 kW', watts: 2000, kelvin: 3200 },
  { model: 'HMI 1 800 W (M18)', watts: 1800, kelvin: 5600 },
  { model: 'HMI 4 kW', watts: 4000, kelvin: 5600 },
  { model: 'HMI 9 kW (M90)', watts: 9000, kelvin: 5600 },
  { model: 'Panneau LED 200 W', watts: 200, kelvin: 5600 },
  { model: 'Tube LED', watts: 30, kelvin: 5600 },
  { model: 'Ballon (lanterne chinoise)', watts: 500, kelvin: 3200 },
];

/** Puissance et température en bref : « 2 kW · 3 200 K ». */
export function lightSpecs(l: { watts?: number; kelvin?: number }): string {
  const w = l.watts ? (l.watts >= 1000 ? `${String(Math.round(l.watts / 100) / 10).replace('.', ',')} kW` : `${l.watts} W`) : '';
  const k = l.kelvin ? `${l.kelvin.toLocaleString('fr-FR')} K` : '';
  return [w, k].filter(Boolean).join(' · ');
}

export interface PlanRef {
  key: string;
  name: string;
}

/** Plans au sol d'une séquence : le plan par défaut (clé = séquence) puis les plans ajoutés. */
export function plansOf(doc: ProjectDoc, seqId: ID): PlanRef[] {
  const out: PlanRef[] = [{ key: seqId, name: doc.floorPlans?.[seqId]?.name ?? 'Vue 1' }];
  for (const [key, p] of Object.entries(doc.floorPlans ?? {}))
    if (p.seqId === seqId && key !== seqId && !p.oneShotId) out.push({ key, name: p.name ?? 'Vue' });
  return out;
}

export const oneShotPlanKey = (shotId: ID) => `ps-${shotId}`;

/** Vues de plan-séquence d'une séquence : une par plan-séquence présent dans le découpage. */
export function oneShotPlansOf(doc: ProjectDoc, seqId: ID): Array<PlanRef & { shotId: ID }> {
  const seq = doc.sequences[seqId];
  if (!seq) return [];
  return seq.shotIds
    .filter((id) => doc.shots[id]?.oneShot)
    .map((id) => ({ key: oneShotPlanKey(id), shotId: id, name: `Plan-séquence ${shotCode(doc, id)}` }));
}

/** Premier nom libre de la série : `make(1)`, `make(2)`… parmi les noms donnés. */
function firstFreeName(taken: readonly string[], make: (n: number) => string): string {
  const set = new Set(taken);
  let n = 1;
  while (set.has(make(n))) n++;
  return make(n);
}

export function addPlan(doc: ProjectDoc, seqId: ID): string {
  const taken = plansOf(doc, seqId).map((p) => p.name);
  const key = newId();
  doc.floorPlans ??= {};
  doc.floorPlans[key] = { items: [], seqId, name: firstFreeName(taken, (n) => `Vue ${n}`) };
  return key;
}

/** Copie d'une vue : mêmes éléments (avec leurs propres identifiants), même fond, pièce et épaisseur de traits. */
export function duplicatePlan(doc: ProjectDoc, seqId: ID, key: string): string {
  const src = planOf(doc, key);
  const name = src.name ?? plansOf(doc, seqId).find((p) => p.key === key)?.name;
  const k = addPlan(doc, seqId);
  const copy = doc.floorPlans![k];
  copy.items = src.items.map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: newId() }) as FloorItem);
  if (src.bg) copy.bg = { ...src.bg };
  if (src.room) copy.room = { ...src.room };
  if (src.stroke !== undefined) copy.stroke = src.stroke;
  if (name) {
    // « Vue 1 (copie) », puis « Vue 1 (copie 2) »… : jamais de suffixes empilés.
    const base = name.replace(/\s+\(copie(?: \d+)?\)$/, '');
    const taken = plansOf(doc, seqId).filter((p) => p.key !== k).map((p) => p.name);
    copy.name = firstFreeName(taken, (n) => `${base} (copie${n > 1 ? ` ${n}` : ''})`);
  }
  return k;
}

export function renamePlan(doc: ProjectDoc, key: string, name: string): void {
  ensure(doc, key).name = name.trim() || undefined;
}

/** Supprime un plan ajouté ; le plan par défaut est seulement vidé. */
export function deletePlan(doc: ProjectDoc, key: string): void {
  const plans = doc.floorPlans;
  const p = plans?.[key];
  if (!plans || (!p && !doc.sequences[key])) return;
  if (p?.seqId) {
    delete plans[key];
    return;
  }
  // Vue principale (clé = séquence) : la vue suivante prend sa place ; sinon elle est vidée.
  const next = Object.entries(plans).find(([k, x]) => x.seqId === key && k !== key && !x.oneShotId);
  if (!next) {
    if (p) {
      // Le fond (plan des locaux) reste ; la pièce part avec ses murs.
      p.items = [];
      p.name = undefined;
      delete p.room;
    }
    return;
  }
  plans[key] = { ...next[1], seqId: undefined };
  delete plans[next[0]];
}

export const PLAN_W = 1000;
export const PLAN_H = 640;
export const GRID = 20;

export const snap = (v: number, step = GRID) => Math.round(v / step) * step;
/** Espace de travail : bien au-delà de la vue par défaut, pour un fond de plan à l'échelle réelle. */
export const WORLD = { min: -4000, max: 30000 } as const;
const clampV = (v: number) => Math.max(WORLD.min, Math.min(WORLD.max, v));
export const clampPoint = (p: Point): Point => ({ x: clampV(p.x), y: clampV(p.y) });

export function planOf(doc: ProjectDoc, seqId: ID): FloorPlan {
  return doc.floorPlans?.[seqId] ?? { items: [] };
}

function ensure(doc: ProjectDoc, seqId: ID): FloorPlan {
  doc.floorPlans ??= {};
  if (!doc.floorPlans[seqId]) {
    const shotId = seqId.startsWith('ps-') ? seqId.slice(3) : undefined;
    doc.floorPlans[seqId] = shotId ? { items: [], oneShotId: shotId, seqId: doc.shots[shotId]?.sequenceId } : { items: [] };
  }
  return doc.floorPlans[seqId];
}

/** Premier repère libre de la vue (« CAM A », « L1 », « P1 »…), même après une suppression. */
export function nextLabel(items: readonly FloorItem[], make: (n: number) => string): string {
  const taken = items.map((i) => ('label' in i ? i.label : undefined)).filter((x): x is string => !!x);
  return firstFreeName(taken, make);
}

/** Crée un élément à la position donnée et renvoie son identifiant. */
export function addFloorItem(doc: ProjectDoc, seqId: ID, kind: FloorKind, at: Point, end?: Point): ID {
  const plan = ensure(doc, seqId);
  const p = clampPoint({ x: snap(at.x), y: snap(at.y) });
  const id = newId();
  const label = (make: (n: number) => string) => nextLabel(plan.items, make);
  switch (kind) {
    case 'camera':
      plan.items.push({ id, kind, ...p, rot: -90, shotIds: [], label: label((n) => `CAM ${String.fromCharCode(64 + n)}`) });
      break;
    case 'actor':
      // Orientation : 90° = regarde vers le bas du plan.
      plan.items.push({ id, kind, ...p, label: label(String), rot: 90 });
      break;
    case 'wall':
    case 'rail':
    case 'reflector':
    case 'diffuser':
    case 'flag': {
      const e = clampPoint(end ? { x: snap(end.x), y: snap(end.y) } : { x: p.x + 160, y: p.y });
      plan.items.push(
        kind === 'reflector' || kind === 'diffuser' || kind === 'flag'
          ? { id, kind, ...p, x2: e.x, y2: e.y, label: label((n) => `${kind === 'reflector' ? 'R' : kind === 'diffuser' ? 'D' : 'N'}${n}`) }
          : { id, kind, ...p, x2: e.x, y2: e.y },
      );
      break;
    }
    case 'door':
    case 'window': {
      const width = kind === 'door' ? 80 : 120;
      plan.items.push({ id, kind, ...p, rot: 0, width, ...fitOpeningToWall(plan.items, p, width) });
      break;
    }
    case 'light':
      plan.items.push({
        id,
        kind,
        ...p,
        rot: 90,
        label: label((n) => `L${n}`),
        spread: DEFAULT_SPREAD,
        range: DEFAULT_RANGE,
      });
      break;
  }
  return id;
}

export function updateFloorItem(doc: ProjectDoc, seqId: ID, id: ID, patch: Partial<FloorItem>): void {
  const plan = ensure(doc, seqId);
  const i = plan.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const next = { ...plan.items[i], ...patch } as FloorItem;
  if (next.kind === 'door' || next.kind === 'window') next.width = clampOpening(next.width);
  plan.items[i] = next;
}

/** Largeur admissible d'une porte ou d'une fenêtre (cm). */
export const OPENING_LIMITS = [20, 1000] as const;
const clampOpening = (w: number) =>
  Number.isFinite(w) ? Math.max(OPENING_LIMITS[0], Math.min(OPENING_LIMITS[1], Math.round(w))) : OPENING_LIMITS[0];

/** Écart (cm) en deçà duquel une porte ou une fenêtre se pose sur un mur. */
const OPENING_FIT = 20;

/**
 * Porte ou fenêtre posée près d'un mur : elle se couche sur le mur le plus proche (même angle,
 * point projeté), et sa largeur tient sur le mur. Les murs de la pièce étant tracés dans le sens
 * horaire, le battant s'ouvre dans la pièce ; une ouverture déjà tournée vers l'extérieur
 * (`rot` = angle du mur + 180°) le reste. Loin de tout mur : rien (undefined).
 */
export function fitOpeningToWall(items: readonly FloorItem[], p: Point, width: number, rot?: number): { x: number; y: number; rot: number } | undefined {
  let wall: Wall | undefined;
  let best = OPENING_FIT;
  for (const i of items) {
    if (i.kind !== 'wall') continue;
    const d = distToSegment(p, i);
    if (d < best) {
      best = d;
      wall = i;
    }
  }
  if (!wall) return undefined;
  const len = Math.hypot(wall.x2 - wall.x, wall.y2 - wall.y);
  if (len < 1) return undefined;
  const [ux, uy] = [(wall.x2 - wall.x) / len, (wall.y2 - wall.y) / len];
  const angle = Math.round((Math.atan2(uy, ux) * 180) / Math.PI);
  const flipped = rot !== undefined && Math.abs(((((rot - angle) % 360) + 540) % 360) - 180) > 179;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const t0 = clamp((p.x - wall.x) * ux + (p.y - wall.y) * uy, 0, len);
  const w = Math.min(width, len);
  const t = flipped ? clamp(t0, w, len) : clamp(t0, 0, len - w);
  return { x: Math.round(wall.x + ux * t), y: Math.round(wall.y + uy * t), rot: flipped ? rot! : angle };
}

/**
 * Déplace un élément ; un mur de la pièce déplace toute la pièce. Une porte ou une fenêtre
 * déplacée seule près d'un mur s'y couche (`fitOpeningToWall`).
 */
export function moveFloorItem(doc: ProjectDoc, seqId: ID, id: ID, dx: number, dy: number): void {
  moveFloorItems(doc, seqId, [id], dx, dy);
  const plan = ensure(doc, seqId);
  const it = plan.items.find((i) => i.id === id);
  if (it?.kind !== 'door' && it?.kind !== 'window') return;
  const fit = fitOpeningToWall(plan.items, it, it.width, it.rot);
  if (fit) Object.assign(it, fit);
}

/** Déplace plusieurs éléments du même écart (toute la pièce dès qu'un de ses murs en fait partie). */
export function moveFloorItems(doc: ProjectDoc, seqId: ID, ids: readonly ID[], dx: number, dy: number): void {
  const plan = ensure(doc, seqId);
  const all = new Set(withRoomWalls(plan.items, ids));
  const group = plan.items.filter((i) => all.has(i.id));
  // Le groupe s'arrête d'un bloc au bord de l'espace de travail : rien ne se déforme.
  const pts = group.flatMap((i) => [{ x: i.x, y: i.y }, ...('x2' in i ? [{ x: i.x2, y: i.y2 }] : []), ...(i.kind === 'actor' && i.to ? [i.to] : [])]);
  if (!pts.length) return;
  const limit = (d: number, vs: number[]) => Math.max(Math.min(0, WORLD.min - Math.min(...vs)), Math.min(Math.max(0, WORLD.max - Math.max(...vs)), d));
  const mx = limit(dx, pts.map((p) => p.x));
  const my = limit(dy, pts.map((p) => p.y));
  for (const item of group) moveOne(item, mx, my);
}

function moveOne(item: FloorItem, dx: number, dy: number): void {
  item.x += dx;
  item.y += dy;
  if ('x2' in item) {
    item.x2 += dx;
    item.y2 += dy;
  }
  if (item.kind === 'actor' && item.to) item.to = { x: item.to.x + dx, y: item.to.y + dy };
}

/** Retire un élément ; avec le dernier mur de la pièce, la pièce elle-même. */
export function removeFloorItem(doc: ProjectDoc, seqId: ID, id: ID): void {
  const plan = ensure(doc, seqId);
  plan.items = plan.items.filter((x) => x.id !== id);
  if (plan.room && !plan.items.some(isRoomWall)) delete plan.room;
}

/**
 * Focale de la caméra : celle du premier plan lié (départ du zoom le cas échéant) ; dans la vue
 * d'un plan-séquence, celle du temps où la caméra est posée.
 */
export function cameraFocal(
  doc: ProjectDoc,
  cam: Extract<FloorItem, { kind: 'camera' }>,
): number | undefined {
  for (const id of cam.shotIds) {
    const shot = doc.shots[id];
    if (!shot) continue;
    const beat = cam.beat ? shot.oneShot?.beats[cam.beat - 1]?.focal : undefined;
    const f = beat ?? shot.focal.from ?? shot.focal.to;
    if (f) return f;
  }
  return undefined;
}

/**
 * Séquence propriétaire d'une vue : celle de son plan-séquence (calculée, car le plan peut changer
 * de séquence), sinon la séquence enregistrée, sinon la clé (vue principale).
 */
export function planOwner(doc: ProjectDoc, key: string, plan: FloorPlan): ID | undefined {
  return plan.oneShotId ? doc.shots[plan.oneShotId]?.sequenceId : (plan.seqId ?? key);
}

/** Clés de tous les plans au sol rattachés à une séquence (vues, plans-séquences). */
export function planKeysOfSequence(doc: ProjectDoc, seqId: ID): string[] {
  const shotKeys = new Set((doc.sequences[seqId]?.shotIds ?? []).map(oneShotPlanKey));
  return Object.entries(doc.floorPlans ?? {})
    .filter(([key, p]) => key === seqId || (p.seqId === seqId && !p.oneShotId) || shotKeys.has(key))
    .map(([key]) => key);
}

/**
 * Un plan quitte sa séquence (déplacé ou supprimé ; à appeler une fois `sequenceId` mis à jour) :
 * les caméras des autres séquences ne le couvrent plus ; sa vue de plan-séquence le suit, ou
 * disparaît s'il est supprimé.
 */
export function unlinkShotFromPlans(doc: ProjectDoc, shotId: ID, deleted: boolean): void {
  const seqId = doc.shots[shotId]?.sequenceId;
  for (const [key, plan] of Object.entries(doc.floorPlans ?? {})) {
    const owner = planOwner(doc, key, plan);
    if (!deleted && owner === seqId) continue;
    for (const it of plan.items) if (it.kind === 'camera' && it.shotIds.includes(shotId)) it.shotIds = it.shotIds.filter((x) => x !== shotId);
  }
  const own = doc.floorPlans?.[oneShotPlanKey(shotId)];
  if (deleted && doc.floorPlans) delete doc.floorPlans[oneShotPlanKey(shotId)];
  else if (own && seqId) own.seqId = seqId;
}

/** Polygone du cône de champ (vue de dessus) : sommet, puis arc échantillonné. */
export function conePoints(
  x: number,
  y: number,
  rotDeg: number,
  fovDeg: number,
  length: number,
  steps = 12,
): Point[] {
  const pts: Point[] = [{ x, y }];
  const half = Math.min(170, fovDeg) / 2;
  for (let i = 0; i <= steps; i++) {
    const a = ((rotDeg - half + (2 * half * i) / steps) * Math.PI) / 180;
    pts.push({ x: x + Math.cos(a) * length, y: y + Math.sin(a) * length });
  }
  return pts;
}

export function cameraCone(
  doc: ProjectDoc,
  cam: Extract<FloorItem, { kind: 'camera' }>,
  length = 260,
): { points: Point[]; fov: number; focal?: number } {
  const focal = cameraFocal(doc, cam);
  const fov = focal ? horizontalFov(focal, doc.project.settings.cropFactor) : 60;
  return { points: conePoints(cam.x, cam.y, cam.rot, fov, length), fov, focal };
}

/** Caméras des plans au sol liées à un plan. */
export function camerasForShot(doc: ProjectDoc, shotId: ID): string[] {
  return [...new Set(shotCameras(doc, shotId).map((c) => c.label))];
}

/** Caméras liées à un plan du découpage, avec la vue où elles sont posées. */
export function shotCameras(doc: ProjectDoc, shotId: ID): Array<{ planKey: string; id: ID; label: string }> {
  const seqId = doc.shots[shotId]?.sequenceId;
  if (!seqId) return [];
  return [...plansOf(doc, seqId), ...oneShotPlansOf(doc, seqId)].flatMap((ref) =>
    planOf(doc, ref.key)
      .items.filter((i): i is Extract<FloorItem, { kind: 'camera' }> => i.kind === 'camera' && i.shotIds.includes(shotId))
      .map((c) => ({ planKey: ref.key, id: c.id, label: c.label?.trim() || 'CAM' })),
  );
}

/** Pose une caméra liée à un plan du découpage et renvoie son identifiant. */
export function placeCameraForShot(doc: ProjectDoc, planKey: string, shotId: ID, at: Point): ID {
  const id = addFloorItem(doc, planKey, 'camera', at);
  updateFloorItem(doc, planKey, id, { shotIds: [shotId] } as Partial<FloorItem>);
  return id;
}

export const FLOOR_KIND_LABEL: Record<FloorKind, string> = {
  camera: 'Caméra',
  actor: 'Comédien',
  wall: 'Mur',
  rail: 'Rails',
  door: 'Porte',
  window: 'Fenêtre',
  light: 'Projecteur',
  reflector: 'Réflecteur',
  diffuser: 'Diffuseur',
  flag: 'Drapeau (négatif)',
};

/** Longueur d'un élément tracé, en mètres (1 unité du plan = 1 cm). */
export const itemLength = (i: { x: number; y: number; x2: number; y2: number }) => Math.round(Math.hypot(i.x2 - i.x, i.y2 - i.y)) / 100;
export const formatMeters = (m: number) => `${String(Math.round(m * 100) / 100).replace('.', ',')} m`;

export interface InventoryRow {
  id: ID;
  kind: FloorKind;
  practical?: boolean;
  /** Température de couleur d'un projecteur (K). */
  kelvin?: number;
  name: string;
  detail: string;
}

const INVENTORY_ORDER: FloorKind[] = ['camera', 'actor', 'light', 'reflector', 'diffuser', 'flag', 'rail'];

/**
 * Éléments posés sur une vue, dans l'ordre du plateau (caméras, comédiens, lumière, rails), avec un
 * nom et l'essentiel : plans couverts et focale, personnage, puissance, longueur. Le décor (murs,
 * portes, fenêtres) est résumé à part (`decorSummary`).
 */
export function planInventory(doc: ProjectDoc, items: readonly FloorItem[]): InventoryRow[] {
  const beat = (b?: number) => (b ? `T${b}` : '');
  const join = (...xs: Array<string | undefined>) => xs.filter(Boolean).join(' · ');
  return INVENTORY_ORDER.flatMap((kind) =>
    items
      .filter((i) => i.kind === kind)
      .map((i): InventoryRow => {
        switch (i.kind) {
          case 'camera': {
            const f = cameraFocal(doc, i);
            return { id: i.id, kind: i.kind, name: i.label?.trim() || 'CAM', detail: join(i.shotIds.filter((id) => doc.shots[id]).map((id) => shotCode(doc, id)).join(', '), f ? `${f}mm` : '', beat(i.beat)) };
          }
          case 'actor': {
            const name = (i.characterId && doc.characters[i.characterId]?.name) || i.label.trim() || FLOOR_KIND_LABEL.actor;
            return { id: i.id, kind: i.kind, name, detail: join(i.to ? 'déplacement' : '', beat(i.beat)) };
          }
          case 'light':
            return { id: i.id, kind: i.kind, practical: i.practical, kelvin: i.kelvin, name: i.label?.trim() || 'L', detail: join(i.practical ? 'Lampe de jeu' : i.model, lightSpecs(i)) || FLOOR_KIND_LABEL.light };
          case 'reflector':
          case 'diffuser':
          case 'flag':
            return { id: i.id, kind: i.kind, name: i.label ?? '', detail: join(FLOOR_KIND_LABEL[i.kind], formatMeters(itemLength(i))) };
          default:
            return { id: i.id, kind: i.kind, name: FLOOR_KIND_LABEL[i.kind], detail: 'x2' in i ? formatMeters(itemLength(i)) : '' };
        }
      }),
  );
}

/** Décor de la vue en bref : « 4 murs · 1 porte · 2 fenêtres » (vide sans décor). */
export function decorSummary(items: readonly FloorItem[]): string {
  const n = (k: FloorKind) => items.filter((i) => i.kind === k).length;
  const word = (c: number, one: string, many: string) => (c ? `${c} ${c > 1 ? many : one}` : '');
  return [word(n('wall'), 'mur', 'murs'), word(n('door'), 'porte', 'portes'), word(n('window'), 'fenêtre', 'fenêtres')].filter(Boolean).join(' · ');
}

/** Couche de dessin : murs et rails, puis portes et fenêtres (qui ouvrent le mur), puis le reste. */
const drawLayer = (i: FloorItem) => (i.kind === 'wall' || i.kind === 'rail' ? 0 : i.kind === 'door' || i.kind === 'window' ? 1 : 2);

/** Ordre de dessin, quel que soit l'ordre de création ; à couche égale, l'ordre d'origine. */
export function drawOrder<T extends FloorItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => drawLayer(a) - drawLayer(b));
}

/**
 * Nom d'un comédien sur le plan : le personnage seul quand il en a un (le repère numérique posé
 * automatiquement ferait doublon) ; un repère choisi à la main reste devant : « Doublure · Léa ».
 */
export function actorCaption(doc: ProjectDoc, actor: Pick<Extract<FloorItem, { kind: 'actor' }>, 'label' | 'characterId'>): string {
  const name = actor.characterId ? doc.characters[actor.characterId]?.name : undefined;
  const label = actor.label.trim();
  if (!name) return label;
  return !label || /^\d+$/.test(label) || label === name ? name : `${label} · ${name}`;
}

/**
 * Comédiens dans le champ d'une caméra (écart à l'axe ≤ demi-angle), du plus proche au plus loin,
 * avec la distance en mètres arrondie à 5 cm. Une caméra posée à un temps du plan-séquence ne voit
 * que les comédiens de ce temps ou fixes.
 */
export function subjectDistances(
  doc: ProjectDoc,
  cam: Extract<FloorItem, { kind: 'camera' }>,
  items: readonly FloorItem[],
): Array<{ id: ID; name: string; meters: number }> {
  const half = Math.min(170, cameraCone(doc, cam).fov) / 2;
  return items
    .filter((a): a is Extract<FloorItem, { kind: 'actor' }> => a.kind === 'actor' && (!cam.beat || !a.beat || a.beat === cam.beat))
    .map((a) => {
      const d = Math.hypot(a.x - cam.x, a.y - cam.y);
      const dir = (Math.atan2(a.y - cam.y, a.x - cam.x) * 180) / Math.PI;
      const off = Math.abs(((((dir - cam.rot) % 360) + 540) % 360) - 180);
      return { a, d, off };
    })
    .filter((x) => x.d >= 1 && x.off <= half + 1e-9)
    .sort((x, y) => x.d - y.d)
    .map(({ a, d }) => ({ id: a.id, name: actorCaption(doc, a) || FLOOR_KIND_LABEL.actor, meters: Math.round(d / 5) / 20 }));
}

/** Repère d'une copie : la lettre ou le numéro libre suivant (« CAM B », « L2 »), sinon le même. */
function copyLabel(items: readonly FloorItem[], label: string): string {
  if (/^CAM [A-Z]$/.test(label)) return nextLabel(items, (n) => `CAM ${String.fromCharCode(64 + Math.min(n, 26))}`);
  const m = /^(.*?)(\d+)$/.exec(label);
  return m ? nextLabel(items, (n) => `${m[1]}${n}`) : label;
}

/**
 * Copie des éléments, décalée de `offset` (cm) : nouveaux identifiants et repères libres suivants ;
 * une caméra copiée ne couvre aucun plan (un plan reste couvert une fois) ; les murs de la pièce ne
 * se copient pas. Renvoie les identifiants des copies.
 */
export function duplicateFloorItems(doc: ProjectDoc, planKey: string, ids: readonly ID[], offset = 40): ID[] {
  const plan = ensure(doc, planKey);
  const set = new Set(ids);
  const src = plan.items.filter((i) => set.has(i.id) && !isRoomWall(i));
  const out: ID[] = [];
  for (const i of src) {
    const copy = { ...(JSON.parse(JSON.stringify(i)) as FloorItem), id: newId() };
    if (copy.kind === 'camera') copy.shotIds = [];
    if ('label' in copy && copy.label) copy.label = copyLabel(plan.items, copy.label);
    plan.items.push(copy);
    out.push(copy.id);
  }
  // Décalage d'un bloc, arrêté au bord de l'espace de travail.
  moveFloorItems(doc, planKey, out, offset, offset);
  return out;
}

// --- Lumière : faisceau et réflecteurs ------------------------------------------------------

export const DEFAULT_SPREAD = 50;
export const DEFAULT_RANGE = 280;

type Light = Extract<FloorItem, { kind: 'light' }>;
type Reflector = Extract<FloorItem, { kind: 'reflector' | 'diffuser' | 'flag' }>;

export interface Beam {
  /** Source du faisceau (lumière ou réflecteur). */
  sourceId: ID;
  x: number;
  y: number;
  rot: number;
  spread: number;
  range: number;
  /** 1 = lumière directe ; < 1 = lumière renvoyée ou diffusée, plus douce. */
  intensity: number;
  /** Lumière douce (après un diffuseur ou un réflecteur). */
  soft?: boolean;
  /** Température de couleur de la source d'origine (K) : renvoyée ou diffusée, la lumière la garde. */
  kelvin?: number;
  points: Point[];
}

/**
 * Dégradé d'un faisceau, du pied de la source au bout de sa portée : décalage (0 à 1) et opacité
 * de chaque arrêt. Le même à l'écran et à l'export ; la lumière douce s'étale plus loin, moins dense.
 */
export function beamStops(b: Pick<Beam, 'intensity' | 'soft'>): Array<{ offset: number; opacity: number }> {
  return [
    { offset: 0, opacity: Math.min(0.85, (b.soft ? 0.32 : 0.55) * b.intensity) },
    { offset: b.soft ? 0.8 : 0.6, opacity: Math.min(0.5, (b.soft ? 0.18 : 0.22) * b.intensity) },
    { offset: 1, opacity: 0 },
  ];
}

export function lightBeam(l: Light): Beam {
  const spread = l.spread ?? DEFAULT_SPREAD;
  const range = l.range ?? DEFAULT_RANGE;
  return {
    sourceId: l.id,
    x: l.x,
    y: l.y,
    rot: l.rot,
    spread,
    range,
    intensity: 1,
    kelvin: l.kelvin,
    points: conePoints(l.x, l.y, l.rot, spread, range),
  };
}

/** Taille d'un réflecteur (longueur du segment). */
export const reflectorSize = (r: Reflector) => Math.hypot(r.x2 - r.x, r.y2 - r.y);

/**
 * Lumière renvoyée par les réflecteurs touchés par un faisceau : réflexion autour de la normale du
 * réflecteur, diffusion d'autant plus large et douce que le réflecteur est grand.
 */
export function reflections(items: readonly FloorItem[]): Beam[] {
  const out: Beam[] = [];
  const lights = items.filter((i): i is Light => i.kind === 'light');
  const refls = items.filter((i): i is Reflector => i.kind === 'reflector');
  for (const l of lights) {
    const b = lightBeam(l);
    for (const r of refls) {
      const mx = (r.x + r.x2) / 2;
      const my = (r.y + r.y2) / 2;
      const dx = mx - l.x;
      const dy = my - l.y;
      const d = Math.hypot(dx, dy);
      const size = reflectorSize(r);
      if (d < 1 || d > b.range || size < 1) continue;
      const toRefl = (Math.atan2(dy, dx) * 180) / Math.PI;
      const off = Math.abs(((((toRefl - b.rot) % 360) + 540) % 360) - 180);
      if (off > b.spread / 2) continue;
      const ix = dx / d;
      const iy = dy / d;
      const tx = (r.x2 - r.x) / size;
      const ty = (r.y2 - r.y) / size;
      let nx = -ty;
      let ny = tx;
      const dot = ix * nx + iy * ny;
      if (dot > 0) {
        nx = -nx;
        ny = -ny;
      }
      const k = ix * nx + iy * ny;
      const rx = ix - 2 * k * nx;
      const ry = iy - 2 * k * ny;
      const rot = (Math.atan2(ry, rx) * 180) / Math.PI;
      const spread = Math.max(30, Math.min(160, 30 + size * 0.6));
      const range = Math.max(60, (b.range - d) * 0.7 + size * 0.5);
      // Plus le réflecteur est grand par rapport à la distance, plus il renvoie de lumière.
      const intensity = Math.max(0.15, Math.min(0.7, (size / d) * 0.9));
      out.push({
        sourceId: r.id,
        x: mx,
        y: my,
        rot,
        spread,
        range,
        intensity,
        kelvin: l.kelvin,
        points: conePoints(mx, my, rot, spread, range),
      });
    }
  }
  return out;
}

/** Trajectoire d'un plan-séquence : positions successives d'une caméra ou d'un comédien, temps par temps. */
export interface ChoreoPath {
  kind: 'camera' | 'actor';
  key: string;
  points: Array<Point & { beat: number }>;
}

/**
 * Relie, dans l'ordre des temps (T1, T2…), les positions d'une même caméra (même plan couvert)
 * et d'un même comédien. Les éléments sans temps restent fixes et ne sont pas reliés.
 */
export function choreography(items: readonly FloorItem[]): ChoreoPath[] {
  const groups = new Map<string, ChoreoPath>();
  for (const it of items) {
    if ((it.kind !== 'camera' && it.kind !== 'actor') || !it.beat) continue;
    const key = it.kind === 'camera' ? `cam:${it.shotIds[0] || it.label?.trim() || ''}` : `act:${it.characterId || it.label.trim()}`;
    const g = groups.get(key) ?? { kind: it.kind, key, points: [] };
    g.points.push({ x: it.x, y: it.y, beat: it.beat });
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, points: g.points.sort((a, b) => a.beat - b.beat) })).filter((g) => g.points.length > 0);
}

/** Distance le long d'un rayon jusqu'à un segment (ou Infinity). */
function rayToSegment(x: number, y: number, dx: number, dy: number, s: Reflector): number {
  const ex = s.x2 - s.x;
  const ey = s.y2 - s.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((s.x - x) * ey - (s.y - y) * ex) / den;
  const u = ((s.x - x) * dy - (s.y - y) * dx) / den;
  return t > 0.5 && u >= 0 && u <= 1 ? t : Infinity;
}

type Seg = { x: number; y: number; x2: number; y2: number };

/** Direction (degrés) d'un rayon d'angle `ang` réfléchi sur le segment. */
function mirror(ang: number, seg: Seg): number {
  const ix = Math.cos((ang * Math.PI) / 180);
  const iy = Math.sin((ang * Math.PI) / 180);
  const len = Math.hypot(seg.x2 - seg.x, seg.y2 - seg.y) || 1;
  let nx = -(seg.y2 - seg.y) / len;
  let ny = (seg.x2 - seg.x) / len;
  if (ix * nx + iy * ny > 0) [nx, ny] = [-nx, -ny];
  const k = ix * nx + iy * ny;
  return (Math.atan2(iy - 2 * k * ny, ix - 2 * k * nx) * 180) / Math.PI;
}

/**
 * Éclairage complet d'une vue, lancé rayon par rayon : le faisceau s'arrête net là où un drapeau,
 * un mur ou un comédien l'intercepte (le reste passe) ; la part qui touche un diffuseur repart plus
 * large et plus douce, celle qui touche un réflecteur ou un mur blanc est renvoyée. Ces lumières
 * secondaires sont elles-mêmes lancées rayon par rayon : drapeaux, murs et comédiens les coupent,
 * diffuseurs et réflecteurs les transforment à leur tour.
 */
export function computeLighting(items: readonly FloorItem[]): { beams: Beam[]; shadows: Point[][] } {
  const beams: Beam[] = [];
  const mods = items.filter((i): i is Reflector => i.kind === 'diffuser' || i.kind === 'flag' || i.kind === 'reflector');
  const walls = items.filter((i): i is Extract<FloorItem, { kind: 'wall' | 'rail' }> => i.kind === 'wall');
  const actors = items.filter((i): i is Extract<FloorItem, { kind: 'actor' }> => i.kind === 'actor');
  type HitKind = 'diffuser' | 'flag' | 'reflector' | 'wall' | 'actor';
  const MAX_DEPTH = 2;

  const emit = (b: Beam, depth: number, from?: ID) => {
    const N = Math.max(60, Math.min(360, Math.round(b.spread * 1.8)));
    const pts: Point[] = [{ x: b.x, y: b.y }];
    // Impacts groupés par obstacle qui renvoie ou transforme la lumière (diffuseur, réflecteur, mur blanc).
    const hits = new Map<ID, { kind: 'diffuser' | 'reflector' | 'wall'; seg: Seg; list: Array<{ x: number; y: number; ang: number; t: number }> }>();
    for (let k = 0; k <= N; k++) {
      const ang = b.rot - b.spread / 2 + (b.spread * k) / N;
      const dx = Math.cos((ang * Math.PI) / 180);
      const dy = Math.sin((ang * Math.PI) / 180);
      let t = b.range;
      let hit: { id: ID; kind: HitKind; seg?: Seg; white?: boolean } | undefined;
      for (const m of mods) {
        if (m.id === from) continue;
        const d = rayToSegment(b.x, b.y, dx, dy, m);
        if (d < t) {
          t = d;
          hit = { id: m.id, kind: m.kind, seg: m };
        }
      }
      for (const w of walls) {
        if (w.id === from) continue;
        const d = rayToSegment(b.x, b.y, dx, dy, w as unknown as Reflector);
        if (d < t) {
          t = d;
          hit = { id: w.id, kind: 'wall', seg: w, white: w.white };
        }
      }
      // Les comédiens arrêtent la lumière (cercle d'épaules ≈ 14 unités).
      for (const a of actors) {
        const fx = a.x - b.x;
        const fy = a.y - b.y;
        const proj = fx * dx + fy * dy;
        const dist2 = fx * fx + fy * fy - proj * proj;
        if (proj > 0 && dist2 < 14 * 14) {
          const d = proj - Math.sqrt(14 * 14 - dist2);
          if (d > 1 && d < t) {
            t = d;
            hit = { id: a.id, kind: 'actor' };
          }
        }
      }
      pts.push({ x: b.x + dx * t, y: b.y + dy * t });
      if (hit?.seg && (hit.kind === 'diffuser' || hit.kind === 'reflector' || (hit.kind === 'wall' && hit.white))) {
        const g = hits.get(hit.id) ?? { kind: hit.kind, seg: hit.seg, list: [] };
        g.list.push({ x: b.x + dx * t, y: b.y + dy * t, ang, t });
        hits.set(hit.id, g);
      }
    }
    beams.push({ ...b, points: pts });
    if (depth >= MAX_DEPTH) return;
    for (const [id, g] of hits) {
      const n = g.list.length;
      const mx = g.list.reduce((s, h) => s + h.x, 0) / n;
      const my = g.list.reduce((s, h) => s + h.y, 0) / n;
      const ang = g.list.reduce((s, h) => s + h.ang, 0) / n;
      const share = n / (N + 1);
      const travelled = g.list.reduce((s, h) => s + h.t, 0) / n;
      let next: Omit<Beam, 'points' | 'sourceId' | 'x' | 'y'>;
      if (g.kind === 'diffuser') {
        const range = Math.max(140, (b.range - travelled) * 1.1 + 40);
        const spread = Math.min(170, Math.max(110, b.spread * 2.2));
        next = { rot: ang, spread, range, intensity: b.intensity * 0.8 * Math.max(0.5, share) };
      } else if (g.kind === 'reflector') {
        // Plus le réflecteur est grand par rapport à la distance, plus il renvoie de lumière.
        const size = Math.hypot(g.seg.x2 - g.seg.x, g.seg.y2 - g.seg.y);
        const spread = Math.max(30, Math.min(160, 30 + size * 0.6));
        const range = Math.max(60, (b.range - travelled) * 0.7 + size * 0.5);
        const intensity = b.intensity * Math.max(0.15, Math.min(0.7, (size / Math.max(1, travelled)) * 0.9));
        next = { rot: mirror(ang, g.seg), spread, range, intensity };
      } else {
        // Mur blanc : faible renvoi diffus, symétrique du rayon moyen par rapport au mur.
        const range = Math.max(80, (b.range - travelled) * 0.6 + 30);
        next = { rot: mirror(ang, g.seg), spread: 150, range, intensity: b.intensity * 0.3 * Math.max(0.4, share) };
      }
      if (next.intensity < 0.06) continue;
      emit({ ...next, sourceId: id, x: mx, y: my, soft: true, kelvin: b.kelvin, points: [] }, depth + 1, id);
    }
  };

  for (const l of items.filter((i): i is Light => i.kind === 'light')) {
    emit({ ...lightBeam(l), intensity: Math.max(0.2, Math.min(1.6, l.power ?? 1)) }, 0);
  }
  return { beams, shadows: [] };
}
