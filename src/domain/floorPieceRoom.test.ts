import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addSequence } from './ops';
import {
  addFloorItem,
  deletePlan,
  duplicatePlan,
  formatRoom,
  isRoomWall,
  moveFloorItem,
  moveFloorItems,
  planOf,
  removeFloorItem,
  roomDimensions,
  roomPreset,
  roomRect,
  setRoom,
  updateFloorItem,
  withRoomWalls,
  type FloorItem,
} from './floorplan';
import { floorPlanSvg } from './exports';

const setup = () => {
  const doc = createProjectDoc({ title: 'T', format: 'fiction' });
  const seq = addSequence(doc, undefined, { label: 'Salon' });
  return { doc, seq };
};
const roomWalls = (doc: ReturnType<typeof setup>['doc'], key: string) => planOf(doc, key).items.filter(isRoomWall);

describe('pièce du plan au sol', () => {
  it('modèles : dimensions lisibles, pièce personnalisée dès qu’une valeur diffère', () => {
    expect(formatRoom({ w: 5, l: 6, h: 2.5 })).toBe('5 × 6 × 2,5 m');
    expect(formatRoom({ w: 6, l: 7.5 })).toBe('6 × 7,5 m');
    expect(roomPreset({ w: 6, l: 7.5, h: 3 })).toBe('Moyenne');
    expect(roomPreset({ w: 6, l: 7.5 })).toBeUndefined();
    expect(roomPreset({ w: 8, l: 10, h: 4 })).toBeUndefined();
    expect(roomPreset(undefined)).toBeUndefined();
  });

  it('redimensionner garde le coin, les côtés retirés, les murs blancs et les autres éléments', () => {
    const { doc, seq } = setup();
    const cam = addFloorItem(doc, seq, 'camera', { x: 300, y: 300 });
    const free = addFloorItem(doc, seq, 'wall', { x: 900, y: 0 }, { x: 900, y: 200 });
    setRoom(doc, seq, { w: 5, l: 6, h: 2.5 });
    const ids = roomWalls(doc, seq).map((w) => w.id);
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 0, y: 0, w: 500, l: 600 });
    // La pièce déplacée par un de ses murs : tout suit, le reste ne bouge pas.
    moveFloorItem(doc, seq, ids[2], 100, 40);
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 100, y: 40, w: 500, l: 600 });
    expect(planOf(doc, seq).items.find((i) => i.id === cam)).toMatchObject({ x: 300, y: 300 });
    // Côté sud retiré, côté est blanc.
    const south = roomWalls(doc, seq).find((w) => w.side === 's')!;
    const east = roomWalls(doc, seq).find((w) => w.side === 'e')!;
    removeFloorItem(doc, seq, south.id);
    updateFloorItem(doc, seq, east.id, { white: true } as Partial<FloorItem>);
    setRoom(doc, seq, { w: 8, l: 10, h: 5 });
    const after = roomWalls(doc, seq);
    expect(after.map((w) => w.side).sort()).toEqual(['e', 'n', 'w']);
    expect(after.find((w) => w.side === 'e')).toMatchObject({ id: east.id, white: true, x: 900, y: 40, x2: 900, y2: 1040 });
    expect(after.find((w) => w.side === 'n')).toMatchObject({ x: 100, y: 40, x2: 900, y2: 40 });
    expect(planOf(doc, seq).room).toEqual({ w: 8, l: 10, h: 5 });
    expect(planOf(doc, seq).items.find((i) => i.id === free)).toMatchObject({ x: 900, y: 0, x2: 900, y2: 200 });
    expect(planOf(doc, seq).items.find((i) => i.id === cam)).toMatchObject({ x: 300, y: 300 });
  });

  it('un groupe qui contient un mur de la pièce déplace toute la pièce, une seule fois', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    const cam = addFloorItem(doc, seq, 'camera', { x: 200, y: 200 });
    const [n] = roomWalls(doc, seq);
    expect(withRoomWalls(planOf(doc, seq).items, [n.id, cam])).toHaveLength(5);
    expect(withRoomWalls(planOf(doc, seq).items, [cam])).toEqual([cam]);
    moveFloorItems(doc, seq, [n.id, cam], 20, 20);
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 20, y: 20, w: 500, l: 600 });
    expect(planOf(doc, seq).items.find((i) => i.id === cam)).toMatchObject({ x: 220, y: 220 });
  });

  it('retirer la pièce, ou son dernier mur, ne laisse rien d’autre disparaître', () => {
    const { doc, seq } = setup();
    const free = addFloorItem(doc, seq, 'wall', { x: 0, y: 0 }, { x: 200, y: 0 });
    setRoom(doc, seq, { w: 5, l: 6 });
    for (const w of roomWalls(doc, seq)) removeFloorItem(doc, seq, w.id);
    expect(planOf(doc, seq).room).toBeUndefined();
    expect(planOf(doc, seq).items.map((i) => i.id)).toEqual([free]);
    setRoom(doc, seq, { w: 5, l: 6 });
    setRoom(doc, seq, undefined);
    expect(planOf(doc, seq).room).toBeUndefined();
    expect(planOf(doc, seq).items.map((i) => i.id)).toEqual([free]);
  });

  it('cotes : largeur au-dessus, longueur à gauche, valeurs en mètres à la virgule', () => {
    const { doc, seq } = setup();
    expect(roomDimensions(planOf(doc, seq))).toEqual([]);
    setRoom(doc, seq, { w: 6, l: 7.5, h: 3 });
    const [width, length] = roomDimensions(planOf(doc, seq));
    expect(width).toMatchObject({ x1: 0, y1: -40, x2: 600, y2: -40, label: '6 m', rot: 0 });
    expect(length).toMatchObject({ x1: -40, y1: 0, x2: -40, y2: 750, label: '7,5 m', rot: -90 });
  });

  it('murs de pièce tracés avant la notation des côtés : retrouvés d’après leur position', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    for (const w of roomWalls(doc, seq)) delete (w as { side?: string }).side;
    moveFloorItem(doc, seq, roomWalls(doc, seq)[1].id, 40, 60);
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 40, y: 60, w: 500, l: 600 });
    setRoom(doc, seq, { w: 4, l: 3 });
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 40, y: 60, w: 400, l: 300 });
    expect(roomWalls(doc, seq).map((w) => w.side)).toEqual(['n', 'e', 's', 'w']);
  });

  it('vue dupliquée : la pièce suit ; vue vidée : la pièce part avec ses murs', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 6, l: 7.5, h: 3 });
    const copy = duplicatePlan(doc, seq, seq);
    expect(planOf(doc, copy).room).toEqual({ w: 6, l: 7.5, h: 3 });
    expect(roomRect(planOf(doc, copy))).toEqual({ x: 0, y: 0, w: 600, l: 750 });
    deletePlan(doc, copy);
    deletePlan(doc, seq);
    expect(planOf(doc, seq).room).toBeUndefined();
    expect(planOf(doc, seq).items).toEqual([]);
  });

  it('export : les cotes sont dessinées et le cadre les contient', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 6, l: 7.5 });
    const svg = floorPlanSvg(doc, seq, 'Salon');
    expect(svg).toContain('>6 m</text>');
    expect(svg).toContain('>7,5 m</text>');
    expect(svg).toContain('rotate(-90 ');
    const [x0, y0] = svg.match(/viewBox="([-\d.]+) ([-\d.]+)/)!.slice(1).map(Number);
    expect(x0).toBeLessThan(-60);
    expect(y0).toBeLessThan(-60);
  });
});
