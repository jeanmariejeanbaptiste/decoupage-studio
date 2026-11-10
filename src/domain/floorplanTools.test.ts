import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addSequence, addShot } from './ops';
import {
  actorCaption,
  addFloorItem,
  choreography,
  drawOrder,
  duplicateFloorItems,
  fitOpeningToWall,
  moveFloorItem,
  planInventory,
  planOf,
  setRoom,
  shotCameras,
  subjectDistances,
  updateFloorItem,
  type FloorItem,
} from './floorplan';
import { segmentLabelAt } from './floorSymbols';
import type { ProjectDoc } from './types';

const setup = () => {
  const doc = createProjectDoc({ title: 'T', format: 'fiction' });
  const seq = addSequence(doc, undefined, { label: 'Salon' });
  return { doc, seq };
};
const find = (doc: ProjectDoc, seq: string, id: string) => planOf(doc, seq).items.find((i) => i.id === id)!;
const addCharacter = (doc: ProjectDoc, id: string, name: string) => void (doc.characters[id] = { id, name, kind: 'principal' });

describe('portes et fenêtres sur les murs', () => {
  it('se couchent sur le mur le plus proche, tiennent sur sa longueur ; loin des murs, rien ne change', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    const east = addFloorItem(doc, seq, 'door', { x: 500, y: 300 });
    expect(find(doc, seq, east)).toMatchObject({ x: 500, y: 300, rot: 90 });
    const low = addFloorItem(doc, seq, 'door', { x: 500, y: 590 });
    expect(find(doc, seq, low)).toMatchObject({ x: 500, y: 520, rot: 90 });
    const west = addFloorItem(doc, seq, 'window', { x: 0, y: 300 });
    expect(find(doc, seq, west)).toMatchObject({ x: 0, y: 300, rot: -90 });
    const away = addFloorItem(doc, seq, 'door', { x: 200, y: 300 });
    expect(find(doc, seq, away)).toMatchObject({ x: 200, y: 300, rot: 0 });
  });

  it('une porte déplacée seule près d’un mur s’y couche ; tournée vers l’extérieur, elle le reste', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    const door = addFloorItem(doc, seq, 'door', { x: 200, y: 300 });
    moveFloorItem(doc, seq, door, 0, -300);
    expect(find(doc, seq, door)).toMatchObject({ x: 200, y: 0, rot: 0 });
    updateFloorItem(doc, seq, door, { rot: 180 } as Partial<FloorItem>);
    moveFloorItem(doc, seq, door, 20, 0);
    expect(find(doc, seq, door)).toMatchObject({ x: 220, y: 0, rot: 180 });
    expect(fitOpeningToWall(planOf(doc, seq).items, { x: 40, y: 0 }, 80, 180)).toEqual({ x: 80, y: 0, rot: 180 });
    // Écartée du mur d'un pas de grille : elle se détache.
    moveFloorItem(doc, seq, door, 0, 20);
    expect(find(doc, seq, door)).toMatchObject({ x: 220, y: 20, rot: 180 });
  });

  it('largeur bornée de 20 cm à 10 m', () => {
    const { doc, seq } = setup();
    const door = addFloorItem(doc, seq, 'door', { x: 200, y: 300 });
    updateFloorItem(doc, seq, door, { width: 5 } as Partial<FloorItem>);
    expect(find(doc, seq, door)).toMatchObject({ width: 20 });
    updateFloorItem(doc, seq, door, { width: 99999 } as Partial<FloorItem>);
    expect(find(doc, seq, door)).toMatchObject({ width: 1000 });
  });
});

describe('ordre de dessin, repères et noms', () => {
  it('murs puis portes puis le reste, ordre relatif gardé', () => {
    const items = [
      { id: 'd', kind: 'door' },
      { id: 'c', kind: 'camera' },
      { id: 'w', kind: 'wall' },
      { id: 'l', kind: 'light' },
      { id: 'r', kind: 'rail' },
    ] as FloorItem[];
    expect(drawOrder(items).map((i) => i.id)).toEqual(['w', 'r', 'd', 'c', 'l']);
  });

  it('repère d’un segment écarté du trait, au-dessus ou à gauche', () => {
    const v = segmentLabelAt({ x: 400, y: 100, x2: 400, y2: 220 }, 12);
    expect(400 - v.x).toBeGreaterThanOrEqual(12);
    expect(v.anchor).toBe('end');
    const h = segmentLabelAt({ x: 100, y: 50, x2: 300, y2: 50 }, 12);
    expect(h).toMatchObject({ x: 200, y: 38, anchor: 'middle' });
    // Sens du tracé indifférent.
    expect(segmentLabelAt({ x: 400, y: 220, x2: 400, y2: 100 }, 12)).toEqual(v);
  });

  it('comédien : le personnage seul, sauf repère choisi à la main', () => {
    const { doc } = setup();
    addCharacter(doc, 'lea', 'Léa');
    expect(actorCaption(doc, { label: '1', characterId: 'lea' })).toBe('Léa');
    expect(actorCaption(doc, { label: '1' })).toBe('1');
    expect(actorCaption(doc, { label: 'Doublure', characterId: 'lea' })).toBe('Doublure · Léa');
    expect(actorCaption(doc, { label: '', characterId: 'lea' })).toBe('Léa');
  });

  it('repère vidé : la caméra garde un nom', () => {
    const { doc, seq } = setup();
    const shot = addShot(doc, seq);
    const cam = addFloorItem(doc, seq, 'camera', { x: 0, y: 0 });
    updateFloorItem(doc, seq, cam, { shotIds: [shot], label: '' } as Partial<FloorItem>);
    expect(shotCameras(doc, shot)[0].label).toBe('CAM');
    expect(planInventory(doc, planOf(doc, seq).items)[0].name).toBe('CAM');
    const b = addFloorItem(doc, seq, 'camera', { x: 100, y: 0 });
    updateFloorItem(doc, seq, b, { label: '  ', beat: 1 } as Partial<FloorItem>);
    updateFloorItem(doc, seq, cam, { beat: 2 } as Partial<FloorItem>);
    expect(choreography(planOf(doc, seq).items).map((p) => p.key).sort()).toEqual([`cam:`, `cam:${shot}`].sort());
  });
});

describe('distance caméra → comédiens', () => {
  it('seuls les comédiens dans le champ, du plus proche au plus loin, à 5 cm près', () => {
    const { doc, seq } = setup();
    const cam = addFloorItem(doc, seq, 'camera', { x: 0, y: 0 });
    updateFloorItem(doc, seq, cam, { rot: 0 } as Partial<FloorItem>);
    addCharacter(doc, 'lea', 'Léa');
    const a = addFloorItem(doc, seq, 'actor', { x: 240, y: 0 });
    updateFloorItem(doc, seq, a, { characterId: 'lea' } as Partial<FloorItem>);
    addFloorItem(doc, seq, 'actor', { x: 300, y: 300 });
    addFloorItem(doc, seq, 'actor', { x: -100, y: 0 });
    addFloorItem(doc, seq, 'actor', { x: 380, y: 40 });
    const c = find(doc, seq, cam) as Extract<FloorItem, { kind: 'camera' }>;
    const list = subjectDistances(doc, c, planOf(doc, seq).items);
    expect(list.map((x) => [x.name, x.meters])).toEqual([
      ['Léa', 2.4],
      ['4', 3.8],
    ]);
  });

  it('plan-séquence : un comédien d’un autre temps est exclu', () => {
    const { doc, seq } = setup();
    const cam = addFloorItem(doc, seq, 'camera', { x: 0, y: 0 });
    updateFloorItem(doc, seq, cam, { rot: 0, beat: 1 } as Partial<FloorItem>);
    const a = addFloorItem(doc, seq, 'actor', { x: 200, y: 0 });
    updateFloorItem(doc, seq, a, { beat: 2 } as Partial<FloorItem>);
    addFloorItem(doc, seq, 'actor', { x: 300, y: 0 });
    const c = find(doc, seq, cam) as Extract<FloorItem, { kind: 'camera' }>;
    expect(subjectDistances(doc, c, planOf(doc, seq).items).map((x) => x.meters)).toEqual([3]);
  });
});

describe('dupliquer des éléments', () => {
  it('copies décalées, repères suivants, caméra sans plan, murs de la pièce exclus', () => {
    const { doc, seq } = setup();
    const shot = addShot(doc, seq);
    setRoom(doc, seq, { w: 5, l: 6 });
    const l1 = addFloorItem(doc, seq, 'light', { x: 100, y: 100 });
    updateFloorItem(doc, seq, l1, { watts: 650, spread: 30 } as Partial<FloorItem>);
    const cam = addFloorItem(doc, seq, 'camera', { x: 200, y: 200 });
    updateFloorItem(doc, seq, cam, { shotIds: [shot] } as Partial<FloorItem>);
    const wall = planOf(doc, seq).items.find((i) => i.kind === 'wall')!;
    const before = planOf(doc, seq).items.length;
    const ids = duplicateFloorItems(doc, seq, [l1, cam, wall.id]);
    expect(ids).toHaveLength(2);
    expect(planOf(doc, seq).items).toHaveLength(before + 2);
    expect(find(doc, seq, ids[0])).toMatchObject({ kind: 'light', label: 'L2', watts: 650, spread: 30, x: 140, y: 140 });
    expect(find(doc, seq, ids[1])).toMatchObject({ kind: 'camera', label: 'CAM B', shotIds: [], x: 240, y: 240 });
    expect(planOf(doc, seq).room).toEqual({ w: 5, l: 6 });
    expect(shotCameras(doc, shot)).toHaveLength(1);
  });
});

describe('cas limites relevés en relecture', () => {
  it('mur plus court que l’ouverture : elle ne s’y couche pas', () => {
    const { doc, seq } = setup();
    addFloorItem(doc, seq, 'wall', { x: 0, y: 0 }, { x: 60, y: 0 });
    const door = addFloorItem(doc, seq, 'door', { x: 20, y: 0 });
    expect(find(doc, seq, door)).toMatchObject({ x: 20, y: 0, rot: 0, width: 80 });
    expect(fitOpeningToWall(planOf(doc, seq).items, { x: 20, y: 0 }, 80)).toBeUndefined();
  });

  it('données anciennes : porte sans largeur, comédien sans repère', () => {
    const { doc, seq } = setup();
    setRoom(doc, seq, { w: 5, l: 6 });
    doc.floorPlans![seq].items.push(
      { id: 'old-door', kind: 'door', x: 200, y: 300, rot: 0 } as unknown as FloorItem,
      { id: 'old-actor', kind: 'actor', x: 100, y: 100, beat: 1 } as unknown as FloorItem,
    );
    moveFloorItem(doc, seq, 'old-door', 0, -300);
    expect(find(doc, seq, 'old-door')).toMatchObject({ x: 200, y: 0, rot: 0 });
    updateFloorItem(doc, seq, 'old-door', { rot: 0 } as Partial<FloorItem>);
    expect(find(doc, seq, 'old-door')).toMatchObject({ width: 80 });
    const actor = find(doc, seq, 'old-actor') as Extract<FloorItem, { kind: 'actor' }>;
    expect(actorCaption(doc, actor)).toBe('');
    expect(planInventory(doc, planOf(doc, seq).items).find((r) => r.id === 'old-actor')?.name).toBe('Comédien');
    expect(choreography(planOf(doc, seq).items)).toHaveLength(1);
  });

  it('caméras au-delà de CAM Z : CAM Z2, CAM Z3…', () => {
    const { doc, seq } = setup();
    let last = '';
    for (let k = 0; k < 27; k++) last = addFloorItem(doc, seq, 'camera', { x: k * 20, y: 0 });
    expect((find(doc, seq, last) as { label?: string }).label).toBe('CAM Z2');
    const [copy] = duplicateFloorItems(doc, seq, [last]);
    expect((find(doc, seq, copy) as { label?: string }).label).toBe('CAM Z3');
  });
});
