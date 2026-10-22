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
  bg?: { blobKey: string; opacity: number; x: number; y: number; w: number };
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
export const clampPoint = (p: Point): Point => ({
  x: Math.max(0, Math.min(PLAN_W, p.x)),
  y: Math.max(0, Math.min(PLAN_H, p.y)),
});

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
  item.x = Math.max(0, Math.min(PLAN_W, item.x + dx));
  item.y = Math.max(0, Math.min(PLAN_H, item.y + dy));
  if ('x2' in item) {
    item.x2 = Math.max(0, Math.min(PLAN_W, item.x2 + dx));
    item.y2 = Math.max(0, Math.min(PLAN_H, item.y2 + dy));
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

/**
 * Éclairage complet d'une vue, lancé rayon par rayon : le faisceau s'arrête net là où un drapeau
 * l'intercepte (le reste passe), et la part qui touche un diffuseur repart plus large et plus douce.
 */
export function computeLighting(items: readonly FloorItem[]): { beams: Beam[]; shadows: Point[][] } {
  const beams: Beam[] = [];
  const mods = items.filter((i): i is Reflector => i.kind === 'diffuser' || i.kind === 'flag');
  const walls = items.filter((i): i is Extract<FloorItem, { kind: 'wall' | 'rail' }> => i.kind === 'wall');
  const actors = items.filter((i): i is Extract<FloorItem, { kind: 'actor' }> => i.kind === 'actor');
  const N = 90;
  for (const l of items.filter((i): i is Light => i.kind === 'light')) {
    const b = { ...lightBeam(l), intensity: Math.max(0.2, Math.min(1.6, l.power ?? 1)) };
    const pts: Point[] = [{ x: b.x, y: b.y }];
    // Impacts groupés par obstacle qui renvoie ou transforme la lumière (diffuseur, mur blanc).
    const hits = new Map<ID, { kind: 'diffuser' | 'wall'; seg: { x: number; y: number; x2: number; y2: number }; list: Array<{ x: number; y: number; ang: number; t: number }> }>();
    for (let k = 0; k <= N; k++) {
      const ang = b.rot - b.spread / 2 + (b.spread * k) / N;
      const dx = Math.cos((ang * Math.PI) / 180);
      const dy = Math.sin((ang * Math.PI) / 180);
      let t = b.range;
      let hit: { id: ID; kind: 'diffuser' | 'flag' | 'wall' | 'actor'; seg?: { x: number; y: number; x2: number; y2: number }; white?: boolean } | undefined;
      for (const m of mods) {
        const d = rayToSegment(b.x, b.y, dx, dy, m);
        if (d < t) {
          t = d;
          hit = { id: m.id, kind: m.kind as 'diffuser' | 'flag', seg: m };
        }
      }
      for (const w of walls) {
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
      if (hit && hit.seg && (hit.kind === 'diffuser' || (hit.kind === 'wall' && hit.white))) {
        const g = hits.get(hit.id) ?? { kind: hit.kind as 'diffuser' | 'wall', seg: hit.seg, list: [] };
        g.list.push({ x: b.x + dx * t, y: b.y + dy * t, ang, t });
        hits.set(hit.id, g);
      }
    }
    beams.push({ ...b, points: pts });
    for (const [id, g] of hits) {
      const n = g.list.length;
      const mx = g.list.reduce((s, h) => s + h.x, 0) / n;
      const my = g.list.reduce((s, h) => s + h.y, 0) / n;
      const ang = g.list.reduce((s, h) => s + h.ang, 0) / n;
      const share = n / (N + 1);
      const travelled = g.list.reduce((s, h) => s + h.t, 0) / n;
      if (g.kind === 'diffuser') {
        const rest = Math.max(140, (b.range - travelled) * 1.1 + 40);
        const spread = Math.min(170, Math.max(110, b.spread * 2.2));
        beams.push({ sourceId: id, x: mx, y: my, rot: ang, spread, range: rest, intensity: b.intensity * 0.8 * Math.max(0.5, share), soft: true, points: conePoints(mx, my, ang, spread, rest) });
      } else {
        // Mur blanc : faible renvoi diffus, symétrique du rayon moyen par rapport au mur.
        const ix = Math.cos((ang * Math.PI) / 180);
        const iy = Math.sin((ang * Math.PI) / 180);
        const len = Math.hypot(g.seg.x2 - g.seg.x, g.seg.y2 - g.seg.y) || 1;
        let nx = -(g.seg.y2 - g.seg.y) / len;
        let ny = (g.seg.x2 - g.seg.x) / len;
        if (ix * nx + iy * ny > 0) [nx, ny] = [-nx, -ny];
        const k = ix * nx + iy * ny;
        const rot = (Math.atan2(iy - 2 * k * ny, ix - 2 * k * nx) * 180) / Math.PI;
        const range = Math.max(80, (b.range - travelled) * 0.6 + 30);
        beams.push({ sourceId: id, x: mx, y: my, rot, spread: 150, range, intensity: b.intensity * 0.3 * Math.max(0.4, share), soft: true, points: conePoints(mx, my, rot, 150, range) });
      }
    }
  }
  return { beams: [...beams, ...reflections(items).map((r) => ({ ...r, soft: true }))], shadows: [] };
}
