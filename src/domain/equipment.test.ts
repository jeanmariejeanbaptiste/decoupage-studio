import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { aggregateEquipment, deduceEquipment } from './equipment';
import { makeShot } from './factory';

const shot = (movement: string[], extra: Parameters<typeof makeShot>[2] = {}) => makeShot('s', 'b', { movement, ...extra });
const labels = (m: string[], extra?: Parameters<typeof makeShot>[2]) => deduceEquipment(shot(m, extra)).map((i) => `${i.category}:${i.label}`);

describe('matériel déduit (§10)', () => {
  it.each([
    [['Traveling avant'], 'Machinerie:Rails + dolly ou slider'],
    [['Trav latéral gauche'], 'Machinerie:Rails + dolly ou slider'],
    [['Trav circulaire'], 'Machinerie:Rails courbes ou gimbal'],
    [['Trav courbe'], 'Machinerie:Rails courbes ou gimbal'],
    [['Boom up'], 'Machinerie:Grue, jib'],
    [['Grue'], 'Machinerie:Grue, jib'],
    [['Steadicam'], 'Image:Stabilisateur (steadicam / gimbal)'],
    [['Gimbal'], 'Image:Stabilisateur (steadicam / gimbal)'],
    [['Épaule'], 'Image:Rig épaule'],
    [['Drone'], 'Image:Drone + télépilote'],
    [['travelling latéral très lent'], 'Machinerie:Rails + dolly ou slider'],
    [['drone FPV'], 'Image:Drone + télépilote'],
    [['steadi'], 'Image:Stabilisateur (steadicam / gimbal)'],
    [['caméra épaule nerveuse'], 'Image:Rig épaule'],
    [['jib montant'], 'Machinerie:Grue, jib'],
    [['circulaire lent'], 'Machinerie:Rails courbes ou gimbal'],
  ])('%s → %s', (m, want) => {
    expect(labels(m)).toContain(want);
  });
  it('angles, optiques, son et lumière', () => {
    expect(labels(['Fixe'], { angle: ['Top shot'] })).toContain('Machinerie:Potence ou grue (top shot)');
    expect(labels(['Fixe'], { angle: ['Low angle'] })).toContain('Machinerie:Base basse (high-hat)');
    expect(labels(['Zoom avant'], { focal: { from: 70, to: 24 } })).toContain('Image:Optique zoom couvrant 24–70 mm');
    expect(labels(['Zoom avant'])).toContain('Image:Optique zoom (plage à préciser)');
    expect(labels(['Fixe'], { focal: { from: 50 } })).toContain('Image:Optique fixe 50 mm');
    expect(labels(['Fixe'], { sound: 'Playback' })).toContain('Son:Système de playback');
    expect(labels(['Fixe'], { sound: 'IN' })).toContain('Son:Perche + HF');
    expect(labels(['Fixe'], { light: 'Contre-jour' })).toContain('Lumière:Lumière : Contre-jour');
    expect(labels(['Fixe'])).toEqual([]);
    expect(labels(['inconnu'])).toEqual([]);
  });
  it('agrège par chef de poste avec les plans concernés', () => {
    const doc = buildRav3();
    doc.manualEquipment.push({ id: 'm1', category: 'Son', label: 'Enceinte de retour', shotIds: [] });
    const firstShot = doc.sequences[doc.project.sequenceIds[0]].shotIds[0];
    doc.shots[firstShot].status = 'abandonné';
    const agg = aggregateEquipment(doc);
    expect(agg.Image.map((l) => l.label)).toEqual(['Optique fixe 16 mm', 'Optique fixe 50 mm', 'Optique fixe 70 mm', 'Optique fixe 100 mm']);
    const rails = agg.Machinerie.find((l) => l.key === 'rails-dolly')!;
    expect(rails.shotIds.length).toBeGreaterThan(10);
    expect(rails.shotIds).not.toContain(firstShot);
    expect(agg.Lumière.some((l) => l.label === 'Projecteurs effet nuit')).toBe(true);
    expect(agg.Son.find((l) => l.manual)?.label).toBe('Enceinte de retour');
  });
});
