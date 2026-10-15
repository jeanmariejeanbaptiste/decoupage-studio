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
  /** Horaires de tournage de chaque séquence du jour. */
  slots?: Record<ID, { start?: string; end?: string }>;
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
  for (const s of Object.values(doc.shots)) if (s.shootingDay !== undefined && !map.has(s.shootingDay)) map.set(s.shootingDay, { n: s.shootingDay });
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
  for (const seqId of seqs) {
    const byDay = new Map<number, ID[]>();
    for (const shotId of doc.sequences[seqId]?.shotIds ?? []) {
      const shot = doc.shots[shotId];
      if (!shot || shot.status === 'abandonné') continue;
      const day = shot.shootingDay ?? 0;
      byDay.set(day, [...(byDay.get(day) ?? []), shotId]);
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
  const seqs = doc.project.sequenceIds.filter((id) => doc.sequences[id]?.shotIds.some((s) => doc.shots[s]?.status !== 'abandonné'));
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
    const byAxis = [...shots].sort((a, b) => axisKey(doc, a).localeCompare(axisKey(doc, b)) || shots.indexOf(a) - shots.indexOf(b));
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

export function dayStats(doc: ProjectDoc, timing: Timing, day: number): DayStats {
  const strips = stripsByDay(doc).get(day) ?? [];
  const shotIds = strips.flatMap((s) => s.shotIds);
  const decorIds = [...new Set(strips.map((s) => doc.sequences[s.seqId]?.decorId).filter((x): x is ID => !!x))];
  const characterIds = [...new Set(shotIds.flatMap((id) => doc.shots[id]?.characterIds ?? []).concat(strips.flatMap((s) => doc.sequences[s.seqId]?.characterIds ?? [])))];
  return {
    shots: shotIds.length,
    screenSec: shotIds.reduce((n, id) => n + shotDurationSec(doc, timing, doc.shots[id]), 0),
    decorIds,
    characterIds,
    sequenceIds: strips.map((s) => s.seqId),
  };
}

export function setSlot(doc: ProjectDoc, day: number, seqId: ID, patch: { start?: string; end?: string }): void {
  updateDay(doc, day, {});
  const d = ensureSchedule(doc).days.find((x) => x.n === day)!;
  d.slots = { ...(d.slots ?? {}), [seqId]: { ...(d.slots?.[seqId] ?? {}), ...patch } };
}

/** Bandes du jour triées par horaire de début (les bandes sans horaire gardent leur ordre, à la fin). */
export function stripsByTime(doc: ProjectDoc, day: number): Strip[] {
  const slots = scheduleDays(doc).find((d) => d.n === day)?.slots ?? {};
  const list = stripsByDay(doc).get(day) ?? [];
  return [...list].sort((a, b) => (slots[a.seqId]?.start ?? '99') .localeCompare(slots[b.seqId]?.start ?? '99'));
}
