import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { breakdownDocument, callSheetDocument, equipmentDocument, floorPlansDocument, intentionDocument, registryDocument, scheduleDocument } from './documents';
import { addFloorItem } from './floorplan';
import { addBanner, placeSequence, placeShot, stripsByTime, suggestSchedule, updateBanner, updateDay } from './schedule';
import { callSheetCsv, scheduleCsv } from './exports';

describe('documents imprimables', () => {
  const doc = produce(buildFiction(), (d) => {
    suggestSchedule(d, 20);
    const [s1, s2] = d.project.sequenceIds;
    placeShot(d, 1, d.sequences[s2].shotIds[0], '09:00', 120);
    placeSequence(d, 1, d.sequences[s1].shotIds.slice(0, 1), '14:00');
    d.intention = 'Un film <sobre>.';
    addFloorItem(d, s1, 'camera', { x: 100, y: 100 });
  });
  it('produisent un HTML autonome, sans nom ni lien de l’outil', () => {
    for (const p of [breakdownDocument(doc), equipmentDocument(doc, true), scheduleDocument(doc), callSheetDocument(doc, 1), registryDocument(doc), floorPlansDocument(doc), intentionDocument(doc)]) {
      expect(p.html.startsWith('<!doctype html>')).toBe(true);
      expect(p.html).toContain('La Consigne');
      expect(p.html).not.toMatch(/Découpage Studio|https?:\/\/(?!www\.w3\.org)/);
    }
  });
  it('trie les séquences du jour par horaire et les reporte sur la feuille de service', () => {
    const [s1, s2] = doc.project.sequenceIds;
    expect(stripsByTime(doc, 1).map((s) => s.seqId).slice(0, 2)).toEqual([s2, s1]);
    expect(callSheetDocument(doc, 1).html).toContain('09:00 – 11:00');
    // Bande en partie placée : ses plans non placés s'enchaînent après le dernier créneau.
    expect(scheduleDocument(doc).html).toContain('14:00 – 16:00');
  });
  it('liste le matériel avec ou sans les plans, et échappe le texte', () => {
    expect(equipmentDocument(doc, true).html).toContain('Plans concernés');
    expect(equipmentDocument(doc, false).html).not.toContain('Plans concernés');
    expect(intentionDocument(doc).html).toContain('Un film &lt;sobre&gt;.');
    expect(floorPlansDocument(doc).html).toContain('<svg');
  });
  it('plan de travail : en-tête « jour n sur N », totaux et bandes en gris (sauf économie d’encre)', () => {
    const n = doc.schedule!.days.length;
    const html = scheduleDocument(doc).html;
    expect(html).toContain(`Jour 1 sur ${n}`);
    expect(html).toMatch(/\d+ séq\. · \d+ plans? · /);
    const toned = produce(doc, (d) => {
      const seq = d.sequences[d.project.sequenceIds[0]];
      seq.intExt = 'EXT';
      seq.effect = 'NUIT';
    });
    expect(scheduleDocument(toned).html).toContain('class="tone-ext-night"');
    const saver = produce(toned, (d) => void (d.project.settings.exportInkSaver = true));
    expect(scheduleDocument(saver).html).not.toContain('class="tone-');
  });
  it('bandeaux et horaires en cascade dans le plan de travail, la feuille de service et les CSV', () => {
    const next = produce(doc, (d) => {
      updateDay(d, 1, { callTime: '08:00' });
      const meal = addBanner(d, 1, 'repas');
      updateBanner(d, 1, meal, { label: 'cantine' });
    });
    const sched = scheduleDocument(next).html;
    expect(sched).toContain('<tr class="banner">');
    expect(sched).toContain('<b>Repas</b> · cantine · 60 min');
    // Feuille de service : seuls les plans placés y figurent, mais les horaires sont ceux du plan de travail.
    const sheet = callSheetDocument(next, 1).html;
    expect(sheet).toContain('<th>Repas</th><td class="time">de 17:30 à 18:30</td>');
    expect(sched).toContain('<td class="time">17:30 – 18:30</td>');
    // Rien ne suit le repas : pas de reprise, la fin prévue reste.
    expect(sheet).not.toContain('<th>Reprise</th>');
    expect(sheet).toContain('<th>Fin prévue</th><td class="time">18:30</td>');
    expect(scheduleCsv(next)).toContain('Repas · cantine');
    expect(callSheetCsv(next, 1)).toContain('60 min');
  });
});
