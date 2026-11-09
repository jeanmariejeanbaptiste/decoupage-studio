import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { produce } from 'immer';
import { buildFiction } from '../../seed/fiction';
import { callSheetDocument } from './documents';
import { callSheetCsv } from './exports';
import { characterNumbers } from './registry';
import { addBanner, dayAgenda, dayKeyTimes, moveBanner, setDayMeal, updateDay } from './schedule';

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
    // Ancien champ « Repas » (une seule heure) : lu comme le début, une heure de repas par défaut.
    expect(html).toContain('<th>Repas</th><td class="time">de 13:00 à 14:00</td>');
    expect(html).toContain('<th>Reprise</th><td class="time">de 14:00 à 19:00</td>');
    expect(html).not.toContain('<th>Fin prévue</th>');
    expect(html).toContain('Lever 07:58 · coucher 17:12');
    expect(html).toContain('Hôpital Lariboisière');
    expect(html).toContain('Prévisions · jour 2');
    expect(html).toContain('<th>HMC</th>');
    expect(characterNumbers(doc).get(lea.id)).toBe(1);
    const csv = callSheetCsv(doc, 1);
    expect(csv).toMatch(/Repas.13:00.14:00/);
    expect(csv).toMatch(/Reprise.14:00.19:00/);
  });
});

describe('repas et reprise : de … à …', () => {
  const day1 = () => {
    const doc = buildFiction();
    const [s1, s2] = doc.project.sequenceIds;
    for (const id of doc.sequences[s1].shotIds.concat(doc.sequences[s2].shotIds)) doc.shots[id].shootingDay = 1;
    updateDay(doc, 1, {});
    return { doc, s1, s2 };
  };

  it('sans horaire, rien n’est inventé', () => {
    const { doc } = day1();
    expect(dayKeyTimes(doc, 1)).toEqual({ meal: undefined, wrap: undefined, wrapComputed: true });
  });

  it('saisi sur le jour : fin par défaut, début changé à durée égale, reprise jusqu’à la fin prévue', () => {
    const { doc } = day1();
    const a = produce(doc, (d) => {
      updateDay(d, 1, { wrap: '19:00' });
      setDayMeal(d, 1, { start: '12:30' });
    });
    expect(dayKeyTimes(a, 1)).toMatchObject({ meal: { start: '12:30', end: '13:30', computed: { start: false, end: true } }, restart: { start: '13:30', end: '19:00' } });
    const b = produce(a, (d) => setDayMeal(d, 1, { end: '13:15' }));
    expect(dayKeyTimes(b, 1).meal).toMatchObject({ start: '12:30', end: '13:15' });
    const c = produce(b, (d) => setDayMeal(d, 1, { start: '13:00' }));
    expect(dayKeyTimes(c, 1).meal).toMatchObject({ start: '13:00', end: '13:45' });
    expect(dayKeyTimes(c, 1).restart).toEqual({ start: '13:45', end: '19:00' });
    const none = produce(c, (d) => setDayMeal(d, 1, { start: undefined }));
    expect(dayKeyTimes(none, 1).meal).toBeUndefined();
    expect(dayKeyTimes(none, 1).restart).toBeUndefined();
  });

  it('déduit du bandeau « Repas » ; saisi sur la feuille, c’est le bandeau qui change et la journée suit', () => {
    const { doc, s2 } = day1();
    let meal = '';
    const a = produce(doc, (d) => {
      updateDay(d, 1, { callTime: '08:00' });
      meal = addBanner(d, 1, 'repas');
      moveBanner(d, 1, meal, -1);
    });
    const ag = dayAgenda(a, 1);
    const m = ag.find((x) => x.type === 'banner')!;
    const after = ag.find((x) => x.type === 'strip' && x.strip.seqId === s2)!;
    const k = dayKeyTimes(a, 1);
    expect(k.meal).toEqual({ start: m.start, end: m.end, computed: { start: true, end: true } });
    // La reprise commence à la séquence qui suit le repas et court jusqu'à la fin du déroulé.
    expect(k.restart).toEqual({ start: after.start, end: after.end });
    expect(k.wrapComputed).toBe(true);
    const b = produce(a, (d) => setDayMeal(d, 1, { start: '12:30' }));
    expect(b.schedule!.days[0].meal).toBeUndefined();
    expect(b.schedule!.days[0].banners![0]).toMatchObject({ start: '12:30', minutes: 60 });
    const c = produce(b, (d) => setDayMeal(d, 1, { end: '13:15' }));
    expect(c.schedule!.days[0].banners![0].minutes).toBe(45);
    expect(dayKeyTimes(c, 1)).toMatchObject({ meal: { start: '12:30', end: '13:15', computed: { start: false, end: false } }, restart: { start: '13:15' } });
    // Ancienne saisie sur le jour : elle prime, puis passe au bandeau à la première modification.
    const legacy = produce(a, (d) => updateDay(d, 1, { meal: '13:00' }));
    expect(dayKeyTimes(legacy, 1).meal).toMatchObject({ start: '13:00', end: '14:00' });
    const moved = produce(legacy, (d) => setDayMeal(d, 1, { end: '13:30' }));
    expect(moved.schedule!.days[0].banners![0]).toMatchObject({ start: '13:00', minutes: 30 });
  });
});
