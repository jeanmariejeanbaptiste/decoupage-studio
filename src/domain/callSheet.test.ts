import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { produce } from 'immer';
import { buildFiction } from '../../seed/fiction';
import { callSheetDocument, scheduleDocument } from './documents';
import { callSheetCsv, scheduleCsv } from './exports';
import { characterNumbers } from './registry';
import { buildRav3 } from '../../seed/rav3';
import { addBanner, callSheetAgenda, dayAgenda, dayKeyTimes, assignShots, moveBanner, placeShot, setDayMeal, suggestSchedule, updateBanner, updateDay } from './schedule';

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

describe('plan de travail et feuille de service : un seul déroulé', () => {
  const meal = (ag: ReturnType<typeof dayAgenda>) => ag.find((x) => x.type === 'banner' && x.banner.kind === 'repas');
  const times = (ag: ReturnType<typeof dayAgenda>) => ag.map((x) => [x.type === 'strip' ? x.strip.seqId : x.banner.id, x.start, x.end]);

  it('mêmes horaires (repas, fin) depuis les deux pages, avant et après la saisie du repas', () => {
    const a = produce(buildRav3(), (d) => {
      suggestSchedule(d, 15);
      updateDay(d, 1, { callTime: '08:00' });
      addBanner(d, 1, 'repas');
      const first = Object.values(d.shots).find((s) => s.shootingDay === 1)!;
      placeShot(d, 1, first.id, '09:00');
    });
    const plan = dayAgenda(a, 1);
    const sheet = callSheetAgenda(a, 1);
    // La feuille ne garde que les bandes placées, mais chacune à l'horaire du plan de travail.
    expect(sheet.length).toBeLessThan(plan.length);
    for (const row of times(sheet)) expect(times(plan)).toContainEqual(row);
    const k = dayKeyTimes(a, 1);
    expect(k.meal).toMatchObject({ start: meal(plan)!.start, end: meal(plan)!.end });
    expect(meal(sheet)).toMatchObject({ start: meal(plan)!.start, end: meal(plan)!.end });
    // Bande en partie placée : elle ne se réduit pas à la plage de son seul plan placé.
    const strip = plan.find((x) => x.type === 'strip' && x.start === '09:00')!;
    expect(strip.end).not.toBe('09:30');
    // Fin du repas saisie sur la feuille : les deux pages la lisent pareil.
    const b = produce(a, (d) => setDayMeal(d, 1, { end: '13:00' }));
    expect(dayKeyTimes(b, 1).meal?.end).toBe('13:00');
    expect(meal(dayAgenda(b, 1))!.end).toBe('13:00');
    expect(meal(callSheetAgenda(b, 1))!.end).toBe('13:00');
    expect(dayKeyTimes(b, 1).meal!.end).toBe(meal(dayAgenda(b, 1))!.end);
  });
});

describe('tournage de nuit', () => {
  it('aucune heure au-delà de 24 h affichée ni exportée ; la saisie se lit après le rendez-vous', () => {
    let meal = '';
    const doc = produce(buildRav3(), (d) => {
      suggestSchedule(d, 15);
      updateDay(d, 1, { callTime: '20:00' });
      meal = addBanner(d, 1, 'repas');
    });
    const ag = dayAgenda(doc, 1);
    // Les calculs gardent des minutes non bouclées…
    expect(ag.some((x) => x.end && x.end > '24:00')).toBe(true);
    // … que rien n'affiche tel quel.
    const late = /\b(2[4-9]|3\d|4[0-7]):[0-5]\d\b/;
    for (const text of [callSheetDocument(doc, 1).html, scheduleDocument(doc).html, callSheetCsv(doc, 1), scheduleCsv(doc)]) {
      expect(text).not.toMatch(late);
      expect(text).toContain('(+1)');
    }
    const k = dayKeyTimes(doc, 1);
    const m = ag.find((x) => x.type === 'banner')!;
    expect(k.meal).toMatchObject({ start: m.start, end: m.end });
    // Saisie d'un début à 02:00 un jour à RDV 20:00 : le lendemain, pas avant le rendez-vous.
    const set = produce(doc, (d) => updateBanner(d, 1, meal, { start: '02:00' }));
    expect(set.schedule!.days.find((x) => x.n === 1)!.banners![0].start).toBe('26:00');
  });
});

describe('repas ajouté au déroulé', () => {
  it('se place à midi, et la reprise ne dure jamais zéro minute', () => {
    const doc = produce(buildRav3(), (d) => {
      suggestSchedule(d, 15);
      updateDay(d, 1, { callTime: '08:00' });
      addBanner(d, 1, 'repas');
    });
    const ag = dayAgenda(doc, 1);
    const i = ag.findIndex((x) => x.type === 'banner');
    const before = ag[i - 1];
    // Bandes 08:00–11:00 puis 11:00–15:00 : le repas suit la première (fin la plus proche de midi).
    expect(before).toMatchObject({ type: 'strip', end: '11:00' });
    expect(i).toBeLessThan(ag.length - 1);
    const k = dayKeyTimes(doc, 1);
    expect(k.restart?.start).toBe(ag[i + 1].start);
    expect(k.restart?.end).toBe(ag.at(-1)!.end);
    // Sans horaire : après la bande du milieu. Les autres bandeaux restent en fin de journée.
    const bare = produce(buildRav3(), (d) => {
      suggestSchedule(d, 15);
      addBanner(d, 1, 'repas');
      addBanner(d, 1, 'trajet');
    });
    const ag2 = dayAgenda(bare, 1);
    const strips = ag2.filter((x) => x.type === 'strip').length;
    expect(ag2.findIndex((x) => x.type === 'banner' && x.banner.kind === 'repas')).toBe(Math.ceil(strips / 2));
    expect(ag2.at(-1)).toMatchObject({ type: 'banner', banner: { kind: 'trajet' } });
  });

  it('repas en fin de journée : pas de reprise de 16:00 à 16:00, ni de nuit de 04:00 à 04:00', () => {
    for (const call of ['08:00', '20:00']) {
      const doc = produce(buildRav3(), (d) => {
        suggestSchedule(d, 15);
        updateDay(d, 1, { callTime: call });
        const id = addBanner(d, 1, 'trajet');
        d.schedule!.days.find((x) => x.n === 1)!.banners!.find((b) => b.id === id)!.kind = 'repas';
      });
      const k = dayKeyTimes(doc, 1);
      expect(k.meal).toBeDefined();
      expect(k.restart).toBeUndefined();
      expect(callSheetDocument(doc, 1).html).not.toContain('<th>Reprise</th>');
    }
  });
});

describe('feuille de service : distribution d’une séquence coupée sur deux jours', () => {
  it('la ligne de séquence ne cite que les comédiens des plans du jour, comme le tableau Comédiens', () => {
    const base = buildFiction();
    const seqId = base.project.sequenceIds.find((id) => base.sequences[id].shotIds.length >= 2)!;
    const [first, ...rest] = base.sequences[seqId].shotIds;
    const extra = Object.values(base.characters).find((c) => !base.sequences[seqId].characterIds.includes(c.id) && !base.shots[first].characterIds.includes(c.id))!;
    const doc = produce(base, (d) => {
      for (const id of rest) d.shots[id].characterIds = d.shots[id].characterIds.filter((c) => c !== extra.id);
      d.shots[rest[0]].characterIds.push(extra.id);
      assignShots(d, [first], 1);
      assignShots(d, rest, 2);
    });
    const n = characterNumbers(doc).get(extra.id)!;
    const html = callSheetDocument(doc, 1).html;
    const row = html.slice(html.indexOf('<h3>Séquences</h3>'), html.indexOf('<h3>Plans</h3>'));
    const cell = [...row.matchAll(/<td>([\d, ]*)<\/td><td class="time">\d+ pl\./g)].map((m) => m[1].split(', ').filter(Boolean).map(Number));
    expect(cell.flat()).not.toContain(n);
    expect(callSheetDocument(doc, 2).html).toContain(extra.name);
  });
});
