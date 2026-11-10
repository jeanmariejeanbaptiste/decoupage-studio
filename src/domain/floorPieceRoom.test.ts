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
  roomOf,
  roomPreset,
  roomValid,
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
    setRoom(doc, seq, { w: 5, l: 6, h: 2.5 });
    const free = addFloorItem(doc, seq, 'wall', { x: 900, y: 0 }, { x: 900, y: 200 });
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
    expect(width).toMatchObject({ x1: 0, y1: -32, x2: 600, y2: -32, label: '6 m', rot: 0 });
    expect(length).toMatchObject({ x1: -32, y1: 0, x2: -32, y2: 750, label: '7,5 m', rot: -90 });
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

  it('dimensions bornées : une saisie hors bornes ne touche à rien', () => {
    const { doc, seq } = setup();
    expect(roomValid({ w: 4.5, l: 3.8, h: 2.5 })).toBe(true);
    expect(roomValid({ w: 450, l: 380 })).toBe(false);
    expect(roomValid({ w: 0.004, l: 3 })).toBe(false);
    expect(roomValid({ w: 4, l: 3, h: 50 })).toBe(false);
    setRoom(doc, seq, { w: 5, l: 6 });
    setRoom(doc, seq, { w: 450, l: 380 });
    setRoom(doc, seq, { w: 0.004, l: 3 });
    expect(planOf(doc, seq).room).toEqual({ w: 5, l: 6 });
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 0, y: 0, w: 500, l: 600 });
  });

  it('pièce poussée contre la limite du monde : elle s’arrête d’un bloc sans se déformer', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 6, l: 5 });
    const [n] = roomWalls(doc, seq);
    moveFloorItems(doc, seq, [n.id], -3800, 0);
    moveFloorItems(doc, seq, [n.id], -400, 0);
    const north = roomWalls(doc, seq).find((w) => w.side === 'n')!;
    expect([north.x, north.x2]).toEqual([-4000, -3400]);
    expect(roomRect(planOf(doc, seq))).toEqual({ x: -4000, y: 0, w: 600, l: 500 });
  });

  it('portes et fenêtres percées dans la pièce la suivent ; celles posées ailleurs restent', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    const door = addFloorItem(doc, seq, 'door', { x: 200, y: 600 });
    const win = addFloorItem(doc, seq, 'window', { x: 0, y: 300 });
    const away = addFloorItem(doc, seq, 'door', { x: 200, y: 400 });
    const [n] = roomWalls(doc, seq);
    moveFloorItem(doc, seq, n.id, 100, 0);
    const at = (id: string) => planOf(doc, seq).items.find((i) => i.id === id);
    expect(at(door)).toMatchObject({ x: 300, y: 600 });
    expect(at(win)).toMatchObject({ x: 100, y: 300 });
    expect(at(away)).toMatchObject({ x: 200, y: 400 });
  });

  it('plan des locaux : la nouvelle pièce se pose au coin des murs importés, ou du fond', () => {
    const { doc, seq } = setup();
    addFloorItem(doc, seq, 'wall', { x: 1200, y: 800 }, { x: 2000, y: 800 });
    addFloorItem(doc, seq, 'wall', { x: 2000, y: 800 }, { x: 2000, y: 1400 });
    setRoom(doc, seq, { w: 5, l: 6 });
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 1200, y: 800, w: 500, l: 600 });
    const other = setup();
    other.doc.floorPlans = { [other.seq]: { items: [], bg: { blobKey: 'b', opacity: 0.5, x: -300.4, y: 120, w: 2000 } } };
    setRoom(other.doc, other.seq, { w: 4, l: 3 });
    expect(roomRect(planOf(other.doc, other.seq))).toEqual({ x: -300, y: 120, w: 400, l: 300 });
  });

  it('vue dupliquée avant que la pièce la suive : dimensions retrouvées d’après ses murs, position gardée', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    moveFloorItem(doc, seq, roomWalls(doc, seq)[0].id, 300, 200);
    delete planOf(doc, seq).room;
    expect(roomOf(planOf(doc, seq))).toEqual({ w: 5, l: 6 });
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 300, y: 200, w: 500, l: 600 });
    expect(roomDimensions(planOf(doc, seq)).map((d) => d.label)).toEqual(['5 m', '6 m']);
    setRoom(doc, seq, { w: 4, l: 3 });
    expect(planOf(doc, seq).room).toEqual({ w: 4, l: 3 });
    expect(roomRect(planOf(doc, seq))).toEqual({ x: 300, y: 200, w: 400, l: 300 });
  });

  it('export : sur un grand cadre, le texte des cotes grandit pour rester lisible', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 30, l: 20 });
    const size = Number(floorPlanSvg(doc, seq, 'Salon').match(/font-size="([\d.]+)"[^>]*>30 m</)![1]);
    expect(size).toBeGreaterThan(13 * 2);
    expect(roomDimensions(planOf(doc, seq), 2)[0]).toMatchObject({ y1: -64, font: 26, tick: 8 });
  });
});
