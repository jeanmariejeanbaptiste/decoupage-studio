import { addDays, addMonths, isoWeek, startOfMonth, weekday } from './calendar';
import { daysBetween, durationDays, formatFrDate, isLate, phaseDays, phaseSpan, planSpan, type Production, type ProductionPhase, type ProductionTask } from './production';
import type { ID } from './types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Frise du calendrier de production : échelle de temps, lignes, et rendu SVG pour l'export. */

export type GanttZoom = 'weeks' | 'months' | 'quarters';

export const GANTT_ZOOMS: ReadonlyArray<{ zoom: GanttZoom; label: string; dayWidth: number; pad: number }> = [
  { zoom: 'weeks', label: 'Semaines', dayWidth: 22, pad: 14 },
  { zoom: 'months', label: 'Mois', dayWidth: 5, pad: 30 },
  { zoom: 'quarters', label: 'Trimestres', dayWidth: 1.6, pad: 60 },
];

export const zoomInfo = (z: GanttZoom) => GANTT_ZOOMS.find((x) => x.zoom === z) ?? GANTT_ZOOMS[1];

/** Zoom voisin : `+1` rapproche (plus de détail), `-1` éloigne. */
export function nextZoom(z: GanttZoom, dir: 1 | -1): GanttZoom {
  const i = GANTT_ZOOMS.findIndex((x) => x.zoom === z);
  return GANTT_ZOOMS[Math.max(0, Math.min(GANTT_ZOOMS.length - 1, i - dir))].zoom;
}

const endOfMonth = (date: string) => addDays(addMonths(startOfMonth(date), 1), -1);

/** Période affichée : tout le calendrier et aujourd'hui, avec une marge, en mois entiers. */
export function chartRange(plan: Production | undefined, today: string, pad: number): { from: string; to: string } {
  const span = planSpan(plan);
  const lo = span && span.start < today ? span.start : today;
  const hi = span && span.end > today ? span.end : today;
  return { from: startOfMonth(addDays(lo, -pad)), to: endOfMonth(addDays(hi, pad)) };
}

export interface ScaleSegment {
  key: string;
  label: string;
  x: number;
  w: number;
}

export interface TimeScale {
  from: string;
  to: string;
  dayWidth: number;
  days: number;
  width: number;
  years: ScaleSegment[];
  months: ScaleSegment[];
  weeks: ScaleSegment[];
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Libellé d'un mois selon la place : « novembre », « nov. », « N ». */
export function monthLabel(date: string, width: number): string {
  const m = Number(date.slice(5, 7)) - 1;
  if (width >= 72) return MONTHS[m];
  if (width >= 30) return SHORT[m];
  return width >= 9 ? MONTHS[m].charAt(0).toLocaleUpperCase('fr') : '';
}

/** Échelle : années, mois et semaines ISO (numéros) entre `from` et `to` inclus. */
export function timeScale(from: string, to: string, dayWidth: number): TimeScale {
  const days = daysBetween(from, to) + 1;
  const x = (d: string) => daysBetween(from, d) * dayWidth;
  const clip = (a: string, b: string) => ({ x: x(a < from ? from : a), w: (daysBetween(a < from ? from : a, b > to ? to : b) + 1) * dayWidth });
  const years: ScaleSegment[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    years.push({ key: `y${y}`, label: String(y), ...clip(`${y}-01-01`, `${y}-12-31`) });
  }
  const months: ScaleSegment[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
    const seg = clip(m, endOfMonth(m));
    months.push({ key: `m${m.slice(0, 7)}`, label: monthLabel(m, seg.w), ...seg });
  }
  const weeks: ScaleSegment[] = [];
  const weekW = 7 * dayWidth;
  let i = 0;
  for (let w = addDays(from, -weekday(from)); w <= to; w = addDays(w, 7), i++) {
    const n = isoWeek(w).week;
    const seg = clip(w, addDays(w, 6));
    // Semaines étroites : un numéro sur deux.
    const label = weekW >= 34 ? `S${n}` : weekW >= 16 || i % 2 === 0 ? String(n) : '';
    weeks.push({ key: `w${w}`, label: seg.w >= 12 ? label : '', ...seg });
  }
  return { from, to, dayWidth, days, width: days * dayWidth, years, months, weeks };
}

/** Abscisse du début d'une journée. */
export const dayX = (scale: Pick<TimeScale, 'from' | 'dayWidth'>, date: string) => daysBetween(scale.from, date) * scale.dayWidth;

/** Barre d'une étape : du début de son premier jour à la fin du dernier ; jalon : centre de sa journée. */
export function barGeometry(scale: Pick<TimeScale, 'from' | 'dayWidth'>, t: ProductionTask): { x: number; w: number } {
  const x = dayX(scale, t.start);
  if (t.milestone) return { x: x + scale.dayWidth / 2, w: 0 };
  return { x, w: Math.max(scale.dayWidth, (durationDays(t)) * scale.dayWidth) };
}

// --- Lignes ---------------------------------------------------------------------------------------

export type GanttRow = { type: 'phase'; phase: ProductionPhase; index: number } | { type: 'task'; phase: ProductionPhase; index: number; task: ProductionTask };

/** Lignes du tableau et de la frise : chaque phase suivie de ses éléments (sauf si elle est repliée). */
export function ganttRows(plan: Production | undefined, collapsed: ReadonlySet<ID> = new Set()): GanttRow[] {
  const out: GanttRow[] = [];
  (plan?.phases ?? []).forEach((phase, index) => {
    out.push({ type: 'phase', phase, index });
    if (!collapsed.has(phase.id)) for (const task of phase.tasks) out.push({ type: 'task', phase, index, task });
  });
  return out;
}

export interface DependencyLink {
  key: string;
  from: ID;
  to: ID;
  /** Tracé coudé (coordonnées de la frise). */
  path: string;
  late: boolean;
}

/**
 * Flèches des dépendances visibles : de la fin du prédécesseur au début du successeur, en coude.
 * Successeur collé ou en retrait : la flèche descend, recule, puis repart vers lui.
 */
export function dependencyLinks(rows: readonly GanttRow[], scale: Pick<TimeScale, 'from' | 'dayWidth'>, rowHeight: number): DependencyLink[] {
  const pos = new Map<ID, { row: number; task: ProductionTask }>();
  rows.forEach((r, i) => r.type === 'task' && pos.set(r.task.id, { row: i, task: r.task }));
  const out: DependencyLink[] = [];
  const mid = (row: number) => row * rowHeight + rowHeight / 2;
  const half = Math.min(6, rowHeight / 3);
  for (const { row, task } of pos.values()) {
    for (const predId of task.after ?? []) {
      const p = pos.get(predId);
      if (!p) continue;
      const a = barGeometry(scale, p.task);
      const b = barGeometry(scale, task);
      const x1 = p.task.milestone ? a.x + half : a.x + a.w;
      const y1 = mid(p.row);
      const x2 = task.milestone ? b.x - half : b.x;
      const y2 = mid(row);
      const down = y2 > y1 ? 1 : -1;
      let path: string;
      if (x2 - x1 >= 12) {
        // Assez de place : on sort à droite, on descend, on entre par la gauche.
        const xm = x1 + 6;
        path = `M${x1},${y1} H${xm} V${y2} H${x2}`;
      } else {
        const yb = y1 + down * (rowHeight / 2);
        path = `M${x1},${y1} H${x1 + 6} V${yb} H${x2 - 8} V${y2} H${x2}`;
      }
      out.push({ key: `${predId}>${task.id}`, from: predId, to: task.id, path, late: isLate(task, p.task) });
    }
  }
  return out;
}

// --- Export ---------------------------------------------------------------------------------------

/** Gris d'impression d'une phase (même ordre que les nuances de l'écran). */
export const PRINT_SHADES = ['#4a4e55', '#8c9097', '#26292e', '#b0b3b9', '#6c7077'];
export const phaseShade = (index: number) => PRINT_SHADES[index % PRINT_SHADES.length];

/**
 * Frise imprimable en pages (A4 paysage) : tableau à gauche (étape, début, fin, durée), barres à
 * droite, échelle mois / semaines en tête de chaque page. Une page ne coupe jamais une ligne.
 */
export function productionSvgPages(plan: Production, today: string, opts: { width?: number; rowsPerPage?: number } = {}): string[] {
  const W = opts.width ?? 1000;
  const per = opts.rowsPerPage ?? 26;
  const rows = ganttRows(plan);
  if (!rows.length) return [];
  const col = { name: 8, start: 262, end: 322, dur: 412 };
  const chartX = 420;
  const chartW = W - chartX;
  const span = planSpan(plan) ?? { start: today, end: today };
  const from = startOfMonth(span.start);
  const to = endOfMonth(span.end);
  const dayWidth = chartW / (daysBetween(from, to) + 1);
  const scale = timeScale(from, to, dayWidth);
  const RH = 19;
  const HEAD = 40;
  const font = `font-family="Inter Variable, Inter, Helvetica Neue, Arial, sans-serif"`;
  const pages: string[] = [];
  for (let p = 0; p * per < rows.length; p++) {
    const chunk = rows.slice(p * per, (p + 1) * per);
    const H = HEAD + chunk.length * RH + 1;
    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" ${font} font-size="9">`);
    // En-tête : années et mois, puis semaines.
    for (const m of scale.months) {
      out.push(`<line x1="${chartX + m.x}" y1="0" x2="${chartX + m.x}" y2="${H}" stroke="#d6d8dd" stroke-width="0.6"/>`);
      const yLabel = `${m.label}${m.x === 0 || m.key.endsWith('-01') ? ` ${m.key.slice(1, 5)}` : ''}`;
      out.push(`<text x="${chartX + m.x + 3}" y="13" fill="#111318">${esc(m.w > 60 ? yLabel : m.label)}</text>`);
    }
    for (const w of scale.weeks) if (w.label && w.w >= 9) out.push(`<text x="${chartX + w.x + w.w / 2}" y="31" fill="#6b7079" font-size="7" text-anchor="middle">${esc(w.label)}</text>`);
    out.push(`<text x="${col.name}" y="31" fill="#6b7079" font-size="7.5" letter-spacing=".6">ÉTAPE</text>`);
    out.push(`<text x="${col.start}" y="31" fill="#6b7079" font-size="7.5" letter-spacing=".6">DÉBUT</text>`);
    out.push(`<text x="${col.end}" y="31" fill="#6b7079" font-size="7.5" letter-spacing=".6">FIN</text>`);
    out.push(`<text x="${col.dur + 0}" y="31" fill="#6b7079" font-size="7.5" letter-spacing=".6" text-anchor="end">JOURS</text>`);
    out.push(`<line x1="0" y1="${HEAD - 4}" x2="${W}" y2="${HEAD - 4}" stroke="#111318" stroke-width="1.1"/>`);
    // Aujourd'hui.
    if (today >= from && today <= to) {
      const tx = chartX + dayX(scale, today) + dayWidth / 2;
      out.push(`<line x1="${tx}" y1="${HEAD - 4}" x2="${tx}" y2="${H}" stroke="#111318" stroke-width="0.8" stroke-dasharray="2 2"/>`);
    }
    chunk.forEach((r, i) => {
      const y = HEAD + i * RH;
      const cy = y + RH / 2 + 3;
      out.push(`<line x1="0" y1="${y + RH}" x2="${W}" y2="${y + RH}" stroke="#e6e8ec" stroke-width="0.5"/>`);
      const shade = phaseShade(r.index);
      if (r.type === 'phase') {
        const sp = phaseSpan(r.phase);
        out.push(`<text x="${col.name}" y="${cy}" fill="#111318" font-weight="600">${esc(r.phase.name)}</text>`);
        if (sp) {
          out.push(`<text x="${col.start}" y="${cy}" fill="#111318" font-weight="600">${formatFrDate(sp.start)}</text>`);
          out.push(`<text x="${col.end}" y="${cy}" fill="#111318" font-weight="600">${formatFrDate(sp.end)}</text>`);
          out.push(`<text x="${col.dur}" y="${cy}" fill="#111318" font-weight="600" text-anchor="end">${phaseDays(r.phase) || ''}</text>`);
        }
        // Accolade de la phase (pas pour une phase faite seulement de jalons).
        if (sp && phaseDays(r.phase)) {
          const x = chartX + dayX(scale, sp.start);
          const w = (daysBetween(sp.start, sp.end) + 1) * dayWidth;
          out.push(`<path d="M${x},${y + 6} H${x + w} V${y + 13} L${x + w - 3},${y + 10} H${x + 3} L${x},${y + 13} Z" fill="#111318"/>`);
        }
        return;
      }
      const t = r.task;
      const name = t.name;
      out.push(`<text x="${col.name + 10}" y="${cy}" fill="${t.done ? '#6b7079' : '#111318'}"${t.done ? ' text-decoration="line-through"' : ''}>${esc(name.length > 46 ? `${name.slice(0, 45)}…` : name)}</text>`);
      out.push(`<text x="${col.start}" y="${cy}" fill="#111318">${formatFrDate(t.start)}</text>`);
      if (!t.milestone) {
        out.push(`<text x="${col.end}" y="${cy}" fill="#111318">${formatFrDate(t.end)}</text>`);
        out.push(`<text x="${col.dur}" y="${cy}" fill="#111318" text-anchor="end">${durationDays(t)}</text>`);
      } else out.push(`<text x="${col.dur}" y="${cy}" fill="#6b7079" text-anchor="end">jalon</text>`);
      const g = barGeometry(scale, t);
      if (t.milestone) {
        const cx = chartX + g.x;
        const my = y + RH / 2;
        out.push(`<path d="M${cx},${my - 5} L${cx + 5},${my} L${cx},${my + 5} L${cx - 5},${my} Z" fill="#111318"/>`);
      } else {
        out.push(`<rect x="${chartX + g.x}" y="${y + 4}" width="${Math.max(1.2, g.w)}" height="${RH - 8}" rx="1.5" fill="${shade}"${t.done ? ' fill-opacity="0.45"' : ''}/>`);
      }
    });
    // Dépendances de la page.
    const sub = { from, dayWidth };
    for (const l of dependencyLinks(chunk, sub, RH)) {
      out.push(`<path d="${l.path}" transform="translate(${chartX},${HEAD})" fill="none" stroke="#6b7079" stroke-width="0.6"${l.late ? ' stroke-dasharray="2 1.5"' : ''}/>`);
    }
    out.push('</svg>');
    pages.push(out.join(''));
  }
  return pages;
}
