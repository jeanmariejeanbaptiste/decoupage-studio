import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addFloorItem, cameraCone, cameraFocal, camerasForShot, conePoints, moveFloorItem, planOf, removeFloorItem, snap, updateFloorItem, type FloorItem } from './floorplan';

describe('plan au sol', () => {
  const doc = buildRav3();
  const seqId = doc.project.sequenceIds[0];
  const shotId = doc.sequences[seqId].shotIds[0];

  it('ajoute, déplace, modifie et retire des éléments', () => {
    let cam = '';
    let wall = '';
    let actor = '';
    const next = produce(doc, (d) => {
      cam = addFloorItem(d, seqId, 'camera', { x: 103, y: 211 });
      wall = addFloorItem(d, seqId, 'wall', { x: 0, y: 0 }, { x: 405, y: 0 });
      actor = addFloorItem(d, seqId, 'actor', { x: 300, y: 300 });
      addFloorItem(d, seqId, 'rail', { x: 50, y: 50 });
      addFloorItem(d, seqId, 'door', { x: 50, y: 50 });
      addFloorItem(d, seqId, 'window', { x: 50, y: 50 });
      addFloorItem(d, seqId, 'light', { x: 50, y: 50 });
      updateFloorItem(d, seqId, cam, { shotIds: [shotId] } as Partial<FloorItem>);
      updateFloorItem(d, seqId, actor, { to: { x: 400, y: 300 } } as Partial<FloorItem>);
      moveFloorItem(d, seqId, wall, 20, 20);
      moveFloorItem(d, seqId, actor, 20, 0);
      moveFloorItem(d, seqId, 'absent', 1, 1);
      updateFloorItem(d, seqId, 'absent', {});
    });
    const items = planOf(next, seqId).items;
    expect(items).toHaveLength(7);
    expect(items[0]).toMatchObject({ kind: 'camera', x: 100, y: 220, label: 'CAM A', shotIds: [shotId] });
    expect(items[1]).toMatchObject({ kind: 'wall', x: 20, y: 20, x2: 420, y2: 20 });
    expect(items[2]).toMatchObject({ kind: 'actor', x: 320, label: '1', to: { x: 420, y: 300 } });
    expect(camerasForShot(next, shotId)).toEqual(['CAM A']);
    expect(camerasForShot(next, 'absent')).toEqual([]);
    const removed = produce(next, (d) => removeFloorItem(d, seqId, cam));
    expect(planOf(removed, seqId).items).toHaveLength(6);
    expect(planOf(doc, seqId).items).toEqual([]);
  });

  it('calcule le cône depuis la focale du plan lié', () => {
    const next = produce(doc, (d) => {
      const cam = addFloorItem(d, seqId, 'camera', { x: 100, y: 100 });
      updateFloorItem(d, seqId, cam, { shotIds: ['absent', shotId] } as Partial<FloorItem>);
    });
    const cam = planOf(next, seqId).items[0] as Extract<FloorItem, { kind: 'camera' }>;
    expect(cameraFocal(next, cam)).toBe(16);
    const cone = cameraCone(next, cam);
    expect(cone.fov).toBeCloseTo(96.7, 1);
    expect(cone.points).toHaveLength(14);
    const bare = cameraCone(next, { ...cam, shotIds: [] });
    expect(bare.fov).toBe(60);
    const pts = conePoints(0, 0, 0, 90, 100, 2);
    expect(pts[1].x).toBeCloseTo(70.71, 1);
    expect(pts[1].y).toBeCloseTo(-70.71, 1);
    expect(snap(31)).toBe(40);
  });
});

describe('plans multiples, lumières et réflecteurs', async () => {
  const { addPlan, deletePlan, plansOf, renamePlan, reflections, lightBeam, reflectorSize } = await import('./floorplan');
  const { produce } = await import('immer');
  const { buildRav3 } = await import('../../seed/rav3');
  it('gère plusieurs plans par séquence', () => {
    const doc = buildRav3();
    const seqId = doc.project.sequenceIds[0];
    let key = '';
    const next = produce(doc, (d) => {
      key = addPlan(d, seqId);
      renamePlan(d, key, 'Contrechamp');
      addFloorItem(d, key, 'camera', { x: 100, y: 100 });
      updateFloorItem(d, key, planOf(d, key).items[0].id, { shotIds: [d.sequences[seqId].shotIds[0]] } as Partial<FloorItem>);
    });
    expect(plansOf(next, seqId).map((p) => p.name)).toEqual(['Vue 1', 'Contrechamp']);
    expect(camerasForShot(next, next.sequences[seqId].shotIds[0])).toEqual(['CAM A']);
    const removed = produce(next, (d) => {
      deletePlan(d, key);
      addFloorItem(d, seqId, 'actor', { x: 1, y: 1 });
      deletePlan(d, seqId);
      deletePlan(d, 'absent');
    });
    expect(plansOf(removed, seqId)).toHaveLength(1);
    expect(planOf(removed, seqId).items).toEqual([]);
    // Supprimer la vue 1 quand une autre existe : la suivante prend sa place.
    const promoted = produce(next, (d) => deletePlan(d, seqId));
    expect(plansOf(promoted, seqId).map((p) => p.name)).toEqual(['Contrechamp']);
    expect(planOf(promoted, seqId).items).toHaveLength(1);
  });
  it('renvoie la lumière sur un réflecteur dans le faisceau', () => {
    const light = { id: 'l', kind: 'light' as const, x: 0, y: 0, rot: 0, spread: 40, range: 300 };
    const small = { id: 'r', kind: 'reflector' as const, x: 150, y: -20, x2: 150, y2: 20 };
    const big = { ...small, id: 'R', y: -100, y2: 100 };
    const [b] = reflections([light, small]);
    expect(b.rot).toBeCloseTo(180, 5);
    expect(b.x).toBe(150);
    const [B] = reflections([light, big]);
    expect(B.spread).toBeGreaterThan(b.spread);
    expect(B.intensity).toBeGreaterThan(b.intensity);
    expect(reflections([light, { ...small, x: -150, x2: -150 }])).toEqual([]);
    expect(reflections([{ ...light, range: 100 }, small])).toEqual([]);
    expect(reflectorSize(big)).toBe(200);
    expect(lightBeam({ id: 'x', kind: 'light', x: 0, y: 0, rot: 0 }).spread).toBe(50);
    const angled = reflections([light, { id: 'a', kind: 'reflector', x: 120, y: -40, x2: 180, y2: 40 }]);
    expect(angled).toHaveLength(1);
  });
});

describe('chorégraphie du plan-séquence', async () => {
  const { choreography } = await import('./floorplan');
  it('relie les positions par temps, caméra et comédiens séparément', () => {
    const paths = choreography([
      { id: 'c2', kind: 'camera', x: 50, y: 0, rot: 0, shotIds: ['s'], beat: 2 },
      { id: 'c1', kind: 'camera', x: 0, y: 0, rot: 0, shotIds: ['s'], beat: 1 },
      { id: 'a1', kind: 'actor', x: 9, y: 9, label: 'Léa', beat: 1 },
      { id: 'fixe', kind: 'camera', x: 1, y: 1, rot: 0, shotIds: ['s'] },
    ]);
    expect(paths.map((p) => [p.kind, p.points.map((q) => q.beat)])).toEqual([
      ['camera', [1, 2]],
      ['actor', [1]],
    ]);
    expect(paths[0].points[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('éclairage : diffuseur et drapeau', async () => {
  const { computeLighting } = await import('./floorplan');
  const light = { id: 'l', kind: 'light' as const, x: 0, y: 0, rot: 0, spread: 40, range: 400, power: 1.2 };
  const reach = (b: { x: number; y: number; points: Array<{ x: number; y: number }> }) => b.points.slice(1).map((p) => Math.hypot(p.x - b.x, p.y - b.y));
  it('le diffuseur arrête la part du faisceau qu’il intercepte et la prolonge plus large et plus douce', () => {
    const { beams } = computeLighting([light, { id: 'd', kind: 'diffuser', x: 150, y: -40, x2: 150, y2: 40 }]);
    expect(Math.min(...reach(beams[0]))).toBeCloseTo(150, 0);
    expect(Math.max(...reach(beams[0]))).toBeGreaterThan(390);
    expect(beams[1]).toMatchObject({ sourceId: 'd', soft: true });
    expect(beams[1].spread).toBeGreaterThan(40);
  });
  it('le drapeau coupe le faisceau là où il est, le reste passe', () => {
    const { beams, shadows } = computeLighting([light, { id: 'f', kind: 'flag', x: 200, y: -30, x2: 200, y2: 30 }]);
    expect(beams).toHaveLength(1);
    expect(Math.min(...reach(beams[0]))).toBeCloseTo(200, 0);
    expect(Math.max(...reach(beams[0]))).toBeGreaterThan(390);
    expect(shadows).toEqual([]);
  });
  it('les murs arrêtent la lumière, un mur blanc la renvoie un peu ; les comédiens font obstacle', () => {
    const wall = { id: 'w', kind: 'wall' as const, x: 100, y: -200, x2: 100, y2: 200 };
    const { beams } = computeLighting([light, wall]);
    expect(Math.max(...reach(beams[0]))).toBeLessThan(140);
    expect(beams).toHaveLength(1);
    const white = computeLighting([light, { ...wall, white: true }]).beams;
    expect(white[1]).toMatchObject({ sourceId: 'w', soft: true });
    expect(white[1].intensity).toBeLessThan(0.5);
    const actor = computeLighting([light, { id: 'a', kind: 'actor', x: 120, y: 0, label: '1' }]).beams[0];
    expect(Math.min(...reach(actor))).toBeLessThan(110);
  });
  it('la lumière diffusée ou renvoyée est elle aussi coupée par drapeaux et murs, et reprise par les réflecteurs', () => {
    const diff = { id: 'd', kind: 'diffuser' as const, x: 150, y: -40, x2: 150, y2: 40 };
    const flag = { id: 'f', kind: 'flag' as const, x: 250, y: -400, x2: 250, y2: 400 };
    const soft = computeLighting([light, diff, flag]).beams.find((b) => b.sourceId === 'd')!;
    expect(Math.max(...reach(soft))).toBeLessThan(Math.hypot(100, 400) + 2);
    expect(Math.min(...reach(soft))).toBeCloseTo(100, 0);
    const wall = computeLighting([light, diff, { ...flag, id: 'w', kind: 'wall' as const }]).beams.find((b) => b.sourceId === 'd')!;
    expect(Math.min(...reach(wall))).toBeCloseTo(100, 0);
    const refl = { id: 'r', kind: 'reflector' as const, x: 300, y: -60, x2: 300, y2: 60 };
    const chain = computeLighting([light, diff, refl]).beams.map((b) => b.sourceId);
    expect(chain).toEqual(['l', 'd', 'r']);
  });
});
