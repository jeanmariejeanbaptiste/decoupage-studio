import { newId } from './factory';
import { horizontalFov } from './focal';
import type { ID, ProjectDoc } from './types';

export interface Point {
  x: number;
  y: number;
}

export type FloorItem =
  | { id: ID; kind: 'camera'; x: number; y: number; rot: number; shotIds: ID[]; label?: string }
  | { id: ID; kind: 'actor'; x: number; y: number; characterId?: ID; label: string; to?: Point }
  | { id: ID; kind: 'wall' | 'rail'; x: number; y: number; x2: number; y2: number }
  | { id: ID; kind: 'door' | 'window'; x: number; y: number; rot: number; width: number }
  | { id: ID; kind: 'light'; x: number; y: number; rot: number; label?: string };

export type FloorKind = FloorItem['kind'];

export interface FloorPlan {
  items: FloorItem[];
}

export const PLAN_W = 1000;
export const PLAN_H = 640;
export const GRID = 20;

export const snap = (v: number, step = GRID) => Math.round(v / step) * step;
export const clampPoint = (p: Point): Point => ({ x: Math.max(0, Math.min(PLAN_W, p.x)), y: Math.max(0, Math.min(PLAN_H, p.y)) });

export function planOf(doc: ProjectDoc, seqId: ID): FloorPlan {
  return doc.floorPlans?.[seqId] ?? { items: [] };
}

function ensure(doc: ProjectDoc, seqId: ID): FloorPlan {
  doc.floorPlans ??= {};
  doc.floorPlans[seqId] ??= { items: [] };
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
      plan.items.push({ id, kind, ...p, label: String(n) });
      break;
    case 'wall':
    case 'rail': {
      const e = clampPoint(end ? { x: snap(end.x), y: snap(end.y) } : { x: p.x + 160, y: p.y });
      plan.items.push({ id, kind, ...p, x2: e.x, y2: e.y });
      break;
    }
    case 'door':
    case 'window':
      plan.items.push({ id, kind, ...p, rot: 0, width: kind === 'door' ? 80 : 120 });
      break;
    case 'light':
      plan.items.push({ id, kind, ...p, rot: 90, label: `L${n}` });
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
  if (item.kind === 'wall' || item.kind === 'rail') {
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
export function cameraFocal(doc: ProjectDoc, cam: Extract<FloorItem, { kind: 'camera' }>): number | undefined {
  for (const id of cam.shotIds) {
    const f = doc.shots[id]?.focal.from ?? doc.shots[id]?.focal.to;
    if (f) return f;
  }
  return undefined;
}

/** Polygone du cône de champ (vue de dessus) : sommet, puis arc échantillonné. */
export function conePoints(x: number, y: number, rotDeg: number, fovDeg: number, length: number, steps = 12): Point[] {
  const pts: Point[] = [{ x, y }];
  const half = Math.min(170, fovDeg) / 2;
  for (let i = 0; i <= steps; i++) {
    const a = ((rotDeg - half + (2 * half * i) / steps) * Math.PI) / 180;
    pts.push({ x: x + Math.cos(a) * length, y: y + Math.sin(a) * length });
  }
  return pts;
}

export function cameraCone(doc: ProjectDoc, cam: Extract<FloorItem, { kind: 'camera' }>, length = 260): { points: Point[]; fov: number; focal?: number } {
  const focal = cameraFocal(doc, cam);
  const fov = focal ? horizontalFov(focal, doc.project.settings.cropFactor) : 60;
  return { points: conePoints(cam.x, cam.y, cam.rot, fov, length), fov, focal };
}

/** Caméras du plan au sol liées à un plan. */
export function camerasForShot(doc: ProjectDoc, shotId: ID): string[] {
  const seqId = doc.shots[shotId]?.sequenceId;
  if (!seqId) return [];
  return planOf(doc, seqId)
    .items.filter((i): i is Extract<FloorItem, { kind: 'camera' }> => i.kind === 'camera' && i.shotIds.includes(shotId))
    .map((c) => c.label ?? 'CAM');
}
