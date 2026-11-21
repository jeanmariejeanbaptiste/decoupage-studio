import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import {
  addDays,
  addEvent,
  addMonths,
  busyDates,
  calendarIcs,
  calendarItems,
  eventFields,
  eventFromFields,
  eventItem,
  eventsOn,
  timeOn,
  hourRange,
  newEventFields,
  isoWeek,
  itemsOn,
  layoutDay,
  monthGrid,
  periodTitle,
  moveEvent,
  removeEvent,
  autoEndDate,
  shiftAnchor,
  shiftStart,
  updateEvent,
  weekDays,
  weekday,
  yearMonths,
  type CalendarItem,
} from './calendar';
import { assignShots, updateDay } from './schedule';

describe('dates du calendrier', () => {
  it('additionne jours et mois, sans trébucher sur les fins de mois ni le changement d’heure', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-09', -11)).toBe('2025-12-09');
    expect(shiftAnchor('2026-11-09', 'year', 1)).toBe('2027-11-09');
    expect(shiftAnchor('2026-11-09', 'week', -1)).toBe('2026-11-02');
  });

  it('commence la semaine le lundi et numérote les semaines ISO', () => {
    expect(weekday('2026-11-09')).toBe(0);
    expect(weekday('2026-11-15')).toBe(6);
    expect(weekDays('2026-11-11')[0]).toBe('2026-11-09');
    expect(isoWeek('2026-11-09')).toEqual({ year: 2026, week: 46 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 });
  });

  it('construit la grille d’un mois (semaines nécessaires seulement)', () => {
    const nov = monthGrid('2026-11-20');
    expect(nov).toHaveLength(6);
    expect(nov[0].days[0]).toBe('2026-10-26');
    expect(nov[0].days[6]).toBe('2026-11-01');
    expect(nov[5].days[0]).toBe('2026-11-30');
    expect(nov[0].week).toBe(44);
    // Février 2027 commence un lundi : quatre semaines pile.
    expect(monthGrid('2027-02-10')).toHaveLength(4);
    expect(yearMonths('2026-05-03')).toHaveLength(12);
    expect(yearMonths('2026-05-03')[11]).toBe('2026-12-01');
  });

  it('titre la période selon la vue', () => {
    expect(periodTitle('2026-11-09', 'month')).toEqual({ main: 'Novembre', sub: '2026' });
    expect(periodTitle('2026-11-09', 'year')).toEqual({ main: '2026', sub: '' });
    expect(periodTitle('2026-11-09', 'day').main).toBe('Lundi 9 novembre');
    expect(periodTitle('2026-11-30', 'week')).toEqual({ main: 'Novembre – Décembre', sub: '2026' });
    expect(periodTitle('2026-12-31', 'week')).toEqual({ main: 'Décembre 2026 – Janvier', sub: '2027' });
  });
});

describe('éléments du calendrier', () => {
  it('normalise un rendez-vous : fin par défaut, fin antérieure corrigée, date invalide écartée', () => {
    expect(eventItem({ id: 'a', title: 'Repérages', start: '2026-11-10T14:00' })).toMatchObject({ date: '2026-11-10', start: '14:00', end: '15:00', allDay: false });
    expect(eventItem({ id: 'a', title: 'X', start: '2026-11-10T14:00', end: '2026-11-10T09:00' })?.end).toBe('15:00');
    expect(eventItem({ id: 'b', title: 'Casting', start: '2026-11-10', end: '2026-11-12', allDay: true })).toMatchObject({ endDate: '2026-11-12', allDay: true });
    expect(eventItem({ id: 'c', title: '?', start: 'demain' })).toBeUndefined();
  });

  it('ajoute, modifie et supprime un rendez-vous du projet', () => {
    const doc = buildRav3();
    let id = '';
    const a = produce(doc, (d) => {
      id = addEvent(d, { title: '  Lecture  ', start: '2026-11-12T10:00', end: '2026-11-12T12:00', note: '', kind: 'prep' });
    });
    expect(a.calendar).toEqual([{ id, title: 'Lecture', start: '2026-11-12T10:00', end: '2026-11-12T12:00', kind: 'prep' }]);
    const b = produce(a, (d) => updateEvent(d, id, { start: '2026-11-13', end: undefined, allDay: true }));
    expect(b.calendar![0]).toEqual({ id, title: 'Lecture', start: '2026-11-13', allDay: true, kind: 'prep' });
    const c = produce(b, (d) => removeEvent(d, id));
    expect(c.calendar).toBeUndefined();
  });

  it('passe du formulaire au rendez-vous et retour', () => {
    const f = newEventFields('2026-11-10', 14);
    expect(f).toMatchObject({ start: '14:00', end: '15:00', allDay: false, kind: 'rdv' });
    expect(eventFromFields({ ...f, title: ' Repérages ', end: '14:00' })).toEqual({ title: 'Repérages', kind: 'rdv', note: undefined, start: '2026-11-10T14:00', end: '2026-11-10T15:00' });
    const allDay = eventFromFields({ ...f, allDay: true, endDate: '2026-11-12', note: 'Lycée' });
    expect(allDay).toMatchObject({ start: '2026-11-10', end: '2026-11-12', allDay: true, note: 'Lycée', title: 'Sans titre' });
    expect(eventFields({ id: 'x', ...allDay })).toMatchObject({ date: '2026-11-10', endDate: '2026-11-12', allDay: true, note: 'Lycée' });
    expect(eventFields({ id: 'y', title: 'A', start: '2026-11-10T08:15', end: '2026-11-10T09:45' })).toMatchObject({ start: '08:15', end: '09:45', allDay: false, kind: 'autre' });
  });

  it('tournage de nuit : la fin avant le début tombe le lendemain, seulement pour une nuit', () => {
    const f = { ...newEventFields('2026-11-10', 20), title: 'Tournage de nuit', end: '02:00' };
    const ev = eventFromFields(f);
    expect(ev).toMatchObject({ start: '2026-11-10T20:00', end: '2026-11-11T02:00' });
    expect(eventItem({ id: 'n', ...ev })).toMatchObject({ date: '2026-11-10', endDate: '2026-11-11', start: '20:00', end: '02:00', allDay: false });
    expect(eventFromFields(eventFields({ id: 'n', ...ev }))).toEqual(ev);
    const end = (start: string, endTime: string) => eventFromFields({ ...f, start, end: endTime }).end;
    // Une nuit : le lendemain.
    expect(end('22:00', '06:00')).toBe('2026-11-11T06:00');
    expect(end('20:00', '00:00')).toBe('2026-11-11T00:00');
    expect(end('18:00', '08:00')).toBe('2026-11-11T08:00');
    expect(end('16:00', '01:00')).toBe('2026-11-11T01:00');
    expect(end('23:30', '00:30')).toBe('2026-11-11T00:30');
    // Une coquille : une heure, le même jour.
    expect(end('14:00', '13:00')).toBe('2026-11-10T15:00');
    expect(end('14:00', '11:00')).toBe('2026-11-10T15:00');
    expect(end('09:00', '08:30')).toBe('2026-11-10T10:00');
    expect(end('14:00', '14:00')).toBe('2026-11-10T15:00');
    // Jour de fin donné (fenêtre) : respecté.
    expect(eventFromFields({ ...f, start: '10:00', end: '01:00', endDate: '2026-11-11' }).end).toBe('2026-11-11T01:00');
    expect(autoEndDate('2026-11-10', '22:00', '06:00')).toBe('2026-11-11');
    expect(autoEndDate('2026-11-10', '14:00', '13:00')).toBe('2026-11-10');
  });

  it('fin à minuit : « 00:00 » à l’écran et dans la fenêtre, le lendemain à 00:00 dans le .ics', () => {
    const late = eventFromFields({ ...newEventFields('2026-11-10', 22), title: 'Nuit', end: '00:00' });
    expect(late.end).toBe('2026-11-11T00:00');
    const it = eventItem({ id: 'm', ...late })!;
    expect(it).toMatchObject({ endDate: '2026-11-10', end: '00:00' });
    expect(itemsOn([it], '2026-11-11')).toHaveLength(0);
    expect(layoutDay([it], '2026-11-10', 7, 24)[0]).toMatchObject({ top: 15 * 60, height: 120 });
    expect(eventFields({ id: 'm', ...late })).toMatchObject({ end: '00:00', endDate: '2026-11-11' });
    expect(eventFromFields(eventFields({ id: 'm', ...late }))).toEqual(late);
    expect(calendarIcs([it], 'x', new Date('2026-11-09T08:00:00Z'))).toContain('DTSTART:20261110T220000\r\nDTEND:20261111T000000');
  });

  it('changer le début ou la date décale la fin du même écart, jour de fin compris', () => {
    const f = { ...newEventFields('2026-11-10', 9), end: '10:30' };
    expect(shiftStart(f, { start: '15:00' })).toMatchObject({ start: '15:00', end: '16:30', endDate: '2026-11-10' });
    expect(shiftStart(f, { start: '23:00' })).toMatchObject({ start: '23:00', end: '00:30', endDate: '2026-11-11' });
    const night = { ...f, start: '20:00', end: '02:00' };
    expect(shiftStart(night, { start: '21:00' })).toMatchObject({ end: '03:00', endDate: '2026-11-11' });
    // Une longue journée décalée au-delà de minuit garde sa durée, sans repli d'une heure.
    const long = shiftStart({ ...f, start: '08:00', end: '23:00' }, { start: '10:00' });
    expect(long).toMatchObject({ end: '01:00', endDate: '2026-11-11' });
    expect(eventFromFields(long).end).toBe('2026-11-11T01:00');
    const allDay = { ...f, allDay: true, endDate: '2026-11-12' };
    expect(shiftStart(allDay, { date: '2026-11-20' })).toMatchObject({ date: '2026-11-20', endDate: '2026-11-22' });
  });

  it('relit des rendez-vous abîmés sans planter, garde les autres à l’identique', async () => {
    const { migrate } = await import('./serialize');
    const good = [
      { id: 'a', title: 'Lecture', start: '2026-11-12T10:00', end: '2026-11-12T12:00', kind: 'prep' as const },
      { id: 'b', title: 'Repérages', start: '2026-11-13', end: '2026-11-15', allDay: true, note: 'Bretagne' },
    ];
    const doc = {
      ...buildRav3(),
      calendar: [
        ...good,
        null,
        { id: 'x', title: 3, start: 20270101 },
        { id: 'y', start: '2026-11-20T25:99', kind: 'inconnu', note: 4, end: 'jamais' },
        { title: 'Sans id', start: '2026-11-20' },
        { id: 'a', title: 'Double', start: '2026-11-21' },
      ],
    } as unknown as ReturnType<typeof buildRav3>;
    const out = migrate(doc);
    expect(out.calendar!.slice(0, 3)).toEqual([...good, { id: 'y', title: 'Sans titre', start: '2026-11-20', allDay: true }]);
    // Identifiant en double : gardé, sous un nouvel identifiant.
    expect(out.calendar).toHaveLength(4);
    expect(out.calendar![3]).toMatchObject({ title: 'Double', start: '2026-11-21' });
    expect(out.calendar![3].id).not.toBe('a');
    expect(() => calendarItems(out)).not.toThrow();
    expect(eventsOn(out, '2026-11-20').map((it) => it.title)).toEqual(['Sans titre']);
    const none = migrate({ ...buildRav3(), calendar: 'x' } as unknown as ReturnType<typeof buildRav3>);
    expect(none.calendar).toBeUndefined();
  });

  it('déplace un rendez-vous de quelques jours, heures et durée gardées', () => {
    const doc = produce(buildRav3(), (d) => {
      d.calendar = [
        { id: 'a', title: 'Lecture', start: '2026-11-10T14:00', end: '2026-11-10T16:00' },
        { id: 'b', title: 'Repérages', start: '2026-11-09', end: '2026-11-12', allDay: true },
        { id: 'c', title: 'Nuit', start: '2026-11-30T20:00', end: '2026-12-01T02:00' },
      ];
    });
    const moved = produce(doc, (d) => {
      moveEvent(d, 'a', 3);
      moveEvent(d, 'b', -2);
      moveEvent(d, 'c', 1);
    });
    expect(moved.calendar).toEqual([
      { id: 'a', title: 'Lecture', start: '2026-11-13T14:00', end: '2026-11-13T16:00' },
      { id: 'b', title: 'Repérages', start: '2026-11-07', end: '2026-11-10', allDay: true },
      { id: 'c', title: 'Nuit', start: '2026-12-01T20:00', end: '2026-12-02T02:00' },
    ]);
    expect(produce(doc, (d) => moveEvent(d, 'zz', 2))).toBe(doc);
  });

  it('montre les jours de tournage datés : « Jour n · décors », RDV', () => {
    const doc = buildRav3();
    const seq = doc.sequences[doc.project.sequenceIds[0]];
    const next = produce(doc, (d) => {
      assignShots(d, seq.shotIds, 1);
      updateDay(d, 1, { date: '2026-11-16', callTime: '07:30' });
      assignShots(d, doc.sequences[doc.project.sequenceIds[1]].shotIds, 2);
      addEvent(d, { title: 'Réunion', start: '2026-11-16T18:00' });
    });
    const items = calendarItems(next);
    // Le jour 2 n'a pas de date : il n'apparaît pas.
    expect(items).toHaveLength(2);
    const day = items[0];
    expect(day).toMatchObject({ source: 'shooting', day: 1, date: '2026-11-16', allDay: true, start: '07:30' });
    const decor = doc.decors[seq.decorId!]?.name;
    expect(day.title).toBe(decor ? `Jour 1 · ${decor}` : 'Jour 1');
    expect(itemsOn(items, '2026-11-16').map((x) => x.source)).toEqual(['shooting', 'project']);
    expect([...busyDates(items, '2026-11-01', '2026-11-30')]).toEqual(['2026-11-16']);
  });
});

describe('rendez-vous dans le plan de travail', () => {
  it('rappelle les rendez-vous d’un jour daté, sans les jours de tournage', () => {
    const doc = buildRav3();
    const next = produce(doc, (d) => {
      assignShots(d, doc.sequences[doc.project.sequenceIds[0]].shotIds, 1);
      updateDay(d, 1, { date: '2026-11-16', callTime: '07:30' });
      addEvent(d, { title: 'Réunion', start: '2026-11-16T18:00' });
      addEvent(d, { title: 'Casting', start: '2026-11-15', end: '2026-11-17', allDay: true });
      addEvent(d, { title: 'Nuit', start: '2026-11-15T22:00', end: '2026-11-16T02:00' });
      addEvent(d, { title: 'Autre jour', start: '2026-11-18T09:00' });
    });
    const items = eventsOn(next, '2026-11-16');
    expect(items.map((x) => x.title)).toEqual(['Casting', 'Nuit', 'Réunion']);
    expect(items.map((x) => timeOn(x, '2026-11-16'))).toEqual(['', '→ 02:00', '18:00']);
    expect(eventsOn(next, undefined)).toEqual([]);
    expect(eventsOn(next, '2026-11-19')).toEqual([]);
    // Le rendez-vous déplacé suit : il quitte ce jour.
    const moved = produce(next, (d) => updateEvent(d, d.calendar![0].id, { start: '2026-11-18T18:00' }));
    expect(eventsOn(moved, '2026-11-16').map((x) => x.title)).toEqual(['Casting', 'Nuit']);
  });
});

const timed = (key: string, date: string, start: string, end: string): CalendarItem => ({ key, title: key, date, endDate: date, start, end, allDay: false, source: 'project' });

describe('grille horaire', () => {
  it('place les éléments et partage la largeur de ceux qui se chevauchent', () => {
    const items = [timed('a', '2026-11-09', '09:00', '10:00'), timed('b', '2026-11-09', '09:30', '11:00'), timed('c', '2026-11-09', '10:15', '10:45'), timed('d', '2026-11-09', '14:00', '14:05')];
    const placed = layoutDay(items, '2026-11-09');
    const by = Object.fromEntries(placed.map((p) => [p.item.key, p]));
    expect(by.a).toMatchObject({ top: 120, height: 60, col: 0, cols: 2 });
    expect(by.b).toMatchObject({ top: 150, height: 90, col: 1, cols: 2 });
    // c commence après la fin de a : il reprend la première colonne.
    expect(by.c).toMatchObject({ col: 0, cols: 2 });
    // Durée minimale lisible, groupe à part.
    expect(by.d).toMatchObject({ top: 420, height: 15, col: 0, cols: 1 });
  });

  it('élargit la plage horaire aux éléments qui en débordent', () => {
    const items = [timed('a', '2026-11-09', '06:15', '07:00'), timed('b', '2026-11-10', '21:00', '23:30')];
    expect(hourRange(items, ['2026-11-09', '2026-11-10'])).toEqual({ from: 6, to: 24 });
    expect(hourRange(items, ['2026-11-11'])).toEqual({ from: 7, to: 22 });
  });
});

describe('export iCalendar', () => {
  it('écrit journées entières et rendez-vous minutés, échappe et replie les lignes', () => {
    const items: CalendarItem[] = [
      { key: 'd:1', title: 'Jour 1 · Cuisine, salon', date: '2026-11-16', endDate: '2026-11-16', start: '07:30', allDay: true, kind: 'tournage', source: 'shooting', day: 1 },
      { ...timed('e:x', '2026-11-17', '14:00', '15:30'), eventId: 'x', title: 'Repérages; lycée', note: 'Prendre les clés\nappeler le gardien', kind: 'rdv' },
      { ...timed('e:y', '2026-11-18', '09:00', '10:00'), eventId: 'y', title: 'É'.repeat(60) },
    ];
    const ics = calendarIcs(items, 'Mon film', new Date('2026-11-09T08:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:jour-1@decoupage-studio\r\nDTSTAMP:20261109T080000Z\r\nDTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261117\r\nSUMMARY:Jour 1 · Cuisine\\, salon · RDV 07:30\r\nCATEGORIES:Tournage\r\n');
    expect(ics).toContain('DTSTART:20261117T140000\r\nDTEND:20261117T153000\r\nSUMMARY:Repérages\\; lycée\r\nDESCRIPTION:Prendre les clés\\nappeler le gardien\r\nCATEGORIES:Rendez-vous');
    // Aucune ligne ne dépasse 75 octets ; la suite est précédée d'une espace.
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toMatch(/SUMMARY:É+\r\n É+/);
  });
});

describe('export iCalendar : identifiants des jours de tournage', () => {
  it('propres au projet et au jour, stables quand on supprime un jour ou change sa date', async () => {
    const { removeDay, suggestSchedule, updateDay } = await import('./schedule');
    const { migrate } = await import('./serialize');
    const dated = (id: string) =>
      produce(buildRav3(), (d) => {
        d.project.id = id;
        suggestSchedule(d, 15);
        updateDay(d, 1, { date: '2026-11-16' });
        updateDay(d, 2, { date: '2026-11-17' });
      });
    const uids = (doc: ReturnType<typeof buildRav3>) => [...calendarIcs(calendarItems(doc), 'x').matchAll(/UID:(jour-[^@]+)@/g)].map((m) => m[1]);
    const a = dated('projet-a');
    const b = dated('projet-b');
    expect(uids(a)).toHaveLength(2);
    expect(uids(a).some((u) => uids(b).includes(u))).toBe(false);
    const day2 = uids(a)[1];
    const removed = produce(a, (d) => removeDay(d, 1));
    expect(uids(removed)).toEqual([day2]);
    expect(uids(produce(removed, (d) => updateDay(d, 1, { date: '2026-12-01' })))).toEqual([day2]);
    // Jours d'un ancien fichier : un identifiant leur est donné au chargement.
    const old = produce(a, (d) => {
      for (const x of d.schedule!.days) delete x.id;
    });
    expect(migrate(old).schedule!.days.every((x) => !!x.id)).toBe(true);
  });
});
