import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { breakdownDocument, callSheetDocument, equipmentDocument, floorPlansDocument, intentionDocument, productionWordDocument, registryDocument, scheduleDocument } from './documents';
import { addFloorItem } from './floorplan';
import { addBanner, placeSequence, placeShot, stripsByTime, suggestSchedule, updateBanner, updateDay } from './schedule';
import { callSheetCsv, scheduleCsv } from './exports';
import { setSequenceSummary } from './ops';
import { sceneOfSequence } from './outline';

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
  it('le résumé d’une séquence est la phrase du séquencier quand elle existe (dépouillement, feuille de service)', () => {
    const [s1] = doc.project.sequenceIds;
    const withPhrase = produce(doc, (d) => {
      d.sequences[s1].summary = 'Ancien résumé';
      setSequenceSummary(d, s1, 'Léa dépose la valise.');
    });
    expect(sceneOfSequence(withPhrase, s1)).toBeDefined();
    for (const html of [breakdownDocument(withPhrase).html, callSheetDocument(withPhrase, 1).html]) {
      expect(html).toContain('Léa dépose la valise.');
      expect(html).not.toContain('Ancien résumé');
    }
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
    // Le repas se place après la bande qui franchit midi (09:00–12:30) ; la reprise suit, jusqu'à la fin du déroulé.
    expect(sheet).toContain('<th>Repas</th><td class="time">de 12:30 à 13:30</td>');
    expect(sched).toContain('<td class="time">12:30 – 13:30</td>');
    expect(sheet).toContain('<th>Reprise</th><td class="time">de 14:00 à 17:30</td>');
    expect(sheet).not.toContain('<th>Fin prévue</th>');
    expect(scheduleCsv(next)).toContain('Repas · cantine');
    expect(callSheetCsv(next, 1)).toContain('60 min');
  });
});

describe('calendrier de production pour Word', () => {
  it('donne un tableau lisible, sans SVG, en Inter', () => {
    const doc = produce(buildFiction(), (d) => {
      d.production = {
        phases: [
          {
            id: 'p',
            name: 'Préparation',
            tasks: [
              { id: 'a', name: 'Repérages', start: '2027-01-04', end: '2027-01-08', done: true },
              { id: 'm', name: 'Fin des repérages', start: '2027-01-08', end: '2027-01-08', milestone: true, after: ['a'] },
            ],
          },
        ],
      };
    });
    const { html } = productionWordDocument(doc);
    expect(html).not.toContain('<svg');
    expect(html).toContain('<th>Étape</th>');
    expect(html).toContain('<tr><td><b>Préparation</b></td><td><b>04/01/2027</b></td><td><b>08/01/2027</b></td><td style="text-align:right"><b>5</b></td></tr>');
    expect(html).toContain('<s>Repérages</s></td><td>04/01/2027</td><td>08/01/2027</td><td style="text-align:right">5</td>');
    expect(html).toContain('Fin des repérages</td><td>08/01/2027</td><td></td><td style="text-align:right">jalon</td>');
    expect(html).toMatch(/h1 \{ font-family: Inter, 'Inter Variable'/);
  });
});
