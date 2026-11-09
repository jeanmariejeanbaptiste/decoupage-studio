import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildFiction } from '../../seed/fiction';
import { callSheetDocument } from './documents';
import { characterNumbers } from './registry';
import { updateDay } from './schedule';

describe('feuille de service au format professionnel', () => {
  it('en-tête en trois blocs, séquences, comédiens numérotés, besoins des postes, prévisions', () => {
    const doc = buildFiction();
    const [s1, s2, s3] = doc.project.sequenceIds;
    for (const id of doc.sequences[s1].shotIds.concat(doc.sequences[s2].shotIds)) doc.shots[id].shootingDay = 1;
    for (const id of doc.sequences[s3].shotIds) doc.shots[id].shootingDay = 2;
    updateDay(doc, 1, { date: '2026-11-16', callTime: '07:00', pat: '08:30', meal: '13:00', wrap: '19:00', weather: 'Couvert, 9 °C', sunrise: '07:58', sunset: '17:12', hospital: 'Hôpital Lariboisière, 2 rue Ambroise-Paré, 75010 Paris' });
    updateDay(doc, 2, { date: '2026-11-17', callTime: '16:00' });
    const lea = Object.values(doc.characters).find((c) => c.name === 'Léa')!;
    updateDay(doc, 1, { calls: { [lea.id]: '07:15' }, callDetails: { [lea.id]: { makeup: '07:30', onSet: '08:30' } } });
    const html = callSheetDocument(doc, 1).html;
    if (process.env.CS_DUMP) writeFileSync(process.env.CS_DUMP, html);
    expect(html).toContain('Jour 1 sur 2');
    expect(html).toContain('RDV&nbsp;: 07:00');
    expect(html).toContain('Prêt à tourner');
    expect(html).toContain('Lever 07:58 · coucher 17:12');
    expect(html).toContain('Hôpital Lariboisière');
    expect(html).toContain('Prévisions · jour 2');
    expect(html).toContain('<th>HMC</th>');
    expect(characterNumbers(doc).get(lea.id)).toBe(1);
  });
});
