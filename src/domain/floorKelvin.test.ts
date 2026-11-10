import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { BEAM_GREY, lightTint, TINT_GAIN } from './colorTemperature';
import { addFloorItem, beamStops, computeLighting, lightSpecs, planInventory, planOf, updateFloorItem, type FloorItem } from './floorplan';
import { floorPlanSvg } from './exports';

describe('plan au sol : température de couleur des sources', () => {
  const light = { id: 'l', kind: 'light' as const, x: 0, y: 0, rot: 0, spread: 40, range: 400, kelvin: 3200 };
  const refl = { id: 'r', kind: 'reflector' as const, x: 300, y: -60, x2: 300, y2: 60 };
  const diff = { id: 'd', kind: 'diffuser' as const, x: 150, y: -40, x2: 150, y2: 40 };

  it('le faisceau porte la température de sa source, et la garde une fois diffusé ou renvoyé', () => {
    const { beams } = computeLighting([light, diff, refl]);
    expect(beams.map((b) => b.sourceId)).toEqual(['l', 'd', 'r']);
    expect(beams.every((b) => b.kelvin === 3200)).toBe(true);
    // Deux sources de températures différentes : chacune garde la sienne.
    const two = computeLighting([light, { ...light, id: 'm', y: 500, kelvin: 5600 }]).beams;
    expect(two.map((b) => b.kelvin)).toEqual([3200, 5600]);
    // Sans température : rien (le faisceau reste gris).
    expect(computeLighting([{ ...light, kelvin: undefined }]).beams[0].kelvin).toBeUndefined();
  });

  it('la liste « Sur le plan » donne la température, lampes de jeu comprises', () => {
    const doc = produce(buildFiction(), (d) => {
      const seq = d.project.sequenceIds[0];
      const a = addFloorItem(d, seq, 'light', { x: 100, y: 100 });
      updateFloorItem(d, seq, a, { kelvin: 3200, watts: 2000 } as Partial<FloorItem>);
      const b = addFloorItem(d, seq, 'light', { x: 300, y: 100 });
      updateFloorItem(d, seq, b, { practical: true, kelvin: 2700 } as Partial<FloorItem>);
      addFloorItem(d, seq, 'light', { x: 500, y: 100 });
    });
    const rows = planInventory(doc, planOf(doc, doc.project.sequenceIds[0]).items).filter((r) => r.kind === 'light');
    expect(rows.map((r) => r.kelvin)).toEqual([3200, 2700, undefined]);
    expect(rows[0].detail).toBe(lightSpecs({ watts: 2000, kelvin: 3200 }));
    expect(rows[1].detail).toBe(`Lampe de jeu · ${lightSpecs({ kelvin: 2700 })}`);
    expect(rows[2].detail).toBe('Projecteur');
  });

  it('l’export teinte faisceaux (en dégradé, comme à l’écran) et lampes de jeu ; sans température, gris neutre', () => {
    const base = buildFiction();
    const seq = base.project.sequenceIds[0];
    const doc = produce(base, (d) => {
      const a = addFloorItem(d, seq, 'light', { x: 100, y: 100 });
      updateFloorItem(d, seq, a, { kelvin: 3200 } as Partial<FloorItem>);
      const b = addFloorItem(d, seq, 'light', { x: 600, y: 400 });
      updateFloorItem(d, seq, b, { practical: true, spread: 360, range: 170, kelvin: 8000 } as Partial<FloorItem>);
    });
    const svg = floorPlanSvg(doc, seq, 'Test');
    const beams = computeLighting(planOf(doc, seq).items).beams;
    // Un dégradé radial par faisceau, aux arrêts de l'écran, référencé par son polygone.
    const ids = [...svg.matchAll(/<radialGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(beams.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(svg).toContain(`fill="url(#${id})"`);
    const [first] = beamStops(beams[0]);
    expect(svg).toContain(`<stop offset="0" stop-color="${lightTint(3200)!.papier}" stop-opacity="${Math.min(1, first.opacity * TINT_GAIN.papier).toFixed(2)}"/>`);
    expect(svg).toContain(`stop-color="${lightTint(8000)!.papier}"`);
    expect(svg).toContain(`r="9" fill="${lightTint(8000)!.papier}"`);
    const grey = produce(base, (d) => void addFloorItem(d, seq, 'light', { x: 100, y: 100 }));
    const plain = floorPlanSvg(grey, seq, 'Test');
    const colors = [...plain.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(colors.length).toBeGreaterThan(0);
    expect(new Set(colors)).toEqual(new Set([BEAM_GREY.papier]));
    // Sans température, l'opacité du gris est celle de l'écran, sans gain.
    expect(plain).toContain(`stop-color="${BEAM_GREY.papier}" stop-opacity="${first.opacity.toFixed(2)}"`);
  });

  it('plusieurs vues dans un même document : des dégradés aux identifiants distincts', () => {
    const base = buildFiction();
    const [s1, s2] = base.project.sequenceIds;
    const doc = produce(base, (d) => {
      addFloorItem(d, s1, 'light', { x: 100, y: 100 });
      addFloorItem(d, s2, 'light', { x: 100, y: 100 });
    });
    const ids = [s1, s2].flatMap((k) => [...floorPlanSvg(doc, k, 'Test').matchAll(/<radialGradient id="([^"]+)"/g)].map((m) => m[1]));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
