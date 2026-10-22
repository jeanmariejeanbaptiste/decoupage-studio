import { sequenceCharacterIds } from './characters';
import { shotDurationSec } from './rows';
import { fold } from './text';
import type { Timing } from './timing';
import type { ID, ProjectDoc } from './types';

export interface ShootingDay {
  n: number;
  date?: string;
  label?: string;
  callTime?: string;
  notes?: string;
  /** Heures de convocation par personnage. */
  calls?: Record<ID, string>;
  /** Ancien format (horaires par séquence), conservé pour compatibilité. */
  slots?: Record<ID, { start?: string; end?: string }>;
  /** Adresse propre à ce jour pour un décor (sinon celle du Registre). */
  addresses?: Record<ID, string>;
  /** Adresse de tournage propre à une séquence ce jour-là (prioritaire). */
  seqAddresses?: Record<ID, string>;
  /** Emploi du temps de la journée : créneau de chaque plan (« HH:MM »). */
  timeline?: Record<ID, { start: string; end: string }>;
  /** Reprises d'un plan fractionné (après une pause, ou le lendemain) : créneaux supplémentaires. */
  parts?: Record<ID, Array<{ start: string; end: string }>>;
  /** Amplitude affichée de la journée. */
  dayStart?: string;
  dayEnd?: string;
}

export interface Schedule {
  days: ShootingDay[];
}

export interface Strip {
  seqId: ID;
  shotIds: ID[];
}

/** Jours connus : ceux déclarés et ceux portés par les plans, triés. */
export function scheduleDays(doc: ProjectDoc): ShootingDay[] {
  const map = new Map<number, ShootingDay>();
  for (const d of doc.schedule?.days ?? []) map.set(d.n, d);
  for (const s of Object.values(doc.shots))
    if (s.shootingDay !== undefined && !map.has(s.shootingDay)) map.set(s.shootingDay, { n: s.shootingDay });
  return [...map.values()].sort((a, b) => a.n - b.n);
}

/** Bandes de chaque jour (0 = non planifié) : une par séquence, dans l'ordre du plan de travail. */
export function stripsByDay(doc: ProjectDoc): Map<number, Strip[]> {
  const out = new Map<number, Strip[]>();
  const order = doc.schedule?.order ?? [];
  const seqRank = (id: ID) => {
    const i = order.indexOf(id);
    return i >= 0 ? i : order.length + doc.project.sequenceIds.indexOf(id);
  };
  const seqs = [...doc.project.sequenceIds].sort((a, b) => seqRank(a) - seqRank(b));
  // Un jour dont l'emploi du temps est entamé ne retient que les plans qui y sont placés.
  const timelines = new Map((doc.schedule?.days ?? []).filter((d) => d.timeline && Object.keys(d.timeline).length).map((d) => [d.n, d.timeline!]));
  const partsByShot = new Map<ID, number[]>();
  for (const d of doc.schedule?.days ?? []) for (const id of Object.keys(d.parts ?? {})) if (d.parts![id].length) partsByShot.set(id, [...(partsByShot.get(id) ?? []), d.n]);
  for (const seqId of seqs) {
    const byDay = new Map<number, ID[]>();
    for (const shotId of doc.sequences[seqId]?.shotIds ?? []) {
      const shot = doc.shots[shotId];
      if (!shot || shot.status === 'abandonné') continue;
      let day = shot.shootingDay ?? 0;
      if (timelines.has(day) && !timelines.get(day)![shotId]) day = 0;
      byDay.set(day, [...(byDay.get(day) ?? []), shotId]);
      // Plan fractionné : il figure aussi les jours où il a une reprise.
      for (const pd of partsByShot.get(shotId) ?? []) if (pd !== day) byDay.set(pd, [...(byDay.get(pd) ?? []), shotId]);
    }
    for (const [day, shotIds] of byDay) out.set(day, [...(out.get(day) ?? []), { seqId, shotIds }]);
  }
  return out;
}

export function ensureSchedule(doc: ProjectDoc): Schedule & { order?: ID[] } {
  doc.schedule ??= { days: [] };
  return doc.schedule;
}

export function addDay(doc: ProjectDoc): number {
  const sch = ensureSchedule(doc);
  const n = Math.max(0, ...scheduleDays(doc).map((d) => d.n)) + 1;
  sch.days.push({ n });
  return n;
}

export function updateDay(doc: ProjectDoc, n: number, patch: Partial<ShootingDay>): void {
  const sch = ensureSchedule(doc);
  const d = sch.days.find((x) => x.n === n);
  if (d) Object.assign(d, patch);
  else sch.days.push({ n, ...patch });
}

/** Supprime un jour : ses plans redeviennent non planifiés. */
export function removeDay(doc: ProjectDoc, n: number): void {
  const sch = ensureSchedule(doc);
  sch.days = sch.days.filter((d) => d.n !== n);
  for (const s of Object.values(doc.shots)) if (s.shootingDay === n) s.shootingDay = undefined;
}

export function assignShots(doc: ProjectDoc, shotIds: readonly ID[], day: number | undefined): void {
  for (const id of shotIds) if (doc.shots[id]) doc.shots[id].shootingDay = day || undefined;
  if (day) updateDay(doc, day, {});
}

/** Rang d'axe (premier jeton d'angle) pour regrouper les plans d'un même axe. */
function axisKey(doc: ProjectDoc, shotId: ID): string {
  return fold(doc.shots[shotId]?.angle[0] ?? '');
}

/**
 * Plan de travail suggéré (§15.3) : regroupe par décor, puis par comédiens communs, puis par axes,
 * et remplit des journées d'au plus `capacity` plans. Renvoie le nombre de jours utilisés.
 */
export function suggestSchedule(doc: ProjectDoc, capacity = 20): number {
  const cap = Math.max(1, Math.floor(capacity));
  const seqs = doc.project.sequenceIds.filter((id) =>
    doc.sequences[id]?.shotIds.some((s) => doc.shots[s]?.status !== 'abandonné'),
  );
  const decorOf = (id: ID) => doc.sequences[id]?.decorId ?? `seq:${id}`;
  // 1. Décors dans l'ordre de première apparition.
  const decors: string[] = [];
  for (const id of seqs) if (!decors.includes(decorOf(id))) decors.push(decorOf(id));
  const ordered: ID[] = [];
  for (const dec of decors) {
    // 2. Dans un décor : enchaîner les séquences qui partagent le plus de comédiens.
    const pool = seqs.filter((id) => decorOf(id) === dec);
    let current = pool.shift();
    while (current) {
      ordered.push(current);
      const cast = new Set(sequenceCharacterIds(doc, current));
      pool.sort((a, b) => {
        const sa = sequenceCharacterIds(doc, a).filter((c) => cast.has(c)).length;
        const sb = sequenceCharacterIds(doc, b).filter((c) => cast.has(c)).length;
        return sb - sa || doc.project.sequenceIds.indexOf(a) - doc.project.sequenceIds.indexOf(b);
      });
      current = pool.shift();
    }
  }
  // 3. Remplissage des journées ; dans une séquence, les plans d'un même axe restent groupés.
  let day = 1;
  let used = 0;
  let lastDecor: string | undefined;
  for (const seqId of ordered) {
    const shots = (doc.sequences[seqId]?.shotIds ?? []).filter((id) => doc.shots[id]?.status !== 'abandonné');
    const byAxis = [...shots].sort(
      (a, b) => axisKey(doc, a).localeCompare(axisKey(doc, b)) || shots.indexOf(a) - shots.indexOf(b),
    );
    // Changer de décor en cours de journée : on commence un nouveau jour si le reste ne tient pas.
    if (lastDecor !== undefined && decorOf(seqId) !== lastDecor && used > 0 && used + shots.length > cap) {
      day++;
      used = 0;
    }
    for (const id of byAxis) {
      if (used >= cap) {
        day++;
        used = 0;
      }
      doc.shots[id].shootingDay = day;
      used++;
    }
    lastDecor = decorOf(seqId);
  }
  if (ordered.length === 0) return 0;
  const sch = ensureSchedule(doc);
  sch.order = ordered;
  for (let n = 1; n <= day; n++) if (!sch.days.some((d) => d.n === n)) sch.days.push({ n });
  sch.days.sort((a, b) => a.n - b.n);
  return day;
}

export interface DayStats {
  shots: number;
  screenSec: number;
  decorIds: ID[];
  characterIds: ID[];
  sequenceIds: ID[];
}

export function dayStats(
  doc: ProjectDoc,
  timing: Timing,
  day: number,
  strips: Strip[] = stripsByDay(doc).get(day) ?? [],
): DayStats {
  const shotIds = strips.flatMap((s) => s.shotIds);
  const decorIds = [
    ...new Set(strips.map((s) => doc.sequences[s.seqId]?.decorId).filter((x): x is ID => !!x)),
  ];
  const characterIds = [
    ...new Set(
      shotIds
        .flatMap((id) => doc.shots[id]?.characterIds ?? [])
        .concat(strips.flatMap((s) => doc.sequences[s.seqId]?.characterIds ?? [])),
    ),
  ];
  return {
    shots: shotIds.length,
    screenSec: shotIds.reduce((n, id) => n + shotDurationSec(doc, timing, doc.shots[id]), 0),
    decorIds,
    characterIds,
    sequenceIds: strips.map((s) => s.seqId),
  };
}

export function setSlot(
  doc: ProjectDoc,
  day: number,
  seqId: ID,
  patch: { start?: string; end?: string },
): void {
  updateDay(doc, day, {});
  const d = ensureSchedule(doc).days.find((x) => x.n === day)!;
  d.slots = { ...(d.slots ?? {}), [seqId]: { ...(d.slots?.[seqId] ?? {}), ...patch } };
}

/** Bandes du jour triées par premier créneau de l'emploi du temps (les bandes sans horaire à la fin). */
export function stripsByTime(doc: ProjectDoc, day: number): Strip[] {
  const list = stripsByDay(doc).get(day) ?? [];
  const first = (s: Strip) => stripRange(doc, day, s)?.start ?? '99:99';
  return [...list].sort((a, b) => first(a).localeCompare(first(b)));
}

// --- Emploi du temps horaire ---------------------------------------------------------------

export const DEFAULT_DAY_START = '07:00';
export const DEFAULT_DAY_END = '21:00';
export const SLOT_MIN = 15;
export const DEFAULT_SHOT_MIN = 30;

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const fromMin = (min: number) => {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function dayOf(doc: ProjectDoc, day: number): ShootingDay {
  updateDay(doc, day, {});
  return ensureSchedule(doc).days.find((d) => d.n === day)!;
}

/** Place un plan dans l'emploi du temps du jour (il est affecté à ce jour au passage). */
export function placeShot(doc: ProjectDoc, day: number, shotId: ID, start: string, minutes?: number): void {
  if (!doc.shots[shotId]) return;
  for (const d of ensureSchedule(doc).days)
    if (d.n !== day && d.timeline?.[shotId]) delete d.timeline[shotId];
  doc.shots[shotId].shootingDay = day;
  const d = dayOf(doc, day);
  const prev = d.timeline?.[shotId];
  const dur = minutes ?? (prev ? toMin(prev.end) - toMin(prev.start) : DEFAULT_SHOT_MIN);
  d.timeline = {
    ...(d.timeline ?? {}),
    [shotId]: { start, end: fromMin(toMin(start) + Math.max(SLOT_MIN, dur)) },
  };
}

/** Enchaîne les plans d'une séquence (non encore placés) à partir d'un horaire. */
export function placeSequence(doc: ProjectDoc, day: number, shotIds: readonly ID[], start: string): void {
  let at = toMin(start);
  const tl = dayOf(doc, day).timeline ?? {};
  for (const id of shotIds) {
    if (tl[id]) continue;
    placeShot(doc, day, id, fromMin(at));
    at += DEFAULT_SHOT_MIN;
  }
}

export function unplaceShot(doc: ProjectDoc, day: number, shotId: ID): void {
  const d = ensureSchedule(doc).days.find((x) => x.n === day);
  if (d?.timeline) delete d.timeline[shotId];
  const shot = doc.shots[shotId];
  if (shot?.shootingDay === day) shot.shootingDay = undefined;
}

/** Allonge ou raccourcit un créneau (au moins un pas de 15 min). */
export function resizeShot(doc: ProjectDoc, day: number, shotId: ID, deltaMin: number): void {
  const slot = dayOf(doc, day).timeline?.[shotId];
  if (!slot) return;
  const start = toMin(slot.start);
  slot.end = fromMin(Math.max(start + SLOT_MIN, toMin(slot.end) + deltaMin));
}

export interface TimelineEntry {
  shotId: ID;
  /** 0 = créneau principal ; 1, 2… = reprises. */
  part: number;
  start: number;
  end: number;
  /** Colonne d'affichage quand des créneaux se chevauchent. */
  lane: number;
}

/** Créneaux du jour (plans encore affectés à ce jour), triés, avec colonnes de chevauchement. */
export function timelineOf(doc: ProjectDoc, day: number): TimelineEntry[] {
  const d = scheduleDays(doc).find((x) => x.n === day);
  const entries = Object.entries(d?.timeline ?? {})
    .filter(([id]) => doc.shots[id]?.shootingDay === day && doc.shots[id]?.status !== 'abandonné')
    .map(([shotId, s]) => ({ shotId, part: 0, start: toMin(s.start), end: toMin(s.end), lane: 0 }))
    .concat(
      Object.entries(d?.parts ?? {}).flatMap(([shotId, list]) =>
        doc.shots[shotId] && doc.shots[shotId].status !== 'abandonné' ? list.map((s, i) => ({ shotId, part: i + 1, start: toMin(s.start), end: toMin(s.end), lane: 0 })) : [],
      ),
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  for (const e of entries) {
    const lane = laneEnds.findIndex((end) => end <= e.start);
    e.lane = lane >= 0 ? lane : laneEnds.length;
    laneEnds[e.lane] = e.end;
  }
  return entries;
}

export function shotSlot(
  doc: ProjectDoc,
  day: number,
  shotId: ID,
): { start: string; end: string } | undefined {
  return doc.shots[shotId]?.shootingDay === day
    ? scheduleDays(doc).find((x) => x.n === day)?.timeline?.[shotId]
    : undefined;
}

/** Créneau couvert par une bande (du premier début au dernier fin de ses plans). */
export function stripRange(
  doc: ProjectDoc,
  day: number,
  strip: Strip,
): { start: string; end: string } | undefined {
  const slots = strip.shotIds
    .map((id) => shotSlot(doc, day, id))
    .filter((x): x is { start: string; end: string } => !!x);
  if (!slots.length) return undefined;
  return {
    start: fromMin(Math.min(...slots.map((s) => toMin(s.start)))),
    end: fromMin(Math.max(...slots.map((s) => toMin(s.end)))),
  };
}

export interface ItineraryStop {
  decorId?: ID;
  address: string;
  start?: string;
  end?: string;
  seqIds: ID[];
}

/** Déroulé de la journée : une étape par séquence, dans l’ordre horaire, avec sa plage et son adresse
 *  (adresse du jour pour la séquence, sinon du décor ce jour-là, sinon celle du Registre). */
export function dayItinerary(doc: ProjectDoc, day: number): ItineraryStop[] {
  const d = doc.schedule?.days.find((x) => x.n === day);
  return callSheetStrips(doc, day).map((strip) => {
    const decorId = doc.sequences[strip.seqId]?.decorId;
    const r = stripRange(doc, day, strip);
    const address =
      d?.seqAddresses?.[strip.seqId] ??
      (decorId ? (d?.addresses?.[decorId] ?? doc.decors[decorId]?.address) : undefined) ??
      '';
    return { decorId, address, start: r?.start, end: r?.end, seqIds: [strip.seqId] };
  });
}

/** Plans retenus pour la feuille de service (ceux du jour, dans l’ordre horaire). */
export function callSheetStrips(doc: ProjectDoc, day: number): Strip[] {
  return stripsByTime(doc, day);
}

// --- Plans fractionnés -------------------------------------------------------------------------

/** Coupe le créneau principal en deux : la seconde moitié devient une reprise, déplaçable. */
export function splitShot(doc: ProjectDoc, day: number, shotId: ID): void {
  const d = dayOf(doc, day);
  const slot = d.timeline?.[shotId];
  if (!slot) return;
  const [a, b] = [toMin(slot.start), toMin(slot.end)];
  if (b - a < 2 * SLOT_MIN) return;
  const mid = a + Math.round((b - a) / 2 / SLOT_MIN) * SLOT_MIN;
  slot.end = fromMin(mid);
  d.parts ??= {};
  (d.parts[shotId] ??= []).push({ start: fromMin(mid), end: fromMin(b) });
}

function partOf(doc: ProjectDoc, day: number, shotId: ID, part: number) {
  return dayOf(doc, day).parts?.[shotId]?.[part - 1];
}

/** Déplace une reprise dans la journée (même durée). */
export function placePart(doc: ProjectDoc, day: number, shotId: ID, part: number, start: string): void {
  const p = partOf(doc, day, shotId, part);
  if (!p) return;
  const dur = toMin(p.end) - toMin(p.start);
  p.start = start;
  p.end = fromMin(toMin(start) + dur);
}

export function resizePart(doc: ProjectDoc, day: number, shotId: ID, part: number, deltaMin: number): void {
  const p = partOf(doc, day, shotId, part);
  if (p) p.end = fromMin(Math.max(toMin(p.start) + SLOT_MIN, toMin(p.end) + deltaMin));
}

export function removePart(doc: ProjectDoc, day: number, shotId: ID, part: number): void {
  const d = dayOf(doc, day);
  const list = d.parts?.[shotId];
  if (!list) return;
  list.splice(part - 1, 1);
  if (!list.length) delete d.parts![shotId];
}

/** Envoie une reprise sur un autre jour (par exemple : commencé à 22h, terminé le lendemain). */
export function movePartToDay(doc: ProjectDoc, from: number, shotId: ID, part: number, to: number): void {
  const p = partOf(doc, from, shotId, part);
  if (!p || from === to) return;
  removePart(doc, from, shotId, part);
  const target = dayOf(doc, to);
  const start = toMin(target.dayStart ?? DEFAULT_DAY_START);
  target.parts ??= {};
  (target.parts[shotId] ??= []).push({ start: fromMin(start), end: fromMin(start + toMin(p.end) - toMin(p.start)) });
}

/** Jours où un plan a une reprise (en plus de son jour principal). */
export function partDays(doc: ProjectDoc, shotId: ID): number[] {
  return (doc.schedule?.days ?? []).filter((d) => d.parts?.[shotId]?.length).map((d) => d.n);
}

/** Tous les créneaux d'un plan pour un jour donné (principal puis reprises), « 10:00 – 12:00, 16:00 – 17:00 ». */
export function shotSlotsText(doc: ProjectDoc, day: number, shotId: ID): string {
  const main = shotSlot(doc, day, shotId);
  const parts = scheduleDays(doc).find((x) => x.n === day)?.parts?.[shotId] ?? [];
  return [...(main ? [main] : []), ...parts].map((s) => `${s.start} – ${s.end}`).join(', ');
}

/** Premier créneau d'un plan ce jour-là (principal, sinon première reprise). */
export function firstSlot(doc: ProjectDoc, day: number, shotId: ID): { start: string; end: string } | undefined {
  return shotSlot(doc, day, shotId) ?? scheduleDays(doc).find((x) => x.n === day)?.parts?.[shotId]?.[0];
}
