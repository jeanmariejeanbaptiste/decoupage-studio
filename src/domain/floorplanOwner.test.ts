import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addSequence, addShot, deleteSequence, moveShot, moveShotTo } from './ops';
import { toggleOneShot } from './oneshot';
import { aggregateEquipment } from './equipment';
import { addInterviewee, ensureInterview, placeSetup, setupShotIds, syncInterviewShots } from './interview';
import {
  addFloorItem,
  addPlan,
  deletePlan,
  duplicatePlan,
  oneShotPlanKey,
  placeCameraForShot,
  planOf,
  plansOf,
  removeFloorItem,
  setRoom,
  shotCameras,
  updateFloorItem,
  type FloorItem,
} from './floorplan';
import type { ProjectDoc } from './types';

const labels = (doc: ProjectDoc, key: string) => planOf(doc, key).items.map((i) => ('label' in i ? i.label : undefined));

describe('plan au sol : vue d’un plan-séquence déplacé', () => {
  it('garde sa caméra et survit à la suppression de l’ancienne séquence', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const s1 = addSequence(doc, undefined, { label: 'Salon' });
    const s2 = addSequence(doc, undefined, { label: 'Cuisine' });
    addShot(doc, s2);
    const ps = addShot(doc, s1);
    toggleOneShot(doc, ps);
    const key = oneShotPlanKey(ps);
    placeCameraForShot(doc, key, ps, { x: 100, y: 100 });
    const l = addFloorItem(doc, key, 'light', { x: 300, y: 100 });
    updateFloorItem(doc, key, l, { model: 'HMI 4 kW', watts: 4000 } as Partial<FloorItem>);
    moveShot(doc, ps, s2, 0);
    expect(shotCameras(doc, ps).map((c) => c.label)).toEqual(['CAM A']);
    expect(planOf(doc, key).seqId).toBe(s2);
    const hmi = aggregateEquipment(doc)['Lumière'].find((x) => x.label.startsWith('HMI 4 kW'))!;
    expect(hmi.shotIds).toContain(ps);
    deleteSequence(doc, s1);
    expect(doc.floorPlans?.[key]?.items).toHaveLength(2);
  });

  it('document ancien : une vue restée sur sa séquence d’origine n’est pas perdue', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const s1 = addSequence(doc, undefined, { label: 'Salon' });
    const s2 = addSequence(doc, undefined, { label: 'Cuisine' });
    const ps = addShot(doc, s1);
    toggleOneShot(doc, ps);
    const key = oneShotPlanKey(ps);
    placeCameraForShot(doc, key, ps, { x: 100, y: 100 });
    // Déplacement fait avant le correctif : la vue pointe encore vers s1.
    doc.sequences[s1].shotIds = [];
    doc.sequences[s2].shotIds.push(ps);
    doc.shots[ps].sequenceId = s2;
    deleteSequence(doc, s1);
    expect(doc.floorPlans?.[key]).toBeDefined();
    expect(shotCameras(doc, ps)).toHaveLength(1);
  });
});

describe('plan au sol : cadre d’interview déplacé', () => {
  it('ses caméras ne restent pas liées dans l’ancienne séquence', () => {
    const doc = createProjectDoc({ title: 'T', format: 'institutionnel' });
    const s1 = addSequence(doc, undefined, { label: 'Atelier' }, false);
    const s2 = addSequence(doc, undefined, { label: 'Bureau' }, false);
    addShot(doc, s1);
    addShot(doc, s2);
    const itw = ensureInterview(doc);
    if (!itw.subjects.length) addInterviewee(doc);
    const setup = itw.subjects[0].setups[0];
    placeSetup(doc, setup.id, s1);
    syncInterviewShots(doc);
    const [ca] = setupShotIds(doc, setup.id);
    const cam = placeCameraForShot(doc, s1, ca, { x: 100, y: 100 });
    moveShotTo(doc, ca, s2, 0);
    syncInterviewShots(doc);
    expect(doc.shots[ca].sequenceId).toBe(s2);
    const item = planOf(doc, s1).items.find((i) => i.id === cam) as Extract<FloorItem, { kind: 'camera' }>;
    expect(item.shotIds).toEqual([]);
  });
});

describe('plan au sol : repères et noms de vues', () => {
  it('prend le premier repère libre, sans compter les lampes de jeu', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const s = addSequence(doc, undefined, { label: 'Salon' });
    const a = addFloorItem(doc, s, 'camera', { x: 0, y: 0 });
    addFloorItem(doc, s, 'camera', { x: 100, y: 0 });
    removeFloorItem(doc, s, a);
    addFloorItem(doc, s, 'camera', { x: 200, y: 0 });
    expect(labels(doc, s)).toEqual(['CAM B', 'CAM A']);
    const p = addFloorItem(doc, s, 'light', { x: 0, y: 200 });
    updateFloorItem(doc, s, p, { practical: true, label: 'P1' } as Partial<FloorItem>);
    addFloorItem(doc, s, 'light', { x: 100, y: 200 });
    expect(labels(doc, s).slice(2)).toEqual(['P1', 'L1']);
  });

  it('nomme les vues sans doublon ni suffixe empilé', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const s = addSequence(doc, undefined, { label: 'Salon' });
    const v2 = addPlan(doc, s);
    addPlan(doc, s);
    deletePlan(doc, v2);
    addPlan(doc, s);
    expect(plansOf(doc, s).map((p) => p.name)).toEqual(['Vue 1', 'Vue 3', 'Vue 2']);
    const c1 = duplicatePlan(doc, s, s);
    duplicatePlan(doc, s, c1);
    expect(plansOf(doc, s).map((p) => p.name).slice(3)).toEqual(['Vue 1 (copie)', 'Vue 1 (copie 2)']);
  });
});

describe('plan au sol : pièce', () => {
  it('la hauteur seule ne redessine pas les murs ; dupliquer et vider suivent la pièce', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const s = addSequence(doc, undefined, { label: 'Salon' });
    setRoom(doc, s, { w: 5, l: 6, h: 2.5 });
    const wall = planOf(doc, s).items.find((i) => i.kind === 'wall')!;
    updateFloorItem(doc, s, wall.id, { x: 100 } as Partial<FloorItem>);
    setRoom(doc, s, { w: 5, l: 6, h: 3 });
    expect(planOf(doc, s).items.find((i) => i.id === wall.id)?.x).toBe(100);
    expect(planOf(doc, s).room).toEqual({ w: 5, l: 6, h: 3 });
    const copy = duplicatePlan(doc, s, s);
    expect(planOf(doc, copy).room).toEqual({ w: 5, l: 6, h: 3 });
    deletePlan(doc, copy);
    deletePlan(doc, s);
    expect(planOf(doc, s).items).toEqual([]);
    expect(planOf(doc, s).room).toBeUndefined();
  });
});
