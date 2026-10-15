import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addDay, assignShots, dayStats, removeDay, scheduleDays, stripsByDay, suggestSchedule, updateDay } from './schedule';
import { computeTiming } from './timing';

describe('plan de travail', () => {
  const doc = buildRav3();

  it('tout est non planifié au départ', () => {
    expect(scheduleDays(doc)).toEqual([]);
    expect(stripsByDay(doc).get(0)).toHaveLength(7);
  });

  it('ajoute des jours, affecte des plans, supprime un jour', () => {
    const s1 = doc.sequences[doc.project.sequenceIds[0]].shotIds;
    const next = produce(doc, (d) => {
      addDay(d);
      addDay(d);
      assignShots(d, s1.slice(0, 2), 2);
      assignShots(d, s1.slice(2), 5);
      updateDay(d, 1, { date: '2026-11-03' });
      d.shots[s1[5]].status = 'abandonné';
    });
    expect(scheduleDays(next).map((x) => x.n)).toEqual([1, 2, 5]);
    expect(scheduleDays(next)[0].date).toBe('2026-11-03');
    expect(stripsByDay(next).get(2)).toEqual([{ seqId: next.project.sequenceIds[0], shotIds: s1.slice(0, 2) }]);
    expect(stripsByDay(next).get(5)![0].shotIds).toHaveLength(3);
    const removed = produce(next, (d) => removeDay(d, 2));
    expect(removed.shots[s1[0]].shootingDay).toBeUndefined();
    const unassigned = produce(next, (d) => assignShots(d, s1, undefined));
    expect(unassigned.shots[s1[0]].shootingDay).toBeUndefined();
  });

  it('suggère un regroupement par décor, comédiens et axes', () => {
    let days = 0;
    const next = produce(doc, (d) => {
      days = suggestSchedule(d, 20);
    });
    expect(days).toBeGreaterThanOrEqual(3);
    const all = Object.values(next.shots);
    expect(all.every((s) => s.shootingDay !== undefined)).toBe(true);
    for (const day of scheduleDays(next)) expect(all.filter((s) => s.shootingDay === day.n).length).toBeLessThanOrEqual(20);
    // Dans la séquence 6, les plans « 3/4 Face » sont regroupés avant les « Face ».
    const t = computeTiming(next);
    const st = dayStats(next, t, 1);
    expect(st.shots).toBeGreaterThan(0);
    expect(st.screenSec).toBeGreaterThan(0);
    expect(st.decorIds.length).toBeGreaterThan(0);
    expect(dayStats(next, t, 99).shots).toBe(0);
    const empty = produce(doc, (d) => {
      for (const s of Object.values(d.shots)) s.status = 'abandonné';
      days = suggestSchedule(d, 0);
    });
    expect(days).toBe(0);
    expect(scheduleDays(empty)).toEqual([]);
  });
});

describe('emploi du temps horaire', async () => {
  const { placeShot, placeSequence, unplaceShot, resizeShot, timelineOf, toMin, fromMin, stripRange, stripsByDay } = await import('./schedule');
  it('place, enchaîne, chevauche, redimensionne et retire', () => {
    const doc = buildRav3();
    const s1 = doc.sequences[doc.project.sequenceIds[0]].shotIds;
    const next = produce(doc, (d) => {
      placeSequence(d, 1, s1.slice(0, 3), '08:00');
      placeShot(d, 1, s1[3], '08:15', 60);
      resizeShot(d, 1, s1[0], 15);
      resizeShot(d, 1, s1[1], -120);
      placeShot(d, 2, s1[2], '10:00');
      unplaceShot(d, 1, s1[3]);
      resizeShot(d, 1, 'absent', 15);
    });
    const tl = timelineOf(next, 1);
    expect(tl.map((e) => [fromMin(e.start), fromMin(e.end), e.lane])).toEqual([
      ['08:00', '08:45', 0],
      ['08:30', '08:45', 1],
    ]);
    expect(next.shots[s1[2]].shootingDay).toBe(2);
    expect(timelineOf(next, 2)).toHaveLength(1);
    expect(stripRange(next, 1, stripsByDay(next).get(1)![0])).toEqual({ start: '08:00', end: '08:45' });
    expect(toMin('25:99')).toBe(25 * 60 + 99);
    expect(fromMin(-5)).toBe('00:00');
  });

  it('déroulé par lieu avec plages et adresse du jour', async () => {
    const { dayItinerary } = await import('./schedule');
    const doc = buildRav3();
    const [a, b] = doc.project.sequenceIds;
    const next = produce(doc, (d) => {
      const dec = Object.keys(d.decors);
      d.sequences[a].decorId = dec[0];
      d.sequences[b].decorId = dec[1] ?? dec[0];
      placeSequence(d, 1, d.sequences[b].shotIds.slice(0, 1), '14:00');
      placeSequence(d, 1, d.sequences[a].shotIds.slice(0, 2), '08:00');
      updateDay(d, 1, { addresses: { [dec[0]]: '12 rue des Lilas' } });
    });
    const it1 = dayItinerary(next, 1);
    expect(it1[0]).toMatchObject({ address: '12 rue des Lilas', start: '08:00', end: '09:00', seqIds: [a] });
    expect(it1[it1.length - 1]).toMatchObject({ start: '14:00', end: '14:30' });
  });
});
