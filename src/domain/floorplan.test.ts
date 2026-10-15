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
