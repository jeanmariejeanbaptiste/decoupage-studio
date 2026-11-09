import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addSequence, addShot, deleteSequence, moveShot, moveShotTo } from './ops';
import { toggleOneShot } from './oneshot';
import { aggregateEquipment } from './equipment';
import { addInterviewee, ensureInterview, placeSetup, setupShotIds, syncInterviewShots } from './interview';
import { addFloorItem, oneShotPlanKey, placeCameraForShot, planOf, shotCameras, updateFloorItem, type FloorItem } from './floorplan';

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
