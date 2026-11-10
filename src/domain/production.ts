import { addDays, isValidDate, todayIso } from './calendar';
import { newId } from './factory';
import { scheduleDays } from './schedule';
import type { ID, ProjectDoc } from './types';

/**
 * Calendrier de production : les grandes étapes du film (développement, préparation, tournage,
 * postproduction, diffusion) en diagramme de Gantt. Des phases (groupes) contiennent des étapes
 * (barres) et des jalons (durée nulle). Dates locales « AAAA-MM-JJ », dernier jour inclus.
 *
 * Dépendances fin → début : un élément ne commence qu'après la fin de ceux dont il dépend. Pour les
 * comparer, chacun se lit sur une frise de bornes : une étape occupe [début, fin + 1[ ; un jalon
 * daté J tombe à la fin de sa journée, borne J + 1.
 */

export interface ProductionTask {
  id: ID;
  name: string;
  /** Premier jour ; jalon : sa date. */
  start: string;
  /** Dernier jour (inclus) ; jalon : égal au début. */
  end: string;
  milestone?: boolean;
  done?: boolean;
  /** Éléments qui doivent être finis avant que celui-ci commence (fin → début). */
  after?: ID[];
  /** Suit le premier et le dernier jour de tournage datés du plan de travail. */
  linked?: 'schedule';
  /**
   * Étape liée : durée prévue en jours, gardée tant que le plan de travail n'est pas tout daté. Elle
   * ne suit pas les dates du plan de travail, si bien qu'une date erronée puis corrigée ne laisse rien.
   */
  planned?: number;
}

export interface ProductionPhase {
  id: ID;
  name: string;
  tasks: ProductionTask[];
  /** Dates propres d'une phase encore sans étape (réglées sur sa ligne) ; ensuite, ses étapes font foi. */
  start?: string;
  end?: string;
}

export interface Production {
  phases: ProductionPhase[];
}

// --- Dates --------------------------------------------------------------------------------------

const DAY = 86_400_000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Nombre de jours de `a` à `b` (positif si `b` est après `a`). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/** Durée en jours, bornes comprises ; zéro pour un jalon. */
export const durationDays = (t: Pick<ProductionTask, 'start' | 'end' | 'milestone'>) => (t.milestone ? 0 : daysBetween(t.start, t.end) + 1);

const startBound = (t: ProductionTask) => (t.milestone ? addDays(t.start, 1) : t.start);
const finishBound = (t: ProductionTask) => addDays(t.end, 1);
const maxDate = (a: string, b: string) => (a > b ? a : b);

/** « 12/03/2027 » ; vide si la date est invalide. */
export function formatFrDate(date: string | undefined): string {
  return isValidDate(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';
}

/**
 * Date saisie au clavier : « jj/mm/aaaa », aussi avec points, tirets ou espaces, l'année sur deux
 * chiffres (« 27 » = 2027) ou omise (année de `ref`). `undefined` si la date n'existe pas.
 */
export function parseFrDate(text: string, ref = todayIso()): string | undefined {
  const m = /^\s*(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})(?:\s*[/.\-\s]\s*(\d{2}|\d{4}))?\s*$/.exec(text);
  if (!m) return undefined;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(ref.slice(0, 4));
  const iso = `${String(year).padStart(4, '0')}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // 31/02 n'existe pas : le calcul en UTC le ferait glisser au 3 mars.
  const d = new Date(utc(iso));
  return isValidDate(iso) && d.getUTCDate() === Number(m[1]) && d.getUTCMonth() + 1 === Number(m[2]) ? iso : undefined;
}

// --- Lecture ------------------------------------------------------------------------------------

export interface TaskRef {
  phase: ProductionPhase;
  task: ProductionTask;
}

export const allTasks = (plan: Production | undefined): TaskRef[] => (plan?.phases ?? []).flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));

export function findTask(plan: Production | undefined, id: ID): TaskRef | undefined {
  for (const phase of plan?.phases ?? []) {
    const task = phase.tasks.find((t) => t.id === id);
    if (task) return { phase, task };
  }
  return undefined;
}

export interface Span {
  start: string;
  end: string;
}

/** Étendue d'une phase : du premier début à la dernière fin de ses éléments. */
export function phaseSpan(phase: ProductionPhase): Span | undefined {
  if (!phase.tasks.length) return phase.start && phase.end ? { start: phase.start, end: phase.end } : undefined;
  let start = phase.tasks[0].start;
  let end = phase.tasks[0].end;
  for (const t of phase.tasks) {
    if (t.start < start) start = t.start;
    if (t.end > end) end = t.end;
  }
  return { start, end };
}

/** Durée d'une phase en jours (de son premier à son dernier jour) ; zéro si elle n'a que des jalons. */
export function phaseDays(phase: ProductionPhase): number | undefined {
  const sp = phaseSpan(phase);
  if (!sp) return undefined;
  return phase.tasks.length && phase.tasks.every((t) => t.milestone) ? 0 : daysBetween(sp.start, sp.end) + 1;
}

/** Étendue de tout le calendrier. */
export function planSpan(plan: Production | undefined): Span | undefined {
  const spans = (plan?.phases ?? []).map(phaseSpan).filter((x): x is Span => !!x);
  if (!spans.length) return undefined;
  return { start: spans.reduce((a, s) => (s.start < a ? s.start : a), spans[0].start), end: spans.reduce((a, s) => (s.end > a ? s.end : a), spans[0].end) };
}

/** Éléments qui dépendent directement de `id`. */
export const successors = (plan: Production, id: ID) => allTasks(plan).filter((r) => r.task.after?.includes(id));

/** Première borne possible d'un élément d'après ses prédécesseurs, ou `undefined`. */
function earliestBound(plan: Production, t: ProductionTask): string | undefined {
  let need: string | undefined;
  for (const id of t.after ?? []) {
    const p = findTask(plan, id)?.task;
    if (p) need = need ? maxDate(need, finishBound(p)) : finishBound(p);
  }
  return need;
}

/** Dépendance non respectée (seule une étape tenue par le plan de travail peut l'enfreindre). */
export const isLate = (succ: ProductionTask, pred: ProductionTask) => startBound(succ) < finishBound(pred);

/** `id` dépend-il, même indirectement, de `of` ? */
export function dependsOn(plan: Production, id: ID, of: ID): boolean {
  const seen = new Set<ID>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const p of findTask(plan, cur)?.task.after ?? []) {
      if (p === of) return true;
      if (!seen.has(p)) {
        seen.add(p);
        stack.push(p);
      }
    }
  }
  return false;
}

/** Prédécesseurs possibles d'un élément : tous, sauf lui-même et ceux qui en dépendent déjà. */
export function dependencyCandidates(plan: Production, id: ID): TaskRef[] {
  return allTasks(plan).filter((r) => r.task.id !== id && !dependsOn(plan, r.task.id, id));
}

// --- Dates et cascade ---------------------------------------------------------------------------

function shift(t: ProductionTask, days: number): void {
  if (!days) return;
  t.start = addDays(t.start, days);
  t.end = addDays(t.end, days);
}

/** Jours de tournage du plan de travail : premier et dernier datés, nombre de jours datés et en tout. */
export interface ShootingRange extends Span {
  dated: number;
  total: number;
}

/** Premier et dernier jour de tournage datés du plan de travail. */
export function shootingRange(doc: ProjectDoc): ShootingRange | undefined {
  const days = scheduleDays(doc);
  const dates = days
    .map((d) => d.date)
    .filter((d): d is string => isValidDate(d))
    .map((d) => d.slice(0, 10))
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1], dated: dates.length, total: days.length } : undefined;
}

/**
 * Dates de l'étape liée. Tous les jours datés : du premier au dernier. Sinon le début suit le premier
 * jour daté, et la fin couvre les jours datés, le nombre de jours du plan de travail et la durée
 * prévue (`days`), la plus tardive des trois.
 */
export function linkedSpan(range: ShootingRange, days: number): Span {
  if (range.dated >= range.total) return { start: range.start, end: range.end };
  const end = [range.end, addDays(range.start, range.total - 1), addDays(range.start, Math.max(1, days) - 1)].reduce(maxDate);
  return { start: range.start, end };
}

/** Étape dont les dates sont tenues par le plan de travail (liée, et tous ses jours y sont datés). */
export function isPinned(doc: ProjectDoc, t: ProductionTask): boolean {
  const r = t.linked && shootingRange(doc);
  return !!r && r.dated >= r.total;
}

/** Étape liée dont le début est tenu par le plan de travail (au moins un jour daté) ; la fin reste libre tant que tout n'est pas daté. */
export const isHeld = (doc: ProjectDoc, t: ProductionTask) => !!t.linked && !!shootingRange(doc);

/**
 * Pousse les successeurs de `ids` qui commenceraient avant la fin de leurs prédécesseurs, et ainsi de
 * suite. Un élément n'est jamais avancé ; une étape tenue par le plan de travail ne bouge pas.
 */
export function cascade(doc: ProjectDoc, ids: readonly ID[]): void {
  const plan = doc.production;
  if (!plan) return;
  const pinned = shootingRange(doc) ? new Set(allTasks(plan).filter((r) => r.task.linked).map((r) => r.task.id)) : new Set<ID>();
  const queue = [...ids];
  let guard = 0;
  while (queue.length && guard++ < 10_000) {
    const id = queue.shift()!;
    for (const { task } of successors(plan, id)) {
      if (pinned.has(task.id)) continue;
      const need = earliestBound(plan, task);
      if (need && startBound(task) < need) {
        shift(task, daysBetween(startBound(task), need));
        queue.push(task.id);
      }
    }
  }
}

/**
 * Nouvelles dates d'un élément : fin ramenée au début s'il le faut (jalon : même jour), jamais avant
 * la fin de ses prédécesseurs (la durée est gardée), puis successeurs décalés en cascade.
 */
export function setTaskDates(doc: ProjectDoc, id: ID, start: string, end: string): void {
  const plan = doc.production;
  const t = findTask(plan, id)?.task;
  if (!plan || !t || isPinned(doc, t) || !isValidDate(start) || !isValidDate(end)) return;
  const range = isHeld(doc, t) ? shootingRange(doc) : undefined;
  if (range) {
    // Étape liée, plan de travail daté en partie : seule la fin se règle (durée prévue), sans couvrir moins que lui.
    t.planned = Math.max(1, daysBetween(range.start, end) + 1);
    t.end = linkedSpan(range, t.planned).end;
    t.start = range.start;
  } else {
    t.start = start;
    t.end = t.milestone || end < start ? start : end;
    const need = earliestBound(plan, t);
    if (need && startBound(t) < need) shift(t, daysBetween(startBound(t), need));
    if (t.linked) t.planned = durationDays(t);
  }
  cascade(doc, [id]);
}

/** Déplace un élément de `days` jours (glisser une barre). */
export function moveTask(doc: ProjectDoc, id: ID, days: number): void {
  const t = findTask(doc.production, id)?.task;
  if (t && days) setTaskDates(doc, id, addDays(t.start, days), addDays(t.end, days));
}

/** Durée saisie (jours, au moins 1) : la fin suit. */
/**
 * Début, fin ou durée réglés sur la ligne d'une phase. Sans étape : ses dates propres. Avec des étapes :
 * un nouveau début déplace toute la phase d'un bloc (dépendances et étapes liées au plan de travail
 * respectées) ; une nouvelle fin allonge ou raccourcit l'étape qui finit le plus tard.
 */
export function setPhaseDates(doc: ProjectDoc, phaseId: ID, start: string, end: string): void {
  const plan = doc.production;
  const phase = plan?.phases.find((p) => p.id === phaseId);
  if (!plan || !phase || !isValidDate(start) || !isValidDate(end)) return;
  if (!phase.tasks.length) {
    phase.start = start;
    phase.end = end < start ? start : end;
    return;
  }
  const sp = phaseSpan(phase)!;
  if (start !== sp.start) {
    const delta = daysBetween(sp.start, start);
    for (const t of phase.tasks) if (!isPinned(doc, t) && !isHeld(doc, t)) setTaskDates(doc, t.id, addDays(t.start, delta), addDays(t.end, delta));
    return;
  }
  if (end !== sp.end) {
    const last = phase.tasks.filter((t) => !t.milestone && !isPinned(doc, t)).reduce<ProductionTask | undefined>((a, t) => (!a || t.end > a.end ? t : a), undefined);
    if (last) setTaskDates(doc, last.id, last.start, end < last.start ? last.start : end);
  }
}

/** Durée d'une phase réglée sur sa ligne : sa fin suit. */
export function setPhaseDays(doc: ProjectDoc, phaseId: ID, days: number): void {
  const phase = doc.production?.phases.find((p) => p.id === phaseId);
  const sp = phase && phaseSpan(phase);
  if (!sp || !Number.isFinite(days)) return;
  setPhaseDates(doc, phaseId, sp.start, addDays(sp.start, Math.max(1, Math.round(days)) - 1));
}

export function setDuration(doc: ProjectDoc, id: ID, days: number): void {
  const t = findTask(doc.production, id)?.task;
  if (!t || t.milestone || !Number.isFinite(days)) return;
  setTaskDates(doc, id, t.start, addDays(t.start, Math.max(1, Math.round(days)) - 1));
}

// --- Dépendances --------------------------------------------------------------------------------

/** Ajoute une dépendance (refusée si elle crée une boucle) ; l'élément est poussé s'il le faut. */
export function addDependency(doc: ProjectDoc, id: ID, pred: ID): boolean {
  const plan = doc.production;
  const t = findTask(plan, id)?.task;
  if (!plan || !t || !findTask(plan, pred) || id === pred || dependsOn(plan, pred, id) || t.after?.includes(pred)) return false;
  (t.after ??= []).push(pred);
  cascade(doc, [pred]);
  return true;
}

export function removeDependency(plan: Production, id: ID, pred: ID): void {
  const t = findTask(plan, id)?.task;
  if (!t?.after) return;
  t.after = t.after.filter((x) => x !== pred);
  if (!t.after.length) delete t.after;
}

// --- Structure ----------------------------------------------------------------------------------

export function ensureProduction(doc: ProjectDoc): Production {
  return (doc.production ??= { phases: [] });
}

/** Nouvelle phase (après `afterId`, sinon à la fin). */
export function addPhase(plan: Production, name = 'Nouvelle phase', afterId?: ID): ID {
  const id = newId();
  const i = afterId ? plan.phases.findIndex((p) => p.id === afterId) : -1;
  plan.phases.splice(i >= 0 ? i + 1 : plan.phases.length, 0, { id, name, tasks: [] });
  return id;
}

/**
 * Nouvelle étape (5 jours) ou nouveau jalon dans une phase, rangé après l'élément `afterId` et placé
 * à sa suite dans le temps ; sinon à la fin de la phase, après son dernier jour, ou à `today`.
 */
export function addTask(plan: Production, phaseId: ID, opts: { milestone?: boolean; afterId?: ID; name?: string; today?: string } = {}): ID | undefined {
  const phase = plan.phases.find((p) => p.id === phaseId);
  if (!phase) return undefined;
  const ref = opts.afterId ? phase.tasks.find((t) => t.id === opts.afterId) : undefined;
  // Première étape d'une phase datée : elle en reprend le début (et la fin).
  const own = !phase.tasks.length && phase.start && phase.end ? { start: phase.start, end: phase.end } : undefined;
  const anchor = ref ? ref.end : own ? undefined : phaseSpan(phase)?.end;
  const id = newId();
  const task: ProductionTask = { id, name: opts.name ?? (opts.milestone ? 'Nouveau jalon' : 'Nouvelle étape'), start: '', end: '' };
  if (opts.milestone) {
    task.milestone = true;
    task.start = task.end = anchor ?? opts.today ?? todayIso();
  } else if (own) {
    task.start = own.start;
    task.end = own.end;
  } else {
    task.start = anchor ? addDays(anchor, 1) : (opts.today ?? todayIso());
    task.end = addDays(task.start, 4);
  }
  if (opts.milestone && own) task.start = task.end = own.start;
  phase.tasks.splice(ref ? phase.tasks.indexOf(ref) + 1 : phase.tasks.length, 0, task);
  return id;
}

/** Supprime un élément ; les dépendances qui le citaient disparaissent avec lui. */
export function removeTask(plan: Production, id: ID): void {
  const ref = findTask(plan, id);
  if (!ref) return;
  ref.phase.tasks = ref.phase.tasks.filter((t) => t.id !== id);
  for (const r of allTasks(plan)) if (r.task.after?.includes(id)) removeDependency(plan, r.task.id, id);
}

export function removePhase(plan: Production, id: ID): void {
  const phase = plan.phases.find((p) => p.id === id);
  if (!phase) return;
  for (const t of [...phase.tasks]) removeTask(plan, t.id);
  plan.phases = plan.phases.filter((p) => p.id !== id);
}

export function renameTask(plan: Production, id: ID, name: string): void {
  const t = findTask(plan, id)?.task;
  if (t && name.trim()) t.name = name.trim();
}

export function renamePhase(plan: Production, id: ID, name: string): void {
  const p = plan.phases.find((x) => x.id === id);
  if (p && name.trim()) p.name = name.trim();
}

export function setDone(plan: Production, id: ID, done: boolean): void {
  const t = findTask(plan, id)?.task;
  if (!t) return;
  if (done) t.done = true;
  else delete t.done;
}

/** Range un élément dans une phase, à la position `index` comptée avant son retrait (ordre du tableau). */
export function placeTask(plan: Production, id: ID, phaseId: ID, index: number): void {
  const ref = findTask(plan, id);
  const to = plan.phases.find((p) => p.id === phaseId);
  if (!ref || !to) return;
  const from = ref.phase.tasks.indexOf(ref.task);
  ref.phase.tasks.splice(from, 1);
  const at = Math.max(0, Math.min(to.tasks.length, ref.phase === to && from < index ? index - 1 : index));
  to.tasks.splice(at, 0, ref.task);
}

/** Range une phase à la position `index` comptée avant son retrait. */
export function placePhase(plan: Production, id: ID, index: number): void {
  const from = plan.phases.findIndex((p) => p.id === id);
  if (from < 0) return;
  const [p] = plan.phases.splice(from, 1);
  plan.phases.splice(Math.max(0, Math.min(plan.phases.length, from < index ? index - 1 : index)), 0, p);
}

// --- Plan de travail ----------------------------------------------------------------------------

/** Lie une étape au plan de travail (une seule à la fois) ou la délie. */
export function setLinked(doc: ProjectDoc, id: ID, on: boolean): void {
  const plan = doc.production;
  const t = findTask(plan, id)?.task;
  if (!plan || !t || t.milestone) return;
  for (const r of allTasks(plan)) {
    delete r.task.linked;
    delete r.task.planned;
  }
  if (on) {
    t.linked = 'schedule';
    t.planned = durationDays(t);
  }
  syncProduction(doc);
}

/**
 * Éléments qui suivent `id` sans écart (début collé à la fin de leur prédécesseur), de proche en
 * proche : ils forment un bloc avec lui.
 */
function gluedChain(plan: Production, id: ID): ProductionTask[] {
  const out: ProductionTask[] = [];
  const seen = new Set<ID>([id]);
  const queue = [id];
  while (queue.length) {
    const pred = findTask(plan, queue.shift()!)?.task;
    if (!pred) continue;
    for (const { task } of successors(plan, pred.id)) {
      if (seen.has(task.id) || task.linked || startBound(task) !== finishBound(pred)) continue;
      seen.add(task.id);
      out.push(task);
      queue.push(task.id);
    }
  }
  return out;
}

/**
 * L'étape liée suit les jours de tournage datés. Les éléments collés à sa suite gardent leur écart
 * avec elle, dans les deux sens (une date erronée puis corrigée ne laisse rien derrière), sans jamais
 * passer avant un autre prédécesseur ; les autres successeurs sont poussés s'il le faut.
 */
export function syncProduction(doc: ProjectDoc): void {
  const plan = doc.production;
  if (!plan) return;
  const linked = allTasks(plan).find((r) => r.task.linked)?.task;
  const range = linked && shootingRange(doc);
  if (!linked || !range) return;
  linked.planned ??= durationDays(linked);
  const next = linkedSpan(range, linked.planned);
  if (linked.start === next.start && linked.end === next.end) return;
  const delta = daysBetween(linked.end, next.end);
  const glued = delta ? gluedChain(plan, linked.id) : [];
  linked.start = next.start;
  linked.end = next.end;
  for (const t of glued) shift(t, delta);
  // Ramenés trop tôt : chacun reste après tous ses prédécesseurs.
  for (let changed = true, guard = 0; changed && guard < 10_000; guard++) {
    changed = false;
    for (const t of glued) {
      const need = earliestBound(plan, t);
      if (need && startBound(t) < need) {
        shift(t, daysBetween(startBound(t), need));
        changed = true;
      }
    }
  }
  cascade(doc, [linked.id, ...glued.map((t) => t.id)]);
}

// --- Modèle -------------------------------------------------------------------------------------

interface TemplateTask {
  key: string;
  name: string;
  /** Durée en jours ; 0 = jalon. */
  days: number;
  after?: string[];
  linked?: boolean;
}

const M = (key: string, name: string, after: string[]): TemplateTask => ({ key, name, days: 0, after });

const TEMPLATE: ReadonlyArray<{ name: string; tasks: TemplateTask[] }> = [
  {
    name: 'Développement',
    tasks: [{ key: 'vt', name: 'Version de tournage du scénario', days: 28 }, M('lock', 'Scénario verrouillé', ['vt'])],
  },
  {
    name: 'Préparation',
    tasks: [
      { key: 'rep', name: 'Repérages', days: 21, after: ['lock'] },
      { key: 'cast', name: 'Casting', days: 28, after: ['lock'] },
      { key: 'deco', name: 'Décors', days: 21, after: ['rep'] },
      { key: 'cost', name: 'Costumes', days: 21, after: ['cast'] },
      { key: 'hmu', name: 'Maquillage et coiffure', days: 14, after: ['cast'] },
      { key: 'mat', name: 'Matériel', days: 10, after: ['rep'] },
    ],
  },
  {
    name: 'Tournage',
    tasks: [{ key: 'shoot', name: 'Tournage', days: 25, after: ['deco', 'cost', 'hmu', 'mat'], linked: true }],
  },
  {
    name: 'Postproduction',
    tasks: [
      { key: 'edit', name: 'Montage image', days: 42, after: ['shoot'] },
      M('dc', 'Version réalisateur', ['edit']),
      { key: 'final', name: 'Montage définitif', days: 21, after: ['dc'] },
      { key: 'grade', name: 'Étalonnage', days: 10, after: ['final'] },
      { key: 'sound', name: 'Montage son', days: 21, after: ['final'] },
      { key: 'mix', name: 'Mixage', days: 7, after: ['sound'] },
      M('picture', 'Image verrouillée', ['grade', 'mix']),
    ],
  },
  {
    name: 'Diffusion',
    tasks: [M('dcp', 'Copie de diffusion', ['picture'])],
  },
];

/**
 * Calendrier type, enchaîné à partir de `today`. Le tournage est lié au plan de travail ; s'il y est
 * déjà daté, développement et préparation se calent juste avant lui (au besoin dans le passé) et la
 * postproduction s'enchaîne après lui.
 */
export function productionTemplate(doc: ProjectDoc, today = todayIso()): Production {
  const ids = new Map<string, ID>();
  const byKey = new Map<string, ProductionTask>();
  const plan: Production = { phases: [] };
  for (const ph of TEMPLATE) {
    const phase: ProductionPhase = { id: newId(), name: ph.name, tasks: [] };
    for (const tt of ph.tasks) {
      const id = newId();
      ids.set(tt.key, id);
      let bound = today;
      for (const k of tt.after ?? []) bound = maxDate(bound, finishBound(byKey.get(k)!));
      const task: ProductionTask = tt.days
        ? { id, name: tt.name, start: bound, end: addDays(bound, tt.days - 1) }
        : { id, name: tt.name, start: maxDate(addDays(bound, -1), today), end: maxDate(addDays(bound, -1), today), milestone: true };
      if (tt.after?.length) task.after = tt.after.map((k) => ids.get(k)!);
      if (tt.linked) {
        task.linked = 'schedule';
        task.planned = tt.days;
      }
      byKey.set(tt.key, task);
      phase.tasks.push(task);
    }
    plan.phases.push(phase);
  }
  const range = shootingRange(doc);
  if (range) {
    // Tournage déjà daté : le calendrier se construit autour de lui, en amont comme en aval.
    const shoot = byKey.get('shoot')!;
    const span = linkedSpan(range, shoot.planned ?? durationDays(shoot));
    const before = daysBetween(shoot.start, span.start);
    const after = daysBetween(shoot.end, span.end);
    plan.phases.forEach((ph, i) => {
      if (i !== 2) for (const t of ph.tasks) shift(t, i < 2 ? before : after);
    });
    shoot.start = span.start;
    shoot.end = span.end;
  }
  return plan;
}

/** Remplit un calendrier vide avec le modèle, puis cale le tournage sur le plan de travail. */
export function applyTemplate(doc: ProjectDoc, today = todayIso()): void {
  if (doc.production?.phases.length) return;
  doc.production = productionTemplate(doc, today);
  syncProduction(doc);
}

// --- Fichier ------------------------------------------------------------------------------------

/** Données relues d'un fichier : éléments sans date valide écartés, dépendances orphelines retirées. */
export function normalizeProduction(doc: ProjectDoc): void {
  const plan = doc.production as Production | undefined;
  if (!plan) return;
  if (typeof plan !== 'object' || !Array.isArray(plan.phases)) {
    delete doc.production;
    return;
  }
  plan.phases = plan.phases.filter((p) => p && typeof p.id === 'string');
  for (const p of plan.phases) {
    if (typeof p.name !== 'string') p.name = '';
    p.tasks = (Array.isArray(p.tasks) ? p.tasks : []).filter((t) => t && typeof t.id === 'string' && isValidDate(t.start));
    for (const t of p.tasks) {
      if (typeof t.name !== 'string') t.name = '';
      if (t.milestone || !isValidDate(t.end) || t.end < t.start) t.end = t.start;
      if (!t.linked || !Number.isInteger(t.planned) || t.planned! < 1) delete t.planned;
    }
  }
  const known = new Set(allTasks(plan).map((r) => r.task.id));
  for (const { task } of allTasks(plan)) {
    if (!task.after) continue;
    task.after = Array.isArray(task.after) ? task.after.filter((x) => known.has(x) && x !== task.id) : [];
    if (!task.after.length) delete task.after;
  }
}
