import { newId } from './factory';
import { horizontalFov } from './focal';
import type { ID, ProjectDoc } from './types';

export interface Point {
  x: number;
  y: number;
}

export type FloorItem =
  | { id: ID; kind: 'camera'; x: number; y: number; rot: number; shotIds: ID[]; label?: string; beat?: number }
  | { id: ID; kind: 'actor'; x: number; y: number; characterId?: ID; label: string; to?: Point; beat?: number; rot?: number }
  | { id: ID; kind: 'wall' | 'rail'; x: number; y: number; x2: number; y2: number; /** Mur blanc : renvoie un peu de lumière. */ white?: boolean }
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
    .map((id) => ({ key: oneShotPlanKey(id), shotId: id, name: `Plan-séquence ${doc.project.sequenceIds.indexOf(seqId) + 1}.${seq.shotIds.indexOf(id) + 1}` }));
}

export function addPlan(doc: ProjectDoc, seqId: ID): string {
  const key = newId();
  doc.floorPlans ??= {};
  doc.floorPlans[key] = { items: [], seqId, name: `Vue ${plansOf(doc, seqId).length + 1}` };
  return key;
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
      p.items = [];
      p.name = undefined;
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

/** Crée un élément à la position donnée et renvoie son identifiant. */
export function addFloorItem(doc: ProjectDoc, seqId: ID, kind: FloorKind, at: Point, end?: Point): ID {
  const plan = ensure(doc, seqId);
  const p = clampPoint({ x: snap(at.x), y: snap(at.y) });
  const id = newId();
  const n = plan.items.filter((i) => i.kind === kind).length + 1;
  switch (kind) {
    case 'camera':
      plan.items.push({ id, kind, ...p, rot: -90, shotIds: [], label: `CAM ${String.fromCharCode(64 + n)}` });
      break;
    case 'actor':
      // Orientation : 90° = regarde vers le bas du plan.
      plan.items.push({ id, kind, ...p, label: String(n), rot: 90 });
      break;
    case 'wall':
    case 'rail':
    case 'reflector':
    case 'diffuser':
    case 'flag': {
      const e = clampPoint(end ? { x: snap(end.x), y: snap(end.y) } : { x: p.x + 160, y: p.y });
      plan.items.push(
        kind === 'reflector' || kind === 'diffuser' || kind === 'flag'
          ? { id, kind, ...p, x2: e.x, y2: e.y, label: `${kind === 'reflector' ? 'R' : kind === 'diffuser' ? 'D' : 'N'}${n}` }
          : { id, kind, ...p, x2: e.x, y2: e.y },
      );
      break;
    }
    case 'door':
    case 'window':
      plan.items.push({ id, kind, ...p, rot: 0, width: kind === 'door' ? 80 : 120 });
      break;
    case 'light':
      plan.items.push({
        id,
        kind,
        ...p,
        rot: 90,
        label: `L${n}`,
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
  if (i >= 0) plan.items[i] = { ...plan.items[i], ...patch } as FloorItem;
}

export function moveFloorItem(doc: ProjectDoc, seqId: ID, id: ID, dx: number, dy: number): void {
  const item = ensure(doc, seqId).items.find((x) => x.id === id);
  if (!item) return;
  item.x = clampV(item.x + dx);
  item.y = clampV(item.y + dy);
  if ('x2' in item) {
    item.x2 = clampV(item.x2 + dx);
    item.y2 = clampV(item.y2 + dy);
  }
  if (item.kind === 'actor' && item.to) item.to = clampPoint({ x: item.to.x + dx, y: item.to.y + dy });
}

export function removeFloorItem(doc: ProjectDoc, seqId: ID, id: ID): void {
  const plan = ensure(doc, seqId);
  plan.items = plan.items.filter((x) => x.id !== id);
}

/** Focale de la caméra : celle du premier plan lié (départ du zoom le cas échéant). */
export function cameraFocal(
  doc: ProjectDoc,
  cam: Extract<FloorItem, { kind: 'camera' }>,
): number | undefined {
  for (const id of cam.shotIds) {
    const f = doc.shots[id]?.focal.from ?? doc.shots[id]?.focal.to;
    if (f) return f;
  }
  return undefined;
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
  const seqId = doc.shots[shotId]?.sequenceId;
  if (!seqId) return [];
  return plansOf(doc, seqId)
    .flatMap((ref) => planOf(doc, ref.key).items)
    .filter(
      (i): i is Extract<FloorItem, { kind: 'camera' }> => i.kind === 'camera' && i.shotIds.includes(shotId),
    )
    .map((c) => c.label ?? 'CAM');
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
  points: Point[];
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
    const key = it.kind === 'camera' ? `cam:${it.shotIds[0] ?? it.label ?? ''}` : `act:${it.characterId ?? it.label}`;
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
    const N = Math.max(60, Math.round(b.spread * 1.8));
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
      emit({ ...next, sourceId: id, x: mx, y: my, soft: true, points: [] }, depth + 1, id);
    }
  };

  for (const l of items.filter((i): i is Light => i.kind === 'light')) {
    emit({ ...lightBeam(l), intensity: Math.max(0.2, Math.min(1.6, l.power ?? 1)) }, 0);
  }
  return { beams, shadows: [] };
}
