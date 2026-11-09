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
}

export interface ProductionPhase {
  id: ID;
  name: string;
  tasks: ProductionTask[];
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
  if (!phase.tasks.length) return undefined;
  let start = phase.tasks[0].start;
  let end = phase.tasks[0].end;
  for (const t of phase.tasks) {
    if (t.start < start) start = t.start;
    if (t.end > end) end = t.end;
  }
  return { start, end };
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

/** Premier et dernier jour de tournage datés du plan de travail. */
export function shootingRange(doc: ProjectDoc): Span | undefined {
  const dates = scheduleDays(doc)
    .map((d) => d.date)
    .filter((d): d is string => isValidDate(d))
    .map((d) => d.slice(0, 10))
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : undefined;
}

/** Étape dont les dates sont tenues par le plan de travail (liée, et des jours y sont datés). */
export const isPinned = (doc: ProjectDoc, t: ProductionTask) => !!t.linked && !!shootingRange(doc);

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
  t.start = start;
  t.end = t.milestone || end < start ? start : end;
  const need = earliestBound(plan, t);
  if (need && startBound(t) < need) shift(t, daysBetween(startBound(t), need));
  cascade(doc, [id]);
}

/** Déplace un élément de `days` jours (glisser une barre). */
export function moveTask(doc: ProjectDoc, id: ID, days: number): void {
  const t = findTask(doc.production, id)?.task;
  if (t && days) setTaskDates(doc, id, addDays(t.start, days), addDays(t.end, days));
}

/** Durée saisie (jours, au moins 1) : la fin suit. */
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
  const anchor = ref ? ref.end : phaseSpan(phase)?.end;
  const id = newId();
  const task: ProductionTask = { id, name: opts.name ?? (opts.milestone ? 'Nouveau jalon' : 'Nouvelle étape'), start: '', end: '' };
  if (opts.milestone) {
    task.milestone = true;
    task.start = task.end = anchor ?? opts.today ?? todayIso();
  } else {
    task.start = anchor ? addDays(anchor, 1) : (opts.today ?? todayIso());
    task.end = addDays(task.start, 4);
  }
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
  for (const r of allTasks(plan)) delete r.task.linked;
  if (on) t.linked = 'schedule';
  syncProduction(doc);
}

/** L'étape liée suit les jours de tournage datés ; ses successeurs sont poussés s'il le faut. */
export function syncProduction(doc: ProjectDoc): void {
  const plan = doc.production;
  if (!plan) return;
  const linked = allTasks(plan).find((r) => r.task.linked)?.task;
  const range = linked && shootingRange(doc);
  if (!linked || !range || (linked.start === range.start && linked.end === range.end)) return;
  linked.start = range.start;
  linked.end = range.end;
  cascade(doc, [linked.id]);
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
 * déjà daté plus tard, développement et préparation se calent juste avant lui.
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
      if (tt.linked) task.linked = 'schedule';
      byKey.set(tt.key, task);
      phase.tasks.push(task);
    }
    plan.phases.push(phase);
  }
  const range = shootingRange(doc);
  const shoot = byKey.get('shoot')!;
  if (range && range.start > shoot.start) {
    const gap = daysBetween(shoot.start, range.start);
    for (const ph of plan.phases.slice(0, 2)) for (const t of ph.tasks) shift(t, gap);
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
    }
  }
  const known = new Set(allTasks(plan).map((r) => r.task.id));
  for (const { task } of allTasks(plan)) {
    if (!task.after) continue;
    task.after = Array.isArray(task.after) ? task.after.filter((x) => known.has(x) && x !== task.id) : [];
    if (!task.after.length) delete task.after;
  }
}
