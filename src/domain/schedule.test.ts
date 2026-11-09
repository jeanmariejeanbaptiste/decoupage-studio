import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addDay, assignShots, dayStats, placeShot, removeDay, scheduleDays, stripsByDay, suggestSchedule, updateDay } from './schedule';
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
      d.sequences[b].decorId = dec[0];
      updateDay(d, 1, { addresses: { [dec[0]]: '12 rue des Lilas' }, seqAddresses: { [b]: 'Chez mamie' } });
    });
    const it1 = dayItinerary(next, 1);
    expect(it1[0]).toMatchObject({ address: '12 rue des Lilas', start: '08:00', end: '09:00', seqIds: [a] });
    expect(it1[it1.length - 1]).toMatchObject({ address: 'Chez mamie', start: '14:00', end: '14:30', seqIds: [b] });
  });
  it('feuille de service : seuls les plans placés comptent une fois l’emploi du temps entamé', async () => {
    const { callSheetStrips, assignShots: assign } = await import('./schedule');
    const doc = buildRav3();
    const s1 = doc.sequences[doc.project.sequenceIds[0]].shotIds;
    const before = produce(doc, (d) => assign(d, s1.slice(0, 4), 1));
    expect(callSheetStrips(before, 1).flatMap((s) => s.shotIds)).toHaveLength(4);
    const after = produce(before, (d) => placeShot(d, 1, s1[2], '09:00'));
    expect(callSheetStrips(after, 1).flatMap((s) => s.shotIds)).toEqual([s1[2]]);
  });
  it('fractionne un plan : pause dans la journée, reprise le lendemain', async () => {
    const { splitShot, placePart, movePartToDay, shotSlotsText, stripsByDay: byDay } = await import('./schedule');
    const doc = buildRav3();
    const id = doc.sequences[doc.project.sequenceIds[0]].shotIds[0];
    const next = produce(doc, (d) => {
      placeShot(d, 1, id, '10:00', 240);
      splitShot(d, 1, id);
      placePart(d, 1, id, 1, '16:00');
    });
    expect(shotSlotsText(next, 1, id)).toBe('10:00 – 12:00, 16:00 – 18:00');
    expect(timelineOf(next, 1).map((e) => e.part)).toEqual([0, 1]);
    const night = produce(next, (d) => movePartToDay(d, 1, id, 1, 2));
    expect(shotSlotsText(night, 2, id)).toBe('07:00 – 09:00');
    expect(byDay(night).get(2)?.flatMap((s) => s.shotIds)).toContain(id);
    expect(byDay(night).get(1)?.flatMap((s) => s.shotIds)).toContain(id);
  });
});

describe('plan de travail : cohérence des jours', () => {
  it('une séquence déposée sur un jour entamé s’y enchaîne (rien ne disparaît)', async () => {
    const { assignShots: assign, stripsByDay: byDay, callSheetStrips } = await import('./schedule');
    const doc = buildRav3();
    const s1 = doc.sequences[doc.project.sequenceIds[0]].shotIds;
    const s2 = doc.sequences[doc.project.sequenceIds[1]].shotIds;
    let d = produce(doc, (x) => placeShot(x, 1, s1[0], '09:00'));
    d = produce(d, (x) => assign(x, s2, 1));
    expect(byDay(d).get(1)?.flatMap((s) => s.shotIds)).toEqual(expect.arrayContaining([s1[0], ...s2]));
    expect(callSheetStrips(d, 1).flatMap((s) => s.shotIds)).toEqual(expect.arrayContaining(s2));
  });

  it('la suggestion garde les plans tournés et retire les créneaux périmés', async () => {
    const { suggestSchedule } = await import('./schedule');
    const doc = buildRav3();
    const id = doc.sequences[doc.project.sequenceIds[6]].shotIds[0];
    const d = produce(doc, (x) => {
      placeShot(x, 5, id, '10:00');
      x.shots[id].status = 'tourné';
      suggestSchedule(x, 10);
    });
    expect(d.shots[id].shootingDay).toBe(5);
    for (const day of d.schedule!.days) for (const sid of Object.keys(day.timeline ?? {})) expect(d.shots[sid].shootingDay).toBe(day.n);
  });

  it('supprimer ou dupliquer un plan ne laisse pas de créneau orphelin', async () => {
    const { deleteShot, duplicateShot } = await import('./ops');
    const doc = buildRav3();
    const id = doc.sequences[doc.project.sequenceIds[0]].shotIds[0];
    const d = produce(doc, (x) => {
      placeShot(x, 1, id, '09:00');
      const copy = duplicateShot(x, id);
      expect(x.shots[copy].shootingDay).toBeUndefined();
      deleteShot(x, id);
    });
    expect(d.schedule!.days.find((x) => x.n === 1)!.timeline?.[id]).toBeUndefined();
  });

  it('tournage de nuit : la fin avant le début se lit le lendemain', async () => {
    const { dayEndMin, showTime } = await import('./schedule');
    expect(dayEndMin('18:00', '04:00')).toBe(28 * 60);
    expect(showTime('25:30')).toBe('01:30 (+1)');
  });
});

describe('plan de travail : en-têtes et codage des bandes', () => {
  it('date longue, titre « jour n sur N » et rendez-vous', async () => {
    const { longDate, dayTitle } = await import('./schedule');
    expect(longDate('2026-11-16')).toBe('lundi 16 novembre 2026');
    expect(longDate('n’importe quoi')).toBe('');
    expect(longDate(undefined)).toBe('');
    expect(dayTitle({ n: 2, date: '2026-11-16', callTime: '07:00' }, 5)).toBe('Jour 2 sur 5 · lundi 16 novembre 2026 · RDV 07:00');
    expect(dayTitle({ n: 1 }, 1)).toBe('Jour 1 sur 1');
  });

  it('totaux du jour : séquences, plans, durée, décors, comédiens (sans les figurants)', async () => {
    const { dayTotalsText } = await import('./schedule');
    const doc = buildRav3();
    const [a, b] = doc.project.sequenceIds;
    const next = produce(doc, (d) => assignShots(d, [...d.sequences[a].shotIds, ...d.sequences[b].shotIds], 1));
    const st = dayStats(next, computeTiming(next), 1);
    const cast = st.characterIds.filter((id) => next.characters[id].kind !== 'figurant').length;
    const text = dayTotalsText(next, st);
    expect(text).toMatch(new RegExp(`^2 séq\\. · ${st.shots} plans · \\d+:\\d\\d d’écran · ${st.decorIds.length} décors? · ${cast} comédiens?$`));
  });

  it('bandes : INT/EXT × jour, nuit, aube et crépuscule', async () => {
    const { stripTone } = await import('./schedule');
    expect(stripTone({ intExt: 'INT', effect: 'JOUR' })).toBe('int-day');
    expect(stripTone({ intExt: 'EXT', effect: 'JOUR' })).toBe('ext-day');
    expect(stripTone({ intExt: 'INT/EXT', effect: 'NUIT' })).toBe('ext-night');
    expect(stripTone({ intExt: 'INT', effect: 'NUIT' })).toBe('int-night');
    expect(stripTone({ intExt: 'EXT', effect: 'AUBE' })).toBe('ext-twilight');
    expect(stripTone({ effect: 'CRÉPUSCULE' })).toBe('int-twilight');
    expect(stripTone(undefined)).toBe('int-day');
  });

  it('supprimer un jour renumérote les suivants (plans et créneaux suivent)', () => {
    const doc = buildRav3();
    const [a, b] = doc.project.sequenceIds;
    const next = produce(doc, (d) => {
      assignShots(d, d.sequences[a].shotIds, 1);
      assignShots(d, d.sequences[b].shotIds.slice(0, 1), 3);
      placeShot(d, 3, d.sequences[b].shotIds[0], '09:00');
      removeDay(d, 1);
    });
    expect(scheduleDays(next).map((x) => x.n)).toEqual([1]);
    expect(next.shots[doc.sequences[b].shotIds[0]].shootingDay).toBe(1);
    expect(next.schedule!.days.find((x) => x.n === 1)!.timeline?.[doc.sequences[b].shotIds[0]]).toEqual({ start: '09:00', end: '09:30' });
  });
});

describe('plan de travail : bandeaux et horaires en cascade', () => {
  const setup = () => {
    const doc = buildRav3();
    const [a, b] = doc.project.sequenceIds;
    return {
      a,
      b,
      doc: produce(doc, (d) => {
        assignShots(d, d.sequences[a].shotIds.slice(0, 2), 1);
        assignShots(d, d.sequences[b].shotIds.slice(0, 1), 1);
      }),
    };
  };

  it('lit un créneau saisi librement', async () => {
    const { parseSlot } = await import('./schedule');
    expect(parseSlot('10:30–11:00')).toEqual({ start: '10:30', end: '11:00' });
    expect(parseSlot('10h30 - 11h')).toEqual({ start: '10:30', end: '11:00' });
    expect(parseSlot('23:00-01:00')).toEqual({ start: '23:00', end: '25:00' });
    expect(parseSlot('matin')).toBeUndefined();
  });

  it('sans rendez-vous ni créneau, aucun horaire n’est inventé', async () => {
    const { dayAgenda } = await import('./schedule');
    const { doc } = setup();
    expect(dayAgenda(doc, 1).every((i) => !i.start && !i.computed)).toBe(true);
  });

  it('enchaîne bandes et bandeaux depuis le rendez-vous, selon les durées prévues', async () => {
    const { addBanner, dayAgenda, agendaEnd, setStripMinutes, updateBanner } = await import('./schedule');
    const { doc, a, b } = setup();
    let inst = '';
    let meal = '';
    const next = produce(doc, (d) => {
      updateDay(d, 1, { callTime: '07:00' });
      inst = addBanner(d, 1, 'installation');
      meal = addBanner(d, 1, 'repas');
      setStripMinutes(d, 1, b, 45);
    });
    // Les bandeaux ajoutés se placent en fin de journée ; on remonte l'installation en tête.
    const { moveBanner } = await import('./schedule');
    const ordered = produce(next, (d) => {
      moveBanner(d, 1, inst, -1);
      moveBanner(d, 1, inst, -1);
      moveBanner(d, 1, inst, -1);
      moveBanner(d, 1, meal, -1);
    });
    const ag = dayAgenda(ordered, 1);
    expect(ag.map((i) => (i.type === 'strip' ? i.strip.seqId : i.banner.kind))).toEqual(['installation', a, 'repas', b]);
    expect(ag.map((i) => [i.start, i.end, i.computed])).toEqual([
      ['07:00', '08:00', true],
      ['08:00', '09:00', true],
      ['09:00', '10:00', true],
      ['10:00', '10:45', true],
    ]);
    expect(agendaEnd(ag)).toBe('10:45');
    // Un début imposé fait foi ; la suite s'enchaîne après lui.
    const fixed = produce(ordered, (d) => updateBanner(d, 1, meal, { start: '12:30', label: 'cantine' }));
    const ag2 = dayAgenda(fixed, 1);
    expect(ag2[2]).toMatchObject({ start: '12:30', end: '13:30', computed: false });
    expect(ag2[3]).toMatchObject({ start: '13:30', end: '14:15', computed: true });
  });

  it('les créneaux de l’emploi du temps priment ; un bandeau orphelin suit la bande qui précédait sa séquence', async () => {
    const { addBanner, dayAgenda, dayItinerary, removeBanner } = await import('./schedule');
    const { doc, a, b } = setup();
    let pause = '';
    const next = produce(doc, (d) => {
      updateDay(d, 1, { callTime: '07:00' });
      placeShot(d, 1, d.sequences[b].shotIds[0], '09:00', 60);
      pause = addBanner(d, 1, 'pause');
    });
    const ag = dayAgenda(next, 1);
    // Bande placée d'abord (09:00–10:00, saisie), puis la bande sans créneau, enchaînée après elle.
    expect(ag[0]).toMatchObject({ type: 'strip', start: '09:00', end: '10:00', computed: false });
    expect(ag[1]).toMatchObject({ type: 'strip', start: '10:00', end: '11:00', computed: true });
    expect(ag[2]).toMatchObject({ type: 'banner', start: '11:00', end: '11:15' });
    expect(dayItinerary(next, 1).map((x) => x.seqIds[0])).toEqual([b]);
    // Sa séquence (a) quitte la journée : aucune bande du jour ne la précède, le bandeau passe en tête.
    const orphan = produce(next, (d) => assignShots(d, d.sequences[a].shotIds, undefined));
    expect(dayAgenda(orphan, 1)[0]).toMatchObject({ type: 'banner' });
    // Rattaché à une séquence absente qui suit c dans l'ordre : il vient après c, pas en fin de journée.
    const c = doc.project.sequenceIds[2];
    const after = produce(next, (d) => {
      placeShot(d, 1, d.sequences[c].shotIds[0], '08:00', 60);
      d.schedule!.days[0].banners![0].after = doc.project.sequenceIds[3];
    });
    expect(dayAgenda(after, 1).map((i) => (i.type === 'strip' ? i.strip.seqId : 'pause'))).toEqual([c, 'pause', b, a]);
    expect(dayAgenda(produce(next, (d) => removeBanner(d, 1, pause)), 1).some((i) => i.type === 'banner')).toBe(false);
  });

  it('créneau d’une séquence (institutionnel) : horaire si elle est entière, sinon sa part de durée', async () => {
    const { dayAgenda, stripMinutes } = await import('./schedule');
    const { doc, a, b } = setup();
    const next = produce(doc, (d) => {
      updateDay(d, 1, { callTime: '07:00' });
      d.sequences[b].slot = '14:00–15:00';
      d.sequences[a].slot = '08:00–10:00';
      for (const id of d.sequences[b].shotIds.slice(1)) d.shots[id].status = 'abandonné';
    });
    const ag = dayAgenda(next, 1);
    const sb = ag.find((i) => i.type === 'strip' && i.strip.seqId === b)!;
    expect(sb).toMatchObject({ start: '14:00', end: '15:00', computed: false });
    const sa = ag.find((i) => i.type === 'strip' && i.strip.seqId === a)!;
    const share = Math.round((120 * 2) / next.sequences[a].shotIds.length / 5) * 5;
    expect(sa.type === 'strip' && stripMinutes(next, 1, sa.strip)).toBe(Math.max(15, share));
  });
});

describe('plan de travail et versions du film', () => {
  const prepared = async () => {
    const { placeSequence, timelineOf } = await import('./schedule');
    const { createVersion } = await import('./versions');
    const v1 = produce(buildRav3(), (d) => {
      suggestSchedule(d, 6);
      const day2 = Object.values(d.shots).filter((s) => s.shootingDay === 2).map((s) => s.id);
      placeSequence(d, 2, day2, '09:00');
    });
    let v1Id = '';
    const v2 = produce(v1, (d) => {
      createVersion(d, 'V2');
      v1Id = d.versions![0].id;
    });
    return { v1, v2, v1Id, timelineOf };
  };

  it('Répartir dans une version garde l’emploi du temps des plans qu’une autre version tient', async () => {
    const { deleteSequence } = await import('./ops');
    const { switchVersion } = await import('./versions');
    const { v1, v2, v1Id, timelineOf } = await prepared();
    const placed = timelineOf(v1, 2).length;
    expect(placed).toBeGreaterThan(0);
    const seqOfDay2 = v1.shots[timelineOf(v1, 2)[0].shotId].sequenceId;
    const cut = produce(v2, (d) => deleteSequence(d, seqOfDay2));
    const spread = produce(cut, (d) => void suggestSchedule(d, 6));
    const back = produce(spread, (d) => switchVersion(d, v1Id));
    expect(timelineOf(back, 2)).toHaveLength(placed);
    // Plan commun dont Répartir change le jour dans V2 : son créneau reste pour V1.
    const moved = produce(v2, (d) => void suggestSchedule(d, 3));
    expect(timelineOf(produce(moved, (d) => switchVersion(d, v1Id)), 2)).toHaveLength(placed);
  });

  it('supprimer un jour dans une version renumérote aussi les autres versions', async () => {
    const { switchVersion } = await import('./versions');
    const { v1, v2, v1Id } = await prepared();
    const count = scheduleDays(v1).length;
    const day2Shots = Object.values(v1.shots).filter((s) => s.shootingDay === 2).map((s) => s.id);
    const day1Shots = Object.values(v1.shots).filter((s) => s.shootingDay === 1).map((s) => s.id);
    const next = produce(v2, (d) => removeDay(d, 1));
    const back = produce(next, (d) => switchVersion(d, v1Id));
    expect(scheduleDays(back).map((x) => x.n)).toEqual(Array.from({ length: count - 1 }, (_, i) => i + 1));
    for (const id of day2Shots) expect(back.shots[id].shootingDay).toBe(1);
    for (const id of day1Shots) expect(back.shots[id].shootingDay).toBeUndefined();
  });
});
