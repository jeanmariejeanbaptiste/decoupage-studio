import { sequenceCharacterIds } from './characters';
import { newId } from './factory';
import { decorLocation } from './locations';
import { keptElsewhere } from './ops';
import { shotDurationSec } from './rows';
import { fold } from './text';
import { formatTc } from './timecode';
import type { Timing } from './timing';
import type { ID, ProjectDoc } from './types';

export interface ShootingDay {
  n: number;
  /** Identifiant stable (le numéro est renuméroté, la date peut changer) : sert à l'export .ics. */
  id?: ID;
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
  /** Feuille de service : horaires clés (prêt à tourner, repas de `meal` à `mealEnd`, fin prévue). */
  pat?: string;
  /** Début du repas (ancien champ unique « Repas », lu comme le début). */
  meal?: string;
  mealEnd?: string;
  wrap?: string;
  /** Météo prévue, lever et coucher du soleil (saisis : aucune donnée n'est demandée en ligne). */
  weather?: string;
  sunrise?: string;
  sunset?: string;
  /** Hôpital le plus proche : nom, adresse, téléphone. */
  hospital?: string;
  /** Convocation détaillée par personnage (la convocation simple reste dans `calls`). */
  callDetails?: Record<ID, { pickup?: string; makeup?: string; costume?: string; onSet?: string }>;
  /** Bandeaux sans séquence (installation, trajet, repas, pause), dans l'ordre de la journée. */
  banners?: DayBanner[];
  /** Durée prévue d'une séquence ce jour-là, en minutes (sinon déduite de ses plans). */
  durations?: Record<ID, number>;
}

export type BannerKind = 'installation' | 'trajet' | 'repas' | 'pause';

export interface DayBanner {
  id: ID;
  kind: BannerKind;
  /** Précision libre (« vers le lycée », « cantine »…). */
  label?: string;
  /** Début imposé (« HH:MM ») ; sinon le bandeau s'enchaîne après ce qui le précède. */
  start?: string;
  minutes: number;
  /** Séquence après laquelle il se place ce jour-là ; absent = en tête de journée. */
  after?: ID;
}

export const BANNER_KINDS: ReadonlyArray<{ kind: BannerKind; label: string; minutes: number }> = [
  { kind: 'installation', label: 'Installation', minutes: 60 },
  { kind: 'trajet', label: 'Trajet', minutes: 30 },
  { kind: 'repas', label: 'Repas', minutes: 60 },
  { kind: 'pause', label: 'Pause', minutes: 15 },
];

export const bannerLabel = (b: Pick<DayBanner, 'kind'>) => BANNER_KINDS.find((k) => k.kind === b.kind)?.label ?? b.kind;

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

/**
 * Jour déclaré n (sans les jours déduits des plans). Jours en double (même numéro) : le dernier
 * l'emporte, comme dans `scheduleDays`.
 */
export function declaredDay(doc: ProjectDoc, n: number): ShootingDay | undefined {
  const days = doc.schedule?.days ?? [];
  for (let i = days.length - 1; i >= 0; i--) if (days[i].n === n) return days[i];
  return undefined;
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
  const partsByShot = new Map<ID, number[]>();
  for (const d of doc.schedule?.days ?? []) for (const id of Object.keys(d.parts ?? {})) if (d.parts![id].length) partsByShot.set(id, [...(partsByShot.get(id) ?? []), d.n]);
  for (const seqId of seqs) {
    const byDay = new Map<number, ID[]>();
    for (const shotId of doc.sequences[seqId]?.shotIds ?? []) {
      const shot = doc.shots[shotId];
      if (!shot || shot.status === 'abandonné') continue;
      // Le jour du plan fait foi ; dans un emploi du temps entamé, un plan non placé reste du jour (« à placer »).
      const day = shot.shootingDay ?? 0;
      byDay.set(day, [...(byDay.get(day) ?? []), shotId]);
      // Plan fractionné : il figure aussi les jours où il a une reprise.
      for (const pd of partsByShot.get(shotId) ?? []) if (pd !== day) byDay.set(pd, [...(byDay.get(pd) ?? []), shotId]);
    }
    for (const [day, shotIds] of byDay) out.set(day, [...(out.get(day) ?? []), { seqId, shotIds }]);
  }
  return out;
}

/** Jours d'avant l'identifiant stable : ils en reçoivent un (au chargement). */
export function ensureDayIds(doc: ProjectDoc): void {
  for (const d of doc.schedule?.days ?? []) d.id ??= newId();
}

export function ensureSchedule(doc: ProjectDoc): Schedule & { order?: ID[] } {
  doc.schedule ??= { days: [] };
  return doc.schedule;
}

export function addDay(doc: ProjectDoc): number {
  const sch = ensureSchedule(doc);
  const all = scheduleDays(doc);
  const n = Math.max(0, ...all.map((d) => d.n)) + 1;
  // Dernier jour daté : le nouveau jour prend le lendemain (sans saut de week-end implicite).
  const date = nextDate(all.at(-1)?.date);
  sch.days.push({ n, id: newId(), ...(date ? { date } : {}) });
  return n;
}

/** Lendemain d'une date « AAAA-MM-JJ » (calcul en UTC à midi : pas de décalage d'heure d'été) ; vide si invalide. */
export function nextDate(date?: string): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const t = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return undefined;
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export function updateDay(doc: ProjectDoc, n: number, patch: Partial<ShootingDay>): void {
  const sch = ensureSchedule(doc);
  const d = sch.days.find((x) => x.n === n);
  if (d) Object.assign(d, patch);
  else sch.days.push({ n, id: newId(), ...patch });
}

/**
 * Le jour porte-t-il des données (date, RDV, feuille de service, bandeaux, emploi du temps, plans
 * affectés, dans cette version ou une autre) ? Un jour vide se supprime sans confirmation.
 */
export function dayHasData(doc: ProjectDoc, n: number): boolean {
  const d = doc.schedule?.days.find((x) => x.n === n);
  // Enregistrements vides (convocation effacée, détail sans heure) : rien à perdre.
  const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && (typeof v !== 'object' || Object.values(v).some(filled));
  // Date posée d'office par « Ajouter un jour » (lendemain du jour précédent) : pas de confirmation ;
  // une date saisie à la main compte.
  const prev = scheduleDays(doc).filter((x) => x.n < n).at(-1);
  const autoDate = !!d?.date && !!prev && d.date === nextDate(prev.date);
  if (d && Object.entries(d).some(([k, v]) => k !== 'n' && k !== 'id' && !(k === 'date' && autoDate) && filled(v))) return true;
  return [doc.shots, ...(doc.versions ?? []).map((v) => v.slice?.shots ?? {})].some((m) => Object.values(m).some((s) => s.shootingDay === n));
}

export type CallDetailKey = 'pickup' | 'makeup' | 'costume' | 'onSet';

/** Convocation d'un personnage ce jour-là ; une heure effacée retire la clé (pas d'enregistrement vide). */
export function setCall(doc: ProjectDoc, day: number, charId: ID, time: string | undefined): void {
  const d = dayOf(doc, day);
  const next = { ...(d.calls ?? {}) };
  if (time) next[charId] = time;
  else delete next[charId];
  if (Object.keys(next).length) d.calls = next;
  else delete d.calls;
}

/** Convocation détaillée (départ, HMC, costume, plateau) ; les heures effacées ne laissent ni clé ni objet vide. */
export function setCallDetail(doc: ProjectDoc, day: number, charId: ID, key: CallDetailKey, time: string | undefined): void {
  const d = dayOf(doc, day);
  const all = { ...(d.callDetails ?? {}) };
  const one = { ...(all[charId] ?? {}), [key]: time || undefined };
  for (const k of Object.keys(one) as CallDetailKey[]) if (!one[k]) delete one[k];
  if (Object.keys(one).length) all[charId] = one;
  else delete all[charId];
  if (Object.keys(all).length) d.callDetails = all;
  else delete d.callDetails;
}

/** Supprime un jour : ses plans redeviennent non planifiés, les jours suivants sont renumérotés (« jour n sur N » sans trou). */
export function removeDay(doc: ProjectDoc, n: number): void {
  const sch = ensureSchedule(doc);
  sch.days = sch.days.filter((d) => d.n !== n);
  // Le jour vit sur le plan : les versions rangées (mêmes plans, figés) suivent la même renumérotation.
  const shots = [doc.shots, ...(doc.versions ?? []).map((v) => v.slice?.shots ?? {})].flatMap((m) => Object.values(m));
  for (const s of shots) if (s.shootingDay === n) s.shootingDay = undefined;
  const all = new Set([...sch.days.map((d) => d.n), ...shots.map((s) => s.shootingDay).filter((x): x is number => x !== undefined)]);
  const rank = new Map([...all].sort((a, b) => a - b).map((x, i) => [x, i + 1]));
  for (const d of sch.days) d.n = rank.get(d.n) ?? d.n;
  for (const s of shots) if (s.shootingDay !== undefined) s.shootingDay = rank.get(s.shootingDay) ?? s.shootingDay;
}

export function assignShots(doc: ProjectDoc, shotIds: readonly ID[], day: number | undefined): void {
  const target = day && day > 0 ? day : undefined;
  for (const id of shotIds) {
    if (!doc.shots[id]) continue;
    doc.shots[id].shootingDay = target;
    clearShotSlots(doc, id, target);
  }
  if (!target) return;
  updateDay(doc, target, {});
  // Jour dont l'emploi du temps est entamé : les plans arrivés s'y enchaînent après le dernier créneau.
  const d = ensureSchedule(doc).days.find((x) => x.n === target)!;
  const tl = d.timeline ?? {};
  const placed = Object.keys(tl).filter((id) => doc.shots[id]?.shootingDay === target);
  if (!placed.length) return;
  const last = Math.max(...placed.map((id) => toMin(tl[id].end)));
  placeSequence(doc, target, shotIds.filter((id) => doc.shots[id] && !tl[id]), fromMin(last));
}

/**
 * Plans d'une bande dont c'est le jour principal : glisser la bande ne déplace pas un plan qui n'y
 * figure que par une reprise (son jour, son créneau et ses autres reprises restent).
 */
export function stripOwnShots(doc: ProjectDoc, day: number, strip: Strip): ID[] {
  return strip.shotIds.filter((id) => (doc.shots[id]?.shootingDay ?? 0) === day);
}

/** Plans non abandonnés d'une séquence. */
export function liveShotCount(doc: ProjectDoc, seqId: ID): number {
  return liveShots(doc, seqId).length;
}

/** Avancement du plan de travail : plans (non abandonnés) affectés à un jour, sur l'ensemble. */
export function scheduleProgress(doc: ProjectDoc): { planned: number; total: number } {
  let planned = 0;
  let total = 0;
  for (const seqId of doc.project.sequenceIds)
    for (const id of liveShots(doc, seqId)) {
      total++;
      if (doc.shots[id].shootingDay !== undefined) planned++;
    }
  return { planned, total };
}

/** Retire les créneaux (et reprises) d'un plan sur les jours autres que `keep`. */
export function clearShotSlots(doc: ProjectDoc, shotId: ID, keep?: number): void {
  for (const d of doc.schedule?.days ?? []) {
    if (d.n === keep) continue;
    if (d.timeline?.[shotId]) delete d.timeline[shotId];
    if (d.parts?.[shotId]) delete d.parts[shotId];
  }
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
  // Plans déjà tournés (ou abandonnés) : ils gardent leur jour, la suggestion ne porte que sur le reste.
  const movable = (id: ID) => doc.shots[id] && doc.shots[id].status === 'à tourner';
  const seqs = doc.project.sequenceIds.filter((id) => doc.sequences[id]?.shotIds.some(movable));
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
    const shots = (doc.sequences[seqId]?.shotIds ?? []).filter(movable);
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
  for (let n = 1; n <= day; n++) if (!sch.days.some((d) => d.n === n)) sch.days.push({ n, id: newId() });
  sch.days.sort((a, b) => a.n - b.n);
  // Créneaux qui ne correspondent plus au jour du plan : retirés (l'emploi du temps est à refaire),
  // sauf ceux qu'une version rangée tient encore ce jour-là (l'emploi du temps est commun aux versions).
  const stored = (doc.versions ?? []).map((v) => v.slice?.shots ?? {});
  const heldElsewhere = (id: ID, n: number) => stored.some((m) => m[id]?.shootingDay === n);
  for (const d of sch.days) {
    for (const id of Object.keys(d.timeline ?? {})) if (doc.shots[id]?.shootingDay !== d.n && !heldElsewhere(id, d.n)) delete d.timeline![id];
    for (const id of Object.keys(d.parts ?? {})) if (!doc.shots[id] && !keptElsewhere(doc, 'shots', id)) delete d.parts![id];
  }
  return day;
}

// --- En-têtes de journée et codage des bandes -------------------------------------------------

const longDateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Date longue (« lundi 16 novembre 2026 »), vide si la date est inconnue ou invalide. */
export function longDate(date?: string): string {
  if (!date) return '';
  const t = new Date(`${date}T12:00`);
  return Number.isNaN(t.getTime()) ? '' : longDateFmt.format(t);
}

/** En-tête d'une journée : « Jour 2 sur 5 · lundi 16 novembre 2026 · RDV 07:00 ». */
export function dayTitle(day: ShootingDay, total: number): string {
  return [`Jour ${day.n}${total ? ` sur ${total}` : ''}`, longDate(day.date), day.callTime && `RDV ${day.callTime}`].filter(Boolean).join(' · ');
}

/** « 1 plan », « 2 plans » (0 et 1 au singulier). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Totaux d'une journée : séquences, plans, durée d'écran, décors, comédiens (figurants à part). */
export function dayTotalsText(doc: ProjectDoc, st: DayStats): string {
  const cast = st.characterIds.filter((id) => doc.characters[id] && doc.characters[id].kind !== 'figurant').length;
  return [`${st.sequenceIds.length} séq.`, plural(st.shots, 'plan'), `${formatTc(st.screenSec)} d’écran`, plural(st.decorIds.length, 'décor'), plural(cast, 'comédien')].join(' · ');
}

/**
 * Codage des bandes (charte noir et blanc) : du plus clair au plus soutenu, INT jour, EXT jour,
 * INT nuit, EXT nuit ; aube et crépuscule hachurés. Une séquence INT/EXT se range avec les extérieurs.
 */
export type StripTone = 'int-day' | 'ext-day' | 'int-night' | 'ext-night' | 'int-twilight' | 'ext-twilight';

export function stripTone(seq: { intExt?: string; effect?: string } | undefined): StripTone {
  const ext = seq?.intExt === 'EXT' || seq?.intExt === 'INT/EXT' ? 'ext' : 'int';
  const light = seq?.effect === 'NUIT' ? 'night' : seq?.effect === 'AUBE' || seq?.effect === 'CRÉPUSCULE' ? 'twilight' : 'day';
  return `${ext}-${light}`;
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
  const shotIds = [...new Set(strips.flatMap((s) => s.shotIds))];
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

/** Distribution d'une bande : personnages des plans de ce jour (et ceux ajoutés à la main à la séquence). */
export function stripCharacterIds(doc: ProjectDoc, strip: Strip): ID[] {
  const ids = new Set<ID>(strip.shotIds.flatMap((id) => doc.shots[id]?.characterIds ?? []));
  for (const id of doc.sequences[strip.seqId]?.characterIds ?? []) ids.add(id);
  return [...ids].filter((id) => doc.characters[id]);
}

/** Matériel requis un jour : lignes ajoutées à la main, et celles déduites des plans du jour. */
export function dayEquipment(_doc: ProjectDoc, shotIds: readonly ID[], aggregate: Record<string, Array<{ key: string; label: string; manual?: boolean; shotIds: ID[] }>>, categories: readonly string[]): Array<{ category: string; labels: string[] }> {
  const set = new Set(shotIds);
  return categories.map((c) => ({ category: c, labels: (aggregate[c] ?? []).filter((l) => l.manual || l.shotIds.some((id) => set.has(id))).map((l) => l.label) }));
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
export function stripsByTime(doc: ProjectDoc, day: number, list: readonly Strip[] = stripsByDay(doc).get(day) ?? []): Strip[] {
  // Débuts calculés une fois (pas à chaque comparaison du tri).
  const first = new Map(list.map((s) => [s, stripRange(doc, day, s)?.start ?? '99:99']));
  return [...list].sort((a, b) => first.get(a)!.localeCompare(first.get(b)!));
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
/** Heure « HH:MM » ; au-delà de minuit (tournage de nuit), les heures continuent : « 25:30 » = 1 h 30 le lendemain. */
export const fromMin = (min: number) => {
  const m = Math.max(0, Math.min(48 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Heure affichée : « 01:30 (+1) » pour une heure après minuit. */
export const showTime = (hhmm: string | undefined) => {
  if (!hhmm) return '';
  const m = toMin(hhmm);
  return m >= 24 * 60 ? `${fromMin(m - 24 * 60)} (+1)` : hhmm;
};

/** Fin de journée : une fin avant le début (nuit) se lit le lendemain. */
export const dayEndMin = (start: string, end: string) => {
  const s0 = toMin(start);
  const e0 = toMin(end);
  return e0 <= s0 ? e0 + 24 * 60 : e0;
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

/** Retire le créneau d'un plan dans l'emploi du temps : le plan reste du jour (« à placer »). */
export function clearSlot(doc: ProjectDoc, day: number, shotId: ID): void {
  const d = declaredDay(doc, day);
  if (d?.timeline?.[shotId]) delete d.timeline[shotId];
}

/** Retire un plan du jour (créneau compris) : il redevient non planifié. */
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
  // Jours déclarés seulement : un jour porté par les plans seuls n'a ni créneau ni reprise.
  const d = declaredDay(doc, day);
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
    ? declaredDay(doc, day)?.timeline?.[shotId]
    : undefined;
}

/**
 * Amplitude affichée de l'emploi du temps, en minutes : celle du jour (ou par défaut), étendue à
 * l'heure ronde pour couvrir le rendez-vous, les créneaux et les bandeaux qui en sortent.
 */
export function timelineRange(doc: ProjectDoc, day: number): { start: number; end: number } {
  const d = declaredDay(doc, day);
  const s0 = toMin(d?.dayStart ?? DEFAULT_DAY_START);
  const e0 = Math.max(s0 + 60, dayEndMin(fromMin(s0), d?.dayEnd ?? DEFAULT_DAY_END));
  const entries = timelineOf(doc, day);
  const banners = (d?.banners?.length ? dayAgenda(doc, day) : []).filter((it) => it.type === 'banner' && it.start && it.end);
  const starts = [s0, ...entries.map((e) => e.start), ...banners.map((b) => toMin(b.start!))];
  if (d?.callTime) starts.push(toMin(d.callTime));
  const ends = [e0, ...entries.map((e) => e.end), ...banners.map((b) => toMin(b.end!))];
  const start = Math.floor(Math.min(...starts) / 60) * 60;
  const end = Math.min(48 * 60, Math.ceil(Math.max(...ends) / 60) * 60);
  return { start, end: Math.max(start + 60, end) };
}

/** Début libre pour placer un plan à la suite : fin du dernier créneau du jour, sinon le RDV, sinon le début de journée. */
export function nextFreeStart(doc: ProjectDoc, day: number): string {
  const entries = timelineOf(doc, day);
  if (entries.length) return fromMin(Math.max(...entries.map((e) => e.end)));
  const d = declaredDay(doc, day);
  return d?.callTime ?? d?.dayStart ?? DEFAULT_DAY_START;
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

// --- Bandeaux et horaires en cascade ---------------------------------------------------------

/** Créneau saisi librement (« 10:30–11:00 », « 10h30 - 11h ») ; indéfini s'il ne se lit pas. */
export function parseSlot(text: string | undefined): { start: string; end: string } | undefined {
  const m = /(\d{1,2})\s*[:h]\s*(\d{2})?\s*[–—-]\s*(\d{1,2})\s*[:h]?\s*(\d{2})?/.exec(text ?? '');
  if (!m) return undefined;
  const a = Number(m[1]) * 60 + Number(m[2] ?? 0);
  let b = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (b <= a) b += 24 * 60;
  return { start: fromMin(a), end: fromMin(b) };
}

/** Plans non abandonnés d'une séquence. */
const liveShots = (doc: ProjectDoc, seqId: ID) => (doc.sequences[seqId]?.shotIds ?? []).filter((id) => doc.shots[id] && doc.shots[id].status !== 'abandonné');

/**
 * Durée prévue d'une bande, en minutes : celle saisie pour ce jour, sinon la part du créneau de la
 * séquence (institutionnel), sinon une demi-heure par plan.
 */
export function stripMinutes(doc: ProjectDoc, day: number, strip: Strip): number {
  const set = doc.schedule?.days.find((x) => x.n === day)?.durations?.[strip.seqId];
  return set && set > 0 ? set : estimatedStripMinutes(doc, strip);
}

/** Durée estimée d'une bande, sans tenir compte de la durée saisie pour le jour. */
export function estimatedStripMinutes(doc: ProjectDoc, strip: Strip): number {
  const slot = parseSlot(doc.sequences[strip.seqId]?.slot);
  if (slot) {
    const share = strip.shotIds.length / Math.max(1, liveShots(doc, strip.seqId).length);
    return Math.max(SLOT_MIN, Math.round(((toMin(slot.end) - toMin(slot.start)) * share) / 5) * 5);
  }
  return Math.max(SLOT_MIN, strip.shotIds.length * DEFAULT_SHOT_MIN);
}

export type AgendaItem =
  | { type: 'strip'; strip: Strip; start?: string; end?: string; computed: boolean }
  | { type: 'banner'; banner: DayBanner; start?: string; end?: string; computed: boolean };

/**
 * Déroulé d'une journée : bandes de séquences et bandeaux, dans l'ordre, avec leurs horaires. Un
 * horaire saisi (créneaux de l'emploi du temps, créneau de la séquence, début d'un bandeau) fait foi ;
 * le reste s'enchaîne à partir du rendez-vous, selon les durées prévues (`computed`).
 */
export function dayAgenda(doc: ProjectDoc, day: number): AgendaItem[] {
  const strips = stripsByTime(doc, day);
  const d = doc.schedule?.days.find((x) => x.n === day);
  const banners = d?.banners ?? [];
  const seqIds = new Set(strips.map((x) => x.seqId));
  // Bandeau dont la séquence a quitté la journée : il suit la dernière bande du jour qui la précède
  // dans l'ordre du plan de travail (en tête de journée s'il n'y en a pas, en fin si elle n'existe plus).
  const order = doc.schedule?.order ?? [];
  const rank = (id: ID) => {
    const i = order.indexOf(id);
    if (i >= 0) return i;
    const j = doc.project.sequenceIds.indexOf(id);
    return j >= 0 ? order.length + j : undefined;
  };
  /** Séquence d'accroche de chaque bandeau : `null` = en tête, `undefined` = en fin de journée. */
  const anchor = new Map<ID, ID | null | undefined>();
  for (const b of banners) {
    if (!b.after) anchor.set(b.id, null);
    else if (seqIds.has(b.after)) anchor.set(b.id, b.after);
    else {
      const r = rank(b.after);
      const before = r === undefined ? [] : strips.filter((x) => (rank(x.seqId) ?? Infinity) < r).sort((a, c) => rank(a.seqId)! - rank(c.seqId)!);
      anchor.set(b.id, r === undefined ? undefined : (before.at(-1)?.seqId ?? null));
    }
  }
  const items: AgendaItem[] = banners.filter((b) => anchor.get(b.id) === null).map((banner) => ({ type: 'banner', banner, computed: false }));
  for (const strip of strips) {
    items.push({ type: 'strip', strip, computed: false });
    for (const banner of banners) if (anchor.get(banner.id) === strip.seqId) items.push({ type: 'banner', banner, computed: false });
  }
  for (const banner of banners) if (anchor.get(banner.id) === undefined) items.push({ type: 'banner', banner, computed: false });
  const slotted = slottedOn(doc, day);

  let cursor = d?.callTime ? toMin(d.callTime) : undefined;
  for (const it of items) {
    let start: number | undefined;
    let end: number | undefined;
    if (it.type === 'strip') {
      const seqSlot = parseSlot(doc.sequences[it.strip.seqId]?.slot);
      const whole = it.strip.shotIds.length >= liveShots(doc, it.strip.seqId).length;
      const range = stripRange(doc, day, it.strip);
      const fixed = range ?? (seqSlot && whole ? seqSlot : undefined);
      if (fixed) [start, end] = [toMin(fixed.start), toMin(fixed.end)];
      else if (cursor !== undefined) [start, end] = [cursor, cursor + stripMinutes(doc, day, it.strip)];
      // Bande en partie placée : la durée prévue saisie fait foi, sinon le reste s'enchaîne après le dernier créneau.
      const rest = range ? it.strip.shotIds.filter((id) => !slotted(id)) : [];
      if (rest.length && start !== undefined && end !== undefined) {
        const planned = d?.durations?.[it.strip.seqId];
        end = planned && planned > 0 ? Math.max(end, start + planned) : end + estimatedStripMinutes(doc, { seqId: it.strip.seqId, shotIds: rest });
      }
      it.computed = !fixed && start !== undefined;
    } else {
      start = it.banner.start ? toMin(it.banner.start) : cursor;
      if (start !== undefined) end = start + Math.max(0, it.banner.minutes);
      it.computed = !it.banner.start && start !== undefined;
    }
    if (start === undefined || end === undefined) continue;
    it.start = fromMin(start);
    it.end = fromMin(end);
    cursor = Math.max(cursor ?? end, end);
  }
  return items;
}

/** Fin prévue de la journée d'après son déroulé (indéfinie sans horaire). */
export function agendaEnd(items: readonly AgendaItem[]): string | undefined {
  const ends = items.map((i) => i.end).filter((x): x is string => !!x);
  return ends.length ? fromMin(Math.max(...ends.map(toMin))) : undefined;
}

export const DEFAULT_MEAL_MIN = 60;
/** Heure d'horloge (« 25:30 » → « 01:30 ») : ce qu'affiche un champ horaire. */
const clock = (min: number) => fromMin(((Math.round(min) % 1440) + 1440) % 1440);
/** Heure d'horloge d'un horaire du déroulé (« 27:00 » → « 03:00 ») : valeur d'un champ horaire. */
export const clockTime = (hhmm: string | undefined) => (hhmm ? clock(toMin(hhmm)) : '');

/**
 * Heure saisie (horloge) ramenée dans la journée de tournage : avant le rendez-vous, elle se lit le
 * lendemain (« 03:00 » un jour à RDV 20:00 → « 27:00 »). Les calculs gardent ces minutes non bouclées.
 */
export function afterCall(doc: ProjectDoc, day: number, hhmm: string): string {
  const call = doc.schedule?.days.find((x) => x.n === day)?.callTime;
  const m = toMin(hhmm) % 1440;
  return fromMin(call && m < toMin(call) ? m + 1440 : m);
}

/** Horaires clés d'une journée : repas, reprise du tournage, fin prévue (minutes non bouclées). */
export interface DayKeyTimes {
  /** Repas, de … à … ; `computed` : heure déduite (du bandeau « Repas » ou de la durée), non saisie. */
  meal?: { start: string; end: string; computed: { start: boolean; end: boolean } };
  /** Reprise après le repas, de … (première bande qui suit, sinon la fin du repas) à … (fin prévue). */
  restart?: { start: string; end?: string };
  wrap?: string;
  wrapComputed: boolean;
}

const mealItem = (agenda: readonly AgendaItem[]) =>
  agenda.find((x): x is Extract<AgendaItem, { type: 'banner' }> => x.type === 'banner' && x.banner.kind === 'repas');

/**
 * Repas, reprise et fin prévue, d'après le déroulé commun au plan de travail et à la feuille de
 * service. Une heure saisie sur la feuille fait foi ; sinon le repas suit le bandeau « Repas » du
 * déroulé (sa durée, ou une heure par défaut) et la fin prévue, la fin du déroulé.
 */
export function dayKeyTimes(doc: ProjectDoc, day: number): DayKeyTimes {
  const agenda = dayAgenda(doc, day);
  const d = doc.schedule?.days.find((x) => x.n === day);
  const item = mealItem(agenda);
  const minutes = item?.banner.minutes ?? DEFAULT_MEAL_MIN;
  const late = (hhmm: string) => toMin(afterCall(doc, day, hhmm));
  let meal: DayKeyTimes['meal'];
  if (d?.meal || d?.mealEnd) {
    let start = d.meal ? late(d.meal) : late(d.mealEnd!) - minutes;
    let end = d.mealEnd ? late(d.mealEnd) : start + minutes;
    if (end <= start) end += 1440;
    if (start < 0) [start, end] = [start + 1440, end + 1440];
    meal = { start: fromMin(start), end: fromMin(end), computed: { start: !d.meal, end: !d.mealEnd } };
  } else if (item?.start && item.end) {
    meal = { start: item.start, end: item.end, computed: { start: item.computed, end: item.computed } };
  }
  let wrap = d?.wrap ?? agendaEnd(agenda) ?? d?.dayEnd;
  if (d?.wrap) wrap = afterCall(doc, day, d.wrap);
  const out: DayKeyTimes = { meal, wrap, wrapComputed: !d?.wrap };
  if (!meal) return out;
  // Repas du déroulé : la reprise est la première bande qui le suit. Repas saisi sur le jour : sa fin.
  const fromAgenda = !(d?.meal || d?.mealEnd) && item;
  const next = fromAgenda ? agenda.slice(agenda.indexOf(item) + 1).find((x) => x.type === 'strip' && x.start)?.start : undefined;
  const start = toMin(next ?? meal.end);
  // Fin prévue après la reprise (une fin saisie plus tôt se lit le lendemain : tournage de nuit) ;
  // comparée en minutes non bouclées, jamais égale au début de la reprise.
  let wrapMin = wrap ? toMin(wrap) : undefined;
  if (wrapMin !== undefined && d?.wrap && wrapMin <= start) wrapMin += 1440;
  const end = wrapMin !== undefined && wrapMin > start && (wrapMin - start) % 1440 !== 0 ? fromMin(wrapMin) : undefined;
  if (d?.wrap && wrapMin !== undefined) out.wrap = fromMin(wrapMin);
  if (next !== undefined || end) out.restart = { start: fromMin(start), end };
  return out;
}

/**
 * Repas saisi sur la feuille de service (heures d'horloge). Avec un bandeau « Repas » au déroulé,
 * c'est lui qui change (début imposé, durée) : le plan de travail et la feuille restent d'accord, la
 * suite de la journée s'enchaîne. Sinon l'horaire est gardé sur le jour. Changer le début garde la durée.
 */
export function setDayMeal(doc: ProjectDoc, day: number, patch: { start?: string; end?: string }): void {
  const d = dayOf(doc, day);
  const cur = dayKeyTimes(doc, day).meal;
  const item = mealItem(dayAgenda(doc, day));
  const b = item && d.banners?.find((x) => x.id === item.banner.id);
  if (b) {
    // Heures saisies auparavant sur le jour : reportées sur le bandeau, qui devient la seule référence.
    if (!('start' in patch) && d.meal) patch = { ...patch, start: d.meal };
    if (!('end' in patch) && d.mealEnd) patch = { ...patch, end: d.mealEnd };
    delete d.meal;
    delete d.mealEnd;
    if ('start' in patch) {
      if (patch.start) b.start = afterCall(doc, day, patch.start);
      else delete b.start;
    }
    if (!('end' in patch)) return;
    if (!patch.end) {
      b.minutes = DEFAULT_MEAL_MIN;
      return;
    }
    const start = mealItem(dayAgenda(doc, day))?.start;
    const end = toMin(afterCall(doc, day, patch.end));
    // Fin avant un début déduit : le repas avance, à durée égale ; après un début imposé, la durée suit.
    if (start && (b.start || end > toMin(start))) b.minutes = (((end - toMin(start)) % 1440) + 1440) % 1440;
    else b.start = fromMin(Math.max(0, end - b.minutes));
    return;
  }
  if ('start' in patch) {
    if (!patch.start) {
      delete d.meal;
      delete d.mealEnd;
      return;
    }
    if (d.mealEnd && cur) d.mealEnd = clock(toMin(patch.start) + toMin(cur.end) - toMin(cur.start));
    d.meal = patch.start;
  }
  if ('end' in patch) {
    if (patch.end) d.mealEnd = patch.end;
    else delete d.mealEnd;
  }
}

/**
 * Ajoute un bandeau au déroulé du jour, en fin de journée ; un repas se place vers midi : après la
 * bande dont la fin est la plus proche de 12:00, ou, sans horaire, après la bande du milieu.
 */
export function addBanner(doc: ProjectDoc, day: number, kind: BannerKind): ID {
  const d = dayOf(doc, day);
  const strips = dayAgenda(doc, day).filter((i): i is Extract<AgendaItem, { type: 'strip' }> => i.type === 'strip');
  let host = strips.at(-1);
  if (kind === 'repas' && strips.length) {
    const gap = (i: (typeof strips)[number]) => Math.abs(toMin(i.end!) - 12 * 60);
    const timed = strips.filter((i) => i.end);
    host = timed.length ? timed.reduce((a, b) => (gap(b) < gap(a) ? b : a)) : strips[Math.ceil(strips.length / 2) - 1];
  }
  const id = newId();
  const minutes = BANNER_KINDS.find((k) => k.kind === kind)?.minutes ?? 30;
  (d.banners ??= []).push({ id, kind, minutes, ...(host ? { after: host.strip.seqId } : {}) });
  return id;
}

export function updateBanner(doc: ProjectDoc, day: number, id: ID, patch: Partial<Omit<DayBanner, 'id'>>): void {
  const b = doc.schedule?.days.find((x) => x.n === day)?.banners?.find((x) => x.id === id);
  if (!b) return;
  // Début saisi à l'horloge : ramené après le rendez-vous (tournage de nuit).
  if (patch.start) patch = { ...patch, start: afterCall(doc, day, patch.start) };
  Object.assign(b, patch);
  for (const k of ['label', 'start', 'after'] as const) if (!b[k]) delete b[k];
}

export function removeBanner(doc: ProjectDoc, day: number, id: ID): void {
  const d = doc.schedule?.days.find((x) => x.n === day);
  if (d?.banners) d.banners = d.banners.filter((b) => b.id !== id);
}

/** Avance (−1) ou recule (+1) un bandeau d'un cran dans le déroulé de la journée. */
export function moveBanner(doc: ProjectDoc, day: number, id: ID, dir: -1 | 1): void {
  const d = doc.schedule?.days.find((x) => x.n === day);
  if (!d?.banners) return;
  const items = dayAgenda(doc, day);
  const i = items.findIndex((x) => x.type === 'banner' && x.banner.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  // Chaque bandeau se rattache à la séquence qui le précède désormais ; l'ordre des bandeaux suit.
  let after: ID | undefined;
  const order: ID[] = [];
  for (const it of items) {
    if (it.type === 'strip') after = it.strip.seqId;
    else {
      const b = d.banners.find((x) => x.id === it.banner.id)!;
      if (after) b.after = after;
      else delete b.after;
      order.push(b.id);
    }
  }
  d.banners.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Durée prévue d'une séquence ce jour-là (vide = estimation par les plans). */
export function setStripMinutes(doc: ProjectDoc, day: number, seqId: ID, minutes: number | undefined): void {
  const d = dayOf(doc, day);
  const next = { ...(d.durations ?? {}) };
  if (minutes && minutes > 0) next[seqId] = Math.round(minutes);
  else delete next[seqId];
  d.durations = Object.keys(next).length ? next : undefined;
}

export interface ItineraryStop {
  decorId?: ID;
  address: string;
  start?: string;
  end?: string;
  /** Horaire déduit du déroulé (rendez-vous et durées), pas saisi dans l'emploi du temps. */
  computed?: boolean;
  seqIds: ID[];
}

/** Déroulé de la journée : une étape par séquence, dans l’ordre horaire, avec sa plage et son adresse
 *  (adresse du jour pour la séquence, sinon du décor ce jour-là, sinon celle du Registre). */
export function dayItinerary(doc: ProjectDoc, day: number): ItineraryStop[] {
  const d = doc.schedule?.days.find((x) => x.n === day);
  return callSheetAgenda(doc, day).flatMap((it) => {
    if (it.type !== 'strip') return [];
    const strip = it.strip;
    const decorId = doc.sequences[strip.seqId]?.decorId;
    const address =
      d?.seqAddresses?.[strip.seqId] ??
      (decorId ? (d?.addresses?.[decorId] ?? decorLocation(doc.decors[decorId]).address) : undefined) ??
      '';
    return [{ decorId, address, start: it.start, end: it.end, ...(it.computed ? { computed: true } : {}), seqIds: [strip.seqId] }];
  });
}

/**
 * Plans retenus pour la feuille de service (ceux du jour, dans l’ordre horaire). Une fois l'emploi
 * du temps du jour entamé, seuls les plans qui y ont un créneau (ou une reprise) comptent.
 */
export function callSheetStrips(doc: ProjectDoc, day: number): Strip[] {
  const strips = stripsByTime(doc, day);
  const slotted = slottedOn(doc, day);
  const started = strips.some((st) => st.shotIds.some(slotted));
  if (!started) return strips;
  return strips.map((st) => ({ ...st, shotIds: st.shotIds.filter(slotted) })).filter((st) => st.shotIds.length);
}

/** Plan qui a un créneau (ou une reprise) dans l'emploi du temps de ce jour. */
function slottedOn(doc: ProjectDoc, day: number): (id: ID) => boolean {
  const d = doc.schedule?.days.find((x) => x.n === day);
  return (id) => (!!d?.timeline?.[id] && doc.shots[id]?.shootingDay === day) || !!d?.parts?.[id]?.length;
}

/**
 * Déroulé de la feuille de service : celui du plan de travail (mêmes horaires, repas compris), dont
 * les bandes ne gardent que les plans retenus pour la feuille (`callSheetStrips`).
 */
export function callSheetAgenda(doc: ProjectDoc, day: number): AgendaItem[] {
  const keep = new Map(callSheetStrips(doc, day).map((st) => [st.seqId, st]));
  return dayAgenda(doc, day).flatMap((it): AgendaItem[] => {
    if (it.type === 'banner') return [it];
    const st = keep.get(it.strip.seqId);
    return st ? [{ ...it, strip: st }] : [];
  });
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
  const parts = declaredDay(doc, day)?.parts?.[shotId] ?? [];
  return [...(main ? [main] : []), ...parts].map((s) => `${showTime(s.start)} – ${showTime(s.end)}`).join(', ');
}

/** Premier créneau d'un plan ce jour-là (principal, sinon première reprise). */
export function firstSlot(doc: ProjectDoc, day: number, shotId: ID): { start: string; end: string } | undefined {
  return shotSlot(doc, day, shotId) ?? declaredDay(doc, day)?.parts?.[shotId]?.[0];
}
