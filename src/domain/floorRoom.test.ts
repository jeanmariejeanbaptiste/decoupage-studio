import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addSequence, addShot } from './ops';
import { addFloorItem, lightSpecs, planOf, roomSize, setRoom, updateFloorItem, type FloorItem } from './floorplan';
import { aggregateEquipment } from './equipment';

describe('plan au sol : mesures réelles', () => {
  it('la pièce pose quatre murs à l’échelle (1 unité = 1 cm) et donne sa superficie', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const seq = addSequence(doc, undefined, { label: 'Salon' });
    // Plan encore vierge : la pièce le crée.
    setRoom(doc, seq, { w: 6, l: 7.5, h: 3 });
    expect(planOf(doc, seq).items).toHaveLength(4);
    addFloorItem(doc, seq, 'wall', { x: 50, y: 50 }, { x: 150, y: 50 });
    setRoom(doc, seq, { w: 6, l: 7.5, h: 3 });
    const walls = planOf(doc, seq).items.filter((i) => i.kind === 'wall');
    expect(walls).toHaveLength(5);
    expect(walls.filter((w) => 'room' in w && w.room).map((w) => (w as { x2: number; y2: number }).x2)).toContain(600);
    expect(roomSize({ w: 6, l: 7.5, h: 3 })).toEqual({ area: 45, volume: 135 });
    setRoom(doc, seq, { w: 5, l: 6 });
    expect(planOf(doc, seq).items.filter((i) => i.kind === 'wall')).toHaveLength(5);
    setRoom(doc, seq, undefined);
    expect(planOf(doc, seq).items.filter((i) => i.kind === 'wall')).toHaveLength(1);
    expect(planOf(doc, seq).room).toBeUndefined();
  });

  it('projecteurs : puissance et température lisibles, et repris dans la liste Lumière', () => {
    expect(lightSpecs({ watts: 2000, kelvin: 3200 })).toBe('2 kW · 3 200 K');
    expect(lightSpecs({ watts: 650 })).toBe('650 W');
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    const seq = addSequence(doc, undefined, { label: 'Salon' });
    addShot(doc, seq);
    for (let k = 0; k < 2; k++) {
      const id = addFloorItem(doc, seq, 'light', { x: 100 + k * 50, y: 100 });
      updateFloorItem(doc, seq, id, { model: 'HMI 1 800 W (M18)', watts: 1800, kelvin: 5600 } as Partial<FloorItem>);
    }
    const labels = aggregateEquipment(doc)['Lumière'].map((l) => l.label);
    expect(labels).toContain('HMI 1 800 W (M18) (1800 W, 5600 K) ×2');
  });
});
