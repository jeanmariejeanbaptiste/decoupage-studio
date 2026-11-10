import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { addFloorItem, addPlan, updateFloorItem, type FloorItem } from './floorplan';
import { allFloorPlans, breakdownCsv, calendarFiles, callSheetCsv, charactersCsv, csv, decorsCsv, equipmentCsv, scheduleCsv, sequencesCsv, shotsCsv } from './exports';
import { suggestSchedule, updateDay } from './schedule';
import { applyTemplate } from './production';

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
    expect(plans[0].name).toBe('Séquence 1 — Vue 1');
    expect(plans[0].svg).toMatch(/^<svg xmlns/);
    expect(plans[0].svg).toContain('CAM A · 16mm');
  });
  it('le cadre du plan exporté contient cônes et faisceaux, sous le titre', async () => {
    const { cameraCone, computeLighting, planOf } = await import('./floorplan');
    const { floorPlanSvg } = await import('./exports');
    const doc = buildRav3();
    const seqId = doc.project.sequenceIds[0];
    const next = produce(doc, (d) => {
      addFloorItem(d, seqId, 'camera', { x: 300, y: 100 }); // orientée vers le haut : le cône sort du cadre par défaut
      const l = addFloorItem(d, seqId, 'light', { x: 980, y: 300 });
      updateFloorItem(d, seqId, l, { rot: 0 } as Partial<FloorItem>);
    });
    const svg = floorPlanSvg(next, seqId, 'Test');
    const [x0, y0, w, h] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
    const items = planOf(next, seqId).items;
    const cam = items.find((i) => i.kind === 'camera')!;
    const pts = [...cameraCone(next, cam as Extract<FloorItem, { kind: 'camera' }>).points, ...computeLighting(items).beams.flatMap((b) => b.points)];
    const titleBottom = y0 + 30;
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(x0);
      expect(p.x).toBeLessThanOrEqual(x0 + w);
      expect(p.y).toBeGreaterThan(titleBottom);
      expect(p.y).toBeLessThanOrEqual(y0 + h);
    }
  });
});

describe('calendriers du dossier de production', () => {
  it('rien sans calendrier ; sinon .ics du calendrier et des étapes, et la frise en SVG', () => {
    expect(calendarFiles(buildFiction(), '2026-11-09')).toEqual([]);
    const doc = produce(buildFiction(), (d) => {
      suggestSchedule(d, 20);
      updateDay(d, 1, { date: '2027-03-01' });
      applyTemplate(d, '2026-11-09');
    });
    const files = calendarFiles(doc, '2026-11-09');
    expect(files.map((f) => f.name)).toEqual(['Calendrier.ics', 'Calendrier de production.ics', 'Calendrier de production.svg']);
    expect(files[0].content).toContain('SUMMARY:Jour 1');
    expect(files[0].content).toContain('SUMMARY:Repérages');
    // L'étape liée figure dans les étapes du film.
    expect(files[1].content).toContain('SUMMARY:Tournage');
    expect(files[1].content).not.toContain('Jour 1');
    expect(files[2].content.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });
});
