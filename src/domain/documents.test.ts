import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { breakdownDocument, callSheetDocument, equipmentDocument, floorPlansDocument, intentionDocument, registryDocument, scheduleDocument } from './documents';
import { addFloorItem } from './floorplan';
import { setSlot, stripsByTime, suggestSchedule } from './schedule';

describe('documents imprimables', () => {
  const doc = produce(buildFiction(), (d) => {
    suggestSchedule(d, 20);
    const [s1, s2] = d.project.sequenceIds;
    setSlot(d, 1, s2, { start: '09:00', end: '11:00' });
    setSlot(d, 1, s1, { start: '14:00' });
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
    expect(scheduleDocument(doc).html).toContain('14:00 – …');
  });
  it('liste le matériel avec ou sans les plans, et échappe le texte', () => {
    expect(equipmentDocument(doc, true).html).toContain('Plans concernés');
    expect(equipmentDocument(doc, false).html).not.toContain('Plans concernés');
    expect(intentionDocument(doc).html).toContain('Un film &lt;sobre&gt;.');
    expect(floorPlansDocument(doc).html).toContain('<svg');
  });
});
