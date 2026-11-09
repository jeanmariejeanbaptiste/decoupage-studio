import { newId } from './factory';
import { scheduleDays, stripsByDay } from './schedule';
import type { ID, ProjectDoc } from './types';

/**
 * Calendrier du projet : rendez-vous saisis (dans le document) et jours de tournage du plan de travail
 * (déduits, en lecture seule). Les dates sont des chaînes locales « AAAA-MM-JJ », sans fuseau :
 * le calcul passe par l'UTC pour ne jamais trébucher sur un changement d'heure.
 */

export type CalendarKind = 'prep' | 'tournage' | 'post' | 'rdv' | 'autre';

export const CALENDAR_KINDS: ReadonlyArray<{ kind: CalendarKind; label: string }> = [
  { kind: 'rdv', label: 'Rendez-vous' },
  { kind: 'prep', label: 'Préparation' },
  { kind: 'tournage', label: 'Tournage' },
  { kind: 'post', label: 'Postproduction' },
  { kind: 'autre', label: 'Autre' },
];

export interface CalendarEvent {
  id: ID;
  title: string;
  /** « AAAA-MM-JJ » (journée entière) ou « AAAA-MM-JJTHH:MM ». */
  start: string;
  /** Journée entière : dernier jour inclus ; sinon fin « AAAA-MM-JJTHH:MM ». */
  end?: string;
  allDay?: boolean;
  note?: string;
  kind?: CalendarKind;
}

export type CalendarView = 'day' | 'week' | 'month' | 'year';

// --- Dates ------------------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const pad = (n: number) => String(n).padStart(2, '0');

function toUtc(date: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

const fromUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const isValidDate = (date: string | undefined): date is string => !!date && DATE_RE.test(date) && !Number.isNaN(toUtc(date).getTime());

/** Date locale du jour (« AAAA-MM-JJ »). */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export function addDays(date: string, n: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Mois suivants ou précédents ; le jour est ramené au dernier du mois s'il n'existe pas (31 → 30). */
export function addMonths(date: string, n: number): string {
  const d = toUtc(date);
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return fromUtc(first);
}

/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export const weekday = (date: string) => (toUtc(date).getUTCDay() + 6) % 7;
export const isWeekend = (date: string) => weekday(date) >= 5;
export const startOfWeek = (date: string) => addDays(date, -weekday(date));
export const startOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** Numéro de semaine ISO 8601 (la semaine 1 contient le premier jeudi de l'année). */
export function isoWeek(date: string): { year: number; week: number } {
  const thursday = toUtc(addDays(date, 3 - weekday(date)));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  return { year, week: Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1 };
}

export interface GridWeek {
  week: number;
  days: string[];
}

/** Grille d'un mois, lundi en tête : les semaines nécessaires (4 à 6), jours des mois voisins compris. */
export function monthGrid(date: string): GridWeek[] {
  const first = startOfMonth(date);
  const out: GridWeek[] = [];
  for (let start = startOfWeek(first); out.length === 0 || sameMonth(start, first); start = addDays(start, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    out.push({ week: isoWeek(start).week, days });
  }
  return out;
}

/** Les sept jours de la semaine d'une date, du lundi au dimanche. */
export const weekDays = (date: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));

/** Les douze mois d'une année (premier de chaque mois). */
export const yearMonths = (date: string) => Array.from({ length: 12 }, (_, i) => `${date.slice(0, 4)}-${pad(i + 1)}-01`);

/** Période suivante ou précédente de la vue. */
export function shiftAnchor(date: string, view: CalendarView, dir: -1 | 1): string {
  if (view === 'day') return addDays(date, dir);
  if (view === 'week') return addDays(date, 7 * dir);
  if (view === 'month') return addMonths(date, dir);
  return addMonths(date, 12 * dir);
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase('fr') + s.slice(1);
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { ...opts, timeZone: 'UTC' });
const monthFmt = fmt({ month: 'long' });
const dayFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' });

export const monthName = (date: string) => capital(monthFmt.format(toUtc(date)));

/** Titre de la période : partie forte et partie discrète (« Novembre » « 2026 »). */
export function periodTitle(date: string, view: CalendarView): { main: string; sub: string } {
  const year = date.slice(0, 4);
  if (view === 'year') return { main: year, sub: '' };
  if (view === 'day') return { main: capital(dayFmt.format(toUtc(date))), sub: year };
  if (view === 'week') {
    // Semaine à cheval sur deux mois : « Novembre – Décembre ».
    const days = weekDays(date);
    const a = monthName(days[0]);
    const b = monthName(days[6]);
    const ya = days[0].slice(0, 4);
    const yb = days[6].slice(0, 4);
    if (ya !== yb) return { main: `${a} ${ya} – ${b}`, sub: yb };
    return { main: a === b ? a : `${a} – ${b}`, sub: ya };
  }
  return { main: monthName(date), sub: year };
}

// --- Heures -----------------------------------------------------------------------------------

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function toMinutes(time: string | undefined): number | undefined {
  const m = time ? TIME_RE.exec(time) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export const fromMinutes = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// --- Éléments affichés --------------------------------------------------------------------------

/** Élément du calendrier, quelle que soit sa source. */
export interface CalendarItem {
  key: string;
  title: string;
  /** Premier et dernier jour (inclus). */
  date: string;
  endDate: string;
  /** Heures « HH:MM » d'un élément minuté ; heure indicative d'une journée entière (RDV). */
  start?: string;
  end?: string;
  allDay: boolean;
  kind?: CalendarKind;
  note?: string;
  source: 'project' | 'shooting';
  eventId?: ID;
  /** Jour de tournage (plan de travail). */
  day?: number;
}

/** Rendez-vous du projet mis à plat ; dates invalides écartées, fin manquante ou antérieure corrigée. */
export function eventItem(e: CalendarEvent): CalendarItem | undefined {
  const date = e.start.slice(0, 10);
  if (!isValidDate(date)) return undefined;
  const base = { key: `e:${e.id}`, title: e.title, date, kind: e.kind, note: e.note, source: 'project' as const, eventId: e.id };
  if (e.allDay || e.start.length <= 10) {
    const last = isValidDate(e.end) ? e.end.slice(0, 10) : date;
    return { ...base, endDate: last < date ? date : last, allDay: true };
  }
  const start = toMinutes(e.start.slice(11, 16)) ?? 0;
  const endDate = isValidDate(e.end) ? e.end.slice(0, 10) : date;
  let end = toMinutes(e.end?.slice(11, 16));
  // Fin absente ou avant le début : une heure par défaut, sans franchir minuit.
  if (end === undefined || endDate < date || (endDate === date && end <= start)) end = Math.min(start + 60, 24 * 60 - 1);
  return { ...base, endDate: endDate < date ? date : endDate, start: fromMinutes(start), end: fromMinutes(end), allDay: false };
}

/** Décors d'un jour de tournage, dans l'ordre des bandes. */
function dayDecors(doc: ProjectDoc, n: number, strips: ReturnType<typeof stripsByDay>): string[] {
  const names = (strips.get(n) ?? []).map((st) => doc.decors[doc.sequences[st.seqId]?.decorId ?? '']?.name?.trim()).filter((x): x is string => !!x);
  return [...new Set(names)];
}

/** Jours de tournage datés du plan de travail : journées entières « Jour n · décors », heure du RDV. */
export function shootingItems(doc: ProjectDoc): CalendarItem[] {
  const strips = stripsByDay(doc);
  return scheduleDays(doc)
    .filter((d) => isValidDate(d.date))
    .map((d) => {
      const decors = dayDecors(doc, d.n, strips);
      const where = decors.length > 2 ? `${decors.slice(0, 2).join(', ')} +${decors.length - 2}` : decors.join(', ');
      return {
        key: `d:${d.n}`,
        title: [`Jour ${d.n}`, where].filter(Boolean).join(' · '),
        date: d.date!,
        endDate: d.date!,
        start: toMinutes(d.callTime) !== undefined ? d.callTime : undefined,
        allDay: true,
        kind: 'tournage' as const,
        note: d.notes,
        source: 'shooting' as const,
        day: d.n,
      };
    });
}

const order = (a: CalendarItem, b: CalendarItem) =>
  a.date.localeCompare(b.date) ||
  Number(b.allDay) - Number(a.allDay) ||
  (a.start ?? '').localeCompare(b.start ?? '') ||
  Number(b.source === 'shooting') - Number(a.source === 'shooting') ||
  a.title.localeCompare(b.title, 'fr');

/** Tout le calendrier du projet, trié. */
export function calendarItems(doc: ProjectDoc): CalendarItem[] {
  const own = (doc.calendar ?? []).map(eventItem).filter((x): x is CalendarItem => !!x);
  return [...shootingItems(doc), ...own].sort(order);
}

/** Éléments présents un jour donné : journées entières d'abord, puis par heure. */
export function itemsOn(items: readonly CalendarItem[], date: string): CalendarItem[] {
  return items.filter((it) => it.date <= date && it.endDate >= date).sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.start ?? '').localeCompare(b.start ?? '') || order(a, b));
}

/**
 * Rendez-vous du projet tombant un jour donné (sans les jours de tournage) : ce que le plan de travail
 * rappelle sous l'en-tête d'un jour daté. Journées entières d'abord, puis par heure.
 */
export function eventsOn(doc: ProjectDoc, date: string | undefined): CalendarItem[] {
  if (!isValidDate(date)) return [];
  const own = (doc.calendar ?? []).map(eventItem).filter((x): x is CalendarItem => !!x);
  // Commencé la veille : en tête des éléments minutés.
  const from = (it: CalendarItem) => (it.date < date ? '' : (it.start ?? ''));
  return itemsOn(own, date).sort((a, b) => Number(b.allDay) - Number(a.allDay) || from(a).localeCompare(from(b)));
}

/** Heure d'un élément un jour donné : début ce jour-là, « jusqu'à » s'il a commencé avant ; rien pour une journée entière. */
export function timeOn(it: CalendarItem, date: string): string {
  if (it.allDay) return '';
  if (it.date === date) return it.start ?? '';
  return it.endDate === date ? `→ ${it.end}` : '';
}

/** Jours occupés (vue Année). */
export function busyDates(items: readonly CalendarItem[], from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    const a = it.date < from ? from : it.date;
    const b = it.endDate > to ? to : it.endDate;
    for (let d = a; d <= b; d = addDays(d, 1)) out.add(d);
  }
  return out;
}

/** Plage horaire d'une vue : 7 h – 22 h, élargie aux éléments minutés qui en débordent. */
export function hourRange(items: readonly CalendarItem[], dates: readonly string[], from = 7, to = 22): { from: number; to: number } {
  let a = from;
  let b = to;
  for (const date of dates)
    for (const it of itemsOn(items, date)) {
      if (it.allDay) continue;
      const s = it.date < date ? 0 : toMinutes(it.start)!;
      const e = it.endDate > date ? 24 * 60 : toMinutes(it.end)!;
      a = Math.min(a, Math.floor(s / 60));
      b = Math.max(b, Math.ceil(e / 60));
    }
  return { from: a, to: Math.min(24, b) };
}

export interface PlacedItem {
  item: CalendarItem;
  /** Minutes depuis le début de la grille, et durée (rognées à la grille). */
  top: number;
  height: number;
  /** Colonne et nombre de colonnes du groupe d'éléments qui se chevauchent. */
  col: number;
  cols: number;
}

/**
 * Éléments minutés d'un jour placés sur la grille horaire [from, to] (heures) : ceux qui se chevauchent
 * se partagent la largeur. Un élément sur plusieurs jours occupe la fin du premier, le début du dernier.
 */
export function layoutDay(items: readonly CalendarItem[], date: string, from = 7, to = 22): PlacedItem[] {
  const lo = from * 60;
  const hi = to * 60;
  const spans = itemsOn(items, date)
    .filter((it) => !it.allDay)
    .map((item) => {
      const a0 = item.date < date ? 0 : toMinutes(item.start)!;
      const b0 = item.endDate > date ? 24 * 60 : toMinutes(item.end)!;
      const a = Math.max(lo, Math.min(a0, hi - 15));
      return { item, a, b: Math.min(hi, Math.max(b0, a + 15)) };
    })
    .sort((x, y) => x.a - y.a || y.b - x.b);
  const out: PlacedItem[] = [];
  let group: Array<{ placed: PlacedItem; b: number }> = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.placed.col + 1));
    for (const g of group) g.placed.cols = cols;
    group = [];
  };
  for (const x of spans) {
    if (x.a >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    const taken = new Set(group.filter((g) => g.b > x.a).map((g) => g.placed.col));
    let col = 0;
    while (taken.has(col)) col++;
    const placed: PlacedItem = { item: x.item, top: x.a - lo, height: x.b - x.a, col, cols: 1 };
    group.push({ placed, b: x.b });
    out.push(placed);
    groupEnd = Math.max(groupEnd, x.b);
  }
  flush();
  return out;
}

// --- Rendez-vous du projet ------------------------------------------------------------------------

export function addEvent(doc: ProjectDoc, init: Omit<CalendarEvent, 'id'>): ID {
  const id = newId();
  (doc.calendar ??= []).push({ ...clean(init), id });
  return id;
}

export function updateEvent(doc: ProjectDoc, id: ID, patch: Partial<Omit<CalendarEvent, 'id'>>): void {
  const e = doc.calendar?.find((x) => x.id === id);
  if (!e) return;
  const next = clean({ ...e, ...patch });
  for (const k of Object.keys(e) as Array<keyof CalendarEvent>) if (k !== 'id') delete e[k];
  Object.assign(e, next);
}

export function removeEvent(doc: ProjectDoc, id: ID): void {
  if (!doc.calendar) return;
  doc.calendar = doc.calendar.filter((x) => x.id !== id);
  if (!doc.calendar.length) delete doc.calendar;
}

/** Champs du formulaire d'un rendez-vous (date, heures « HH:MM », dernier jour d'une journée entière). */
export interface EventFields {
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  endDate: string;
  kind: CalendarKind;
  note: string;
}

/** Nouveau rendez-vous : une heure à partir de `hour`, ou la journée entière. */
export function newEventFields(date: string, hour?: number, allDay = false): EventFields {
  const h = Math.max(0, Math.min(22, hour ?? 9));
  return { title: '', date, allDay, start: fromMinutes(h * 60), end: fromMinutes((h + 1) * 60), endDate: date, kind: 'rdv', note: '' };
}

export function eventFields(e: CalendarEvent): EventFields {
  const it = eventItem(e);
  const date = it?.date ?? todayIso();
  return {
    title: e.title,
    date,
    allDay: it?.allDay ?? true,
    start: it?.allDay ? '09:00' : (it?.start ?? '09:00'),
    end: it?.allDay ? '10:00' : (it?.end ?? '10:00'),
    endDate: it?.endDate ?? date,
    kind: e.kind ?? 'autre',
    note: e.note ?? '',
  };
}

/** Rendez-vous tiré du formulaire : fin avant le début corrigée (une heure, ou un seul jour). */
export function eventFromFields(f: EventFields): Omit<CalendarEvent, 'id'> {
  const base = { title: f.title.trim() || 'Sans titre', kind: f.kind, note: f.note.trim() || undefined };
  if (f.allDay) return { ...base, start: f.date, end: f.endDate > f.date ? f.endDate : undefined, allDay: true };
  const a = toMinutes(f.start) ?? 9 * 60;
  let b = toMinutes(f.end) ?? a + 60;
  if (b <= a) b = Math.min(a + 60, 24 * 60 - 1);
  return { ...base, start: `${f.date}T${fromMinutes(a)}`, end: `${f.date}T${fromMinutes(b)}` };
}

/** Champs vides retirés, titre rogné. */
function clean<T extends Omit<CalendarEvent, 'id'>>(e: T): T {
  const out = { ...e, title: e.title.trim() };
  for (const k of ['end', 'note', 'kind'] as const) if (!out[k]?.toString().trim()) delete out[k];
  if (!out.allDay) delete out.allDay;
  return out;
}

// --- Export iCalendar (RFC 5545) ----------------------------------------------------------------

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (date: string) => date.replace(/-/g, '');
const icsDateTime = (date: string, time: string) => `${icsDate(date)}T${time.replace(':', '')}00`;

/** Lignes de plus de 75 octets repliées (suite précédée d'une espace), sans couper un caractère. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Fichier .ics : rendez-vous du projet et jours de tournage, heures locales « flottantes ». */
export function calendarIcs(items: readonly CalendarItem[], name: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const kindLabel = (k?: CalendarKind) => CALENDAR_KINDS.find((x) => x.kind === k)?.label;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Découpage Studio//Calendrier//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(name)}`];
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.source === 'shooting' ? `jour-${it.day}` : it.eventId}@decoupage-studio`, `DTSTAMP:${stamp}`);
    if (it.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDate(it.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(it.endDate, 1))}`);
    else lines.push(`DTSTART:${icsDateTime(it.date, it.start!)}`, `DTEND:${icsDateTime(it.endDate, it.end!)}`);
    const summary = it.allDay && it.start ? `${it.title} · RDV ${it.start}` : it.title;
    lines.push(`SUMMARY:${icsText(summary)}`);
    if (it.note?.trim()) lines.push(`DESCRIPTION:${icsText(it.note.trim())}`);
    const cat = kindLabel(it.kind);
    if (cat) lines.push(`CATEGORIES:${icsText(cat)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
