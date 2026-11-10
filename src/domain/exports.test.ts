import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { addFloorItem, addPlan, renamePlan, updateFloorItem, type FloorItem } from './floorplan';
import { allFloorPlans, breakdownCsv, calendarFiles, callSheetCsv, charactersCsv, csv, decorsCsv, dossierReadme, equipmentCsv, exportFooterText, interviewFrameFiles, scheduleCsv, sequencesCsv, shotsCsv, storyboardFiles, uniqueNames } from './exports';
import { scheduleDocument, wordHtml } from './documents';
import { addSetup, addInterviewee, ensureInterview } from './interview';
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

describe('dossier de production', () => {
  it('noms de fichiers sans doublon, casse ignorée', () => {
    expect(uniqueNames(['Vue', 'Vue', 'vue', 'Autre'])).toEqual(['Vue', 'Vue (2)', 'vue (3)', 'Autre']);
    expect(uniqueNames(['A', 'A (2)', 'A'])).toEqual(['A', 'A (2)', 'A (3)']);
  });

  it('deux vues de même nom dans une séquence restent deux fichiers', () => {
    const doc = produce(buildRav3(), (d) => {
      const seqId = d.project.sequenceIds[0];
      for (const key of [addPlan(d, seqId), addPlan(d, seqId)]) {
        renamePlan(d, key, 'Plan A');
        addFloorItem(d, key, 'actor', { x: 100, y: 100 });
      }
    });
    const names = allFloorPlans(doc).map((p) => p.name).filter((n) => n.includes('Plan A'));
    expect(names).toHaveLength(2);
    expect(new Set(uniqueNames(names)).size).toBe(2);
  });

  it('LISEZ-MOI : seuls les dossiers écrits sont annoncés', () => {
    const txt = dossierReadme(buildRav3(), new Set(['00 Projet', '03 Dépouillement', '04 Découpage']));
    expect(txt).toContain('04 Découpage');
    expect(txt).not.toContain('Storyboard');
    expect(txt).not.toContain('Feuilles');
    expect(txt).not.toContain('thème');
  });

  it('noms des images du storyboard, repris dans Plans.csv', () => {
    const doc = produce(buildRav3(), (d) => {
      const s1 = d.sequences[d.project.sequenceIds[0]];
      d.shots[s1.shotIds[0]].storyboard = { blobKey: 'a' };
      d.shots[s1.shotIds[0]].keyframes = [{ id: 'k', blobKey: 'b' }];
      d.shots[s1.shotIds[1]].storyboard = { blobKey: 'c' };
    });
    const s1 = doc.sequences[doc.project.sequenceIds[0]];
    expect(storyboardFiles(doc, s1.shotIds[0])).toEqual([
      { key: 'a', name: 'Plan 1.1 K1' },
      { key: 'b', name: 'Plan 1.1 K2' },
    ]);
    expect(storyboardFiles(doc, s1.shotIds[1])).toEqual([{ key: 'c', name: 'Plan 1.2' }]);
    expect(storyboardFiles(doc, s1.shotIds[2])).toEqual([]);
    const rows = shotsCsv(doc).split('\r\n');
    expect(rows[1].endsWith(';Plan 1.1 K1, Plan 1.1 K2')).toBe(true);
    expect(rows[2].endsWith(';Plan 1.2')).toBe(true);
  });

  it('images des cadres d’interview restés en annexe', () => {
    const doc = produce(buildRav3(), (d) => {
      const itw = ensureInterview(d);
      const subjectId = itw.subjects[0]?.id ?? addInterviewee(d);
      const subject = d.interview!.subjects.find((x) => x.id === subjectId)!;
      if (!subject.setups.length) addSetup(d, subjectId);
      subject.name = 'Claire';
      subject.setups[0].name = 'Bureau';
      subject.setups[0].cameras[0].frame = 'img1';
    });
    const files = interviewFrameFiles(doc);
    expect(files).toHaveLength(1);
    expect(files[0].key).toBe('img1');
    expect(files[0].name.startsWith('Interview Claire Bureau ')).toBe(true);
  });

  it('documents Word : orientation paysage pour Word', () => {
    const doc = buildRav3();
    expect(wordHtml(scheduleDocument(doc), 'landscape')).toContain('mso-page-orientation: landscape');
    expect(wordHtml(scheduleDocument(doc))).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
  });

  it('pied de page : titre, version et date', () => {
    const doc = buildRav3();
    expect(exportFooterText(doc, new Date(2026, 10, 10))).toBe(`${doc.project.title} · ${doc.project.version} · 10/11/2026`);
  });
});
