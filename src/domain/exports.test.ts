import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { addFloorItem, addPlan, updateFloorItem, type FloorItem } from './floorplan';
import { allFloorPlans, breakdownCsv, callSheetCsv, charactersCsv, csv, decorsCsv, equipmentCsv, scheduleCsv, sequencesCsv, shotsCsv } from './exports';
import { suggestSchedule } from './schedule';

describe('exports par onglet', () => {
  it('CSV échappés avec BOM', () => {
    expect(csv([['a;b', 'c"d', 1, undefined]])).toBe('﻿"a;b";"c""d";1;\r\n');
  });
  it('produit chaque tableau', () => {
    const doc = produce(buildRav3(), (d) => void suggestSchedule(d, 20));
    expect(sequencesCsv(doc)).toContain('CHAMBRE ADMIRATRICE');
    expect(charactersCsv(doc)).toContain('Candice;Candi');
    expect(decorsCsv(doc)).toContain('LOGE');
    expect(shotsCsv(doc).split('\r\n').length).toBe(55);
    expect(equipmentCsv(doc)).toContain('Rails + dolly');
    expect(breakdownCsv(buildFiction())).toContain('Léa');
    expect(scheduleCsv(doc)).toContain('J1');
    const sheet = callSheetCsv(doc, 1);
    expect(sheet).toContain('Feuille de service');
    expect(sheet).toContain('Jour 1');
  });
  it('exporte les plans au sol non vides en SVG', () => {
    const doc = buildRav3();
    const seq = doc.project.sequenceIds[0];
    const next = produce(doc, (d) => {
      const cam = addFloorItem(d, seq, 'camera', { x: 100, y: 100 });
      updateFloorItem(d, seq, cam, { shotIds: [d.sequences[seq].shotIds[0]] } as Partial<FloorItem>);
      for (const k of ['actor', 'wall', 'rail', 'reflector', 'door', 'window', 'light'] as const) addFloorItem(d, seq, k, { x: 200, y: 200 });
      addPlan(d, seq);
    });
    const plans = allFloorPlans(next);
    expect(plans).toHaveLength(1);
    expect(plans[0].name).toBe('Séquence 1 — Plan 1');
    expect(plans[0].svg).toMatch(/^<svg xmlns/);
    expect(plans[0].svg).toContain('CAM A · 16mm');
  });
});
