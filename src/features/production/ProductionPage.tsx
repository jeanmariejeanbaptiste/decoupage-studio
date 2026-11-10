import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { produce } from 'immer';
import { CalendarDays, Check, ChevronDown, ChevronRight, GripVertical, Link2, Minus, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { navigate, useLocation } from '../../app/router';
import { addDays, calendarIcs, calendarItems, isWeekend, productionItems, timeOn, todayIso } from '../../domain/calendar';
import { productionDocument, productionWordDocument } from '../../domain/documents';
import {
  addDependency,
  addPhase,
  addTask,
  applyTemplate,
  planSpan,
  daysBetween,
  dependencyCandidates,
  durationDays,
  ensureProduction,
  findTask,
  formatFrDate,
  isHeld,
  isPinned,
  moveTask,
  parseFrDate,
  phaseDays,
  phaseSpan,
  placePhase,
  placeTask,
  removeDependency,
  removePhase,
  removeTask,
  renamePhase,
  renameTask,
  setDone,
  setDuration,
  setLinked,
  setTaskDates,
  shootingRange,
  type Production,
  type ProductionTask,
} from '../../domain/production';
import { barGeometry, chartRange, dayX, dependencyLinks, ganttRows, GANTT_ZOOMS, nextZoom, timeScale, zoomInfo, type GanttRow, type GanttZoom } from '../../domain/productionChart';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
import { TabExport } from '../export/TabExport';
import s from './ProductionPage.module.css';

const ICON = { size: 16, strokeWidth: 1.25 } as const;
const SMALL = { size: 14, strokeWidth: 1.25 } as const;
const RH = 32;
const HEAD = 58;
const ZOOM_KEY = 'ds-production-zoom';
/** Nuances de gris des phases (part d'encre), dans l'ordre des phases ; mêmes rangs à l'impression. */
const SHADES = [62, 36, 82, 24, 48];

const shade = (index: number) => `color-mix(in srgb, var(--ink) ${SHADES[index % SHADES.length]}%, var(--paper-card))`;

function stored<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (ok as readonly string[]).includes(v)) return v as T;
  } catch {
    /* stockage indisponible */
  }
  return fallback;
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

/** Glisser en cours dans la frise : déplacement d'une barre ou de l'un de ses bords. */
interface BarDrag {
  id: ID;
  mode: 'move' | 'start' | 'end';
  x0: number;
  days: number;
}

/** Glisser en cours dans le tableau : une ligne qu'on range ailleurs. */
interface RowDrag {
  row: GanttRow;
  y0: number;
  gap: number;
}

interface Menu {
  row: GanttRow;
  x: number;
  y: number;
  deps?: boolean;
}

/** Calendrier de production : tableau des étapes à gauche, frise (Gantt) à droite. */
export function ProductionPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const today = todayIso();
  const projectId = doc.project.id;
  const collapseKey = `ds-production-collapsed-${projectId}`;
  const [zoom, setZoomState] = useState<GanttZoom>(() => stored(ZOOM_KEY, GANTT_ZOOMS.map((z) => z.zoom), 'months'));
  const [collapsed, setCollapsed] = useState<Set<ID>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(collapseKey) ?? '[]') as ID[]);
    } catch {
      return new Set();
    }
  });
  const [bar, setBar] = useState<BarDrag | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [hover, setHover] = useState<ID | null>(null);
  const focusId = useLocation().params.get('task');
  const [focus, setFocus] = useState<ID | null>(null);

  const plan = doc.production;
  // Barre tirée : le calendrier (et sa cascade) se lit sur l'aperçu, rien n'est écrit avant le lâcher.
  const preview = useMemo<Production | undefined>(() => {
    if (!bar || !bar.days) return plan;
    return produce(doc, (d) => applyBarDrag(d, bar)).production;
  }, [doc, plan, bar]);
  const rows = useMemo(() => ganttRows(preview, collapsed), [preview, collapsed]);
  const info = zoomInfo(zoom);
  const range = useMemo(() => chartRange(plan, today, info.pad), [plan, today, info.pad]);
  const scale = useMemo(() => timeScale(range.from, range.to, info.dayWidth), [range, info.dayWidth]);
  const links = useMemo(() => dependencyLinks(rows, scale, RH), [rows, scale]);

  const tableBody = useRef<HTMLDivElement>(null);
  const chart = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  // Date gardée au centre de la frise quand le zoom change ; au premier affichage, aujourd'hui.
  const anchor = useRef<string | null>(null);

  const toggle = (id: ID) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    store(collapseKey, JSON.stringify([...next]));
  };

  const centerDate = () => {
    const el = chart.current;
    if (!el) return today;
    return addDays(scale.from, Math.round((el.scrollLeft + el.clientWidth / 2) / scale.dayWidth));
  };
  const setZoom = (z: GanttZoom) => {
    if (z === zoom) return;
    anchor.current = centerDate();
    setZoomState(z);
    store(ZOOM_KEY, z);
  };
  const scrollToDate = (date: string, where: 'center' | 'start' = 'center') => {
    const el = chart.current;
    if (!el) return;
    const x = dayX(scale, date);
    el.scrollLeft = where === 'center' ? x - el.clientWidth / 2 : x - Math.min(160, el.clientWidth / 5);
  };
  useLayoutEffect(() => {
    if (anchor.current) scrollToDate(anchor.current);
    anchor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale.dayWidth]);
  // Premier affichage : aujourd'hui en vue, un peu après le bord gauche.
  const hasRows = rows.length > 0;
  useLayoutEffect(() => {
    if (hasRows) scrollToDate(today, 'start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRows]);

  // Venu du calendrier (« ?task=id ») : la ligne est dépliée, montrée et marquée.
  useEffect(() => {
    if (!focusId) return;
    const ref = findTask(doc.production, focusId);
    if (!ref) return;
    if (collapsed.has(ref.phase.id)) toggle(ref.phase.id);
    setFocus(focusId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-row="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center' });
      scrollToDate(ref.task.start);
    });
    const t = setTimeout(() => setFocus(null), 2400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const onChartScroll = () => {
    if (syncing.current) return void (syncing.current = false);
    if (tableBody.current && chart.current && tableBody.current.scrollTop !== chart.current.scrollTop) {
      syncing.current = true;
      tableBody.current.scrollTop = chart.current.scrollTop;
    }
  };
  const onTableScroll = () => {
    if (syncing.current) return void (syncing.current = false);
    if (tableBody.current && chart.current && tableBody.current.scrollTop !== chart.current.scrollTop) {
      syncing.current = true;
      chart.current.scrollTop = tableBody.current.scrollTop;
    }
  };

  // --- Actions -----------------------------------------------------------------------------------

  const add = (row: GanttRow, milestone: boolean) => {
    const id = mutateDoc((d) => addTask(ensureProduction(d), row.phase.id, { milestone, afterId: row.type === 'task' ? row.task.id : undefined, today }));
    if (collapsed.has(row.phase.id)) toggle(row.phase.id);
    if (id) setRenaming(id);
  };
  const addPhaseAfter = (afterId?: ID) => {
    const id = mutateDoc((d) => addPhase(ensureProduction(d), 'Nouvelle phase', afterId));
    if (id) setRenaming(id);
  };
  const remove = async (row: GanttRow) => {
    if (row.type === 'task') return mutateDoc((d) => removeTask(d.production!, row.task.id));
    if (row.phase.tasks.length) {
      const n = row.phase.tasks.length;
      const r = await ask({ title: `Supprimer la phase « ${row.phase.name} » ?`, body: `Ses ${n > 1 ? `${n} éléments seront supprimés` : 'élément sera supprimé'} avec elle.`, confirmLabel: 'Supprimer', danger: true });
      if (!r.ok) return;
    }
    mutateDoc((d) => removePhase(d.production!, row.phase.id));
  };
  const rename = (row: GanttRow, name: string) => {
    setRenaming(null);
    mutateDoc((d) => (row.type === 'task' ? renameTask(d.production!, row.task.id, name) : renamePhase(d.production!, row.phase.id, name)));
  };

  // --- Glisser une barre ------------------------------------------------------------------------

  const startBarDrag = (e: ReactPointerEvent, t: ProductionTask, mode: BarDrag['mode']) => {
    // Étape liée au plan de travail : figée s'il est tout daté, sinon seule sa fin se tire.
    if (readOnly || e.button !== 0 || isPinned(doc, t) || (isHeld(doc, t) && mode !== 'end')) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setBar({ id: t.id, mode: t.milestone ? 'move' : mode, x0: e.clientX, days: 0 });
  };
  const moveBarDrag = (e: ReactPointerEvent) => {
    if (!bar) return;
    const days = Math.round((e.clientX - bar.x0) / scale.dayWidth);
    if (days !== bar.days) setBar({ ...bar, days });
  };
  const endBarDrag = () => {
    if (!bar) return;
    const done = bar;
    setBar(null);
    if (done.days) mutateDoc((d) => applyBarDrag(d, done));
  };

  // --- Ranger une ligne du tableau ----------------------------------------------------------------

  const gapAt = (clientY: number) => {
    const el = tableBody.current;
    if (!el) return 0;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    return Math.max(0, Math.min(rows.length, Math.round(y / RH)));
  };
  const startRowDrag = (e: ReactPointerEvent, row: GanttRow) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setRowDrag({ row, y0: e.clientY, gap: gapAt(e.clientY) });
  };
  const moveRowDrag = (e: ReactPointerEvent) => {
    if (!rowDrag) return;
    const gap = gapAt(e.clientY);
    if (gap !== rowDrag.gap) setRowDrag({ ...rowDrag, gap });
  };
  const endRowDrag = () => {
    if (!rowDrag) return;
    const { row, gap } = rowDrag;
    setRowDrag(null);
    mutateDoc((d) => dropRow(d.production!, rows, row, gap));
  };

  // --- Rendu ---------------------------------------------------------------------------------------

  if (!plan?.phases.length) {
    return (
      <div className="page" data-testid="production">
        <div className="card empty">
          <span className="hand">Aucune étape</span>
          {!readOnly && (
            <div className={s.emptyActions}>
              <Button variant="primary" onClick={() => mutateDoc((d) => applyTemplate(d, today))} data-testid="production-template">
                Partir du modèle
              </Button>
              <Button variant="outline" onClick={() => addPhaseAfter()} data-testid="production-blank">
                Commencer vide
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const title = doc.project.title || 'projet';
  // Rendez-vous du calendrier, repérés sur la frise (un clic ouvre leur jour dans le calendrier).
  const appointments = calendarItems(doc).filter((it) => it.source === 'project' && it.date >= scale.from && it.date <= scale.to);
  const clearAll = async () => {
    const r = await ask({ title: 'Effacer le calendrier de production ?', body: 'Toutes les phases, étapes et jalons. ⌘Z les rétablit.', confirmLabel: 'Effacer', danger: true });
    if (r.ok) mutateDoc((d) => void delete d.production);
  };
  const width = scale.width;
  const bodyH = rows.length * RH;
  const todayX = today >= scale.from && today <= scale.to ? dayX(scale, today) + scale.dayWidth / 2 : null;
  const weekendBands = scale.dayWidth >= 12 ? Array.from({ length: scale.days }, (_, i) => addDays(scale.from, i)).filter(isWeekend) : [];

  return (
    <div className={s.page} data-testid="production">
      <header className={s.bar}>
        <div className={s.barStart}>
          <Button variant="icon" aria-label="Nouvelle phase" title="Nouvelle phase" icon={<Plus {...ICON} />} onClick={() => addPhaseAfter()} data-edit data-testid="phase-add" />
          <Button variant="icon" aria-label="Voir dans le calendrier" title="Voir dans le calendrier" icon={<CalendarDays {...ICON} />} onClick={() => navigate('calendar', { date: planSpan(plan)?.start ?? today })} data-view data-testid="production-to-calendar" />
          {!readOnly && <Button variant="icon" aria-label="Effacer le calendrier de production" title="Effacer le calendrier de production" icon={<Trash2 {...ICON} />} onClick={() => void clearAll()} data-edit data-testid="production-clear" />}
        </div>
        <div className={s.barEnd} data-view>
          <div className={s.zoom} role="group" aria-label="Zoom">
            <Button variant="icon" size="sm" aria-label="Éloigner" title="Éloigner" icon={<Minus {...ICON} />} disabled={zoom === 'quarters'} onClick={() => setZoom(nextZoom(zoom, -1))} data-testid="zoom-out" />
            <span className={s.zoomLabel} data-testid="zoom-label">
              {info.label}
            </span>
            <Button variant="icon" size="sm" aria-label="Rapprocher" title="Rapprocher" icon={<Plus {...ICON} />} disabled={zoom === 'weeks'} onClick={() => setZoom(nextZoom(zoom, 1))} data-testid="zoom-in" />
          </div>
          <Button variant="outline" size="sm" className={s.todayBtn} onClick={() => scrollToDate(today)}>
            Aujourd’hui
          </Button>
          <TabExport
            id="production"
            orientation="landscape"
            doc={() => productionDocument(useProjectStore.getState().doc ?? doc)}
            word={() => productionWordDocument(useProjectStore.getState().doc ?? doc)}
            fileBase={`${title}-calendrier-de-production`}
            file={{
              label: 'iCalendar',
              hint: 'Étapes et jalons, pour un agenda (.ics).',
              name: `${title}-calendrier-de-production.ics`,
              type: 'text/calendar;charset=utf-8',
              content: () => calendarIcs(productionItems(useProjectStore.getState().doc ?? doc, { withLinked: true }), `${title} · production`),
            }}
          />
        </div>
      </header>

      <div className={[s.gantt, bar || rowDrag ? s.dragging : ''].join(' ')} style={{ '--rh': `${RH}px`, '--head': `${HEAD}px` } as CSSProperties} onPointerLeave={() => setHover(null)}>
        {/* Tableau */}
        <div className={s.table} role="table" aria-label="Étapes">
          <div className={s.thead} role="row">
            <span role="columnheader" className={s.cName}>
              Étape
            </span>
            <span role="columnheader" className={s.cDate}>
              Début
            </span>
            <span role="columnheader" className={s.cDate}>
              Fin
            </span>
            <span role="columnheader" className={s.cDur}>
              Jours
            </span>
            <span className={s.cMenu} />
          </div>
          <div ref={tableBody} className={s.tbody} onScroll={onTableScroll} onPointerMove={moveRowDrag} onPointerUp={endRowDrag} onPointerCancel={() => setRowDrag(null)}>
            {rows.map((row) => {
              const id = row.type === 'task' ? row.task.id : row.phase.id;
              return (
                <TableRow
                  key={id}
                  doc={doc}
                  row={row}
                  readOnly={readOnly}
                  collapsed={collapsed.has(row.phase.id)}
                  renaming={renaming === id}
                  hover={hover === id}
                  focus={focus === id}
                  dragged={rowDrag?.row === row}
                  onHover={() => setHover(id)}
                  onToggle={() => toggle(row.phase.id)}
                  onRename={(name) => rename(row, name)}
                  onStartRename={() => !readOnly && setRenaming(id)}
                  onCancelRename={() => setRenaming(null)}
                  onGrip={(e) => startRowDrag(e, row)}
                  onMenu={(x, y) => setMenu({ row, x, y })}
                />
              );
            })}
            {rowDrag && <div className={s.dropLine} style={{ top: rowDrag.gap * RH - 1 }} aria-hidden="true" />}
          </div>
        </div>

        {/* Frise */}
        <div ref={chart} className={s.chart} onScroll={onChartScroll} data-testid="gantt">
          <div className={s.chartInner} style={{ width }}>
            <div className={s.scale} aria-hidden="true">
              <div className={s.scaleRow}>
                {scale.years.map((y) => (
                  <span key={y.key} className={s.year} style={{ left: y.x, width: y.w }}>
                    <b>{y.label}</b>
                  </span>
                ))}
              </div>
              <div className={s.scaleRow}>
                {scale.months.map((m) => (
                  <span key={m.key} className={s.month} style={{ left: m.x, width: m.w }}>
                    <b>{m.label}</b>
                  </span>
                ))}
              </div>
              <div className={s.scaleRow}>
                {scale.weeks.map((w) => (
                  <span key={w.key} className={s.week} style={{ left: w.x, width: w.w }}>
                    {w.label}
                  </span>
                ))}
              </div>
              {todayX !== null && <span className={s.todayMark} style={{ left: todayX }} />}
            </div>
            <div className={s.appts} data-view>
              {appointments.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={s.appt}
                  style={{ left: dayX(scale, it.date) + scale.dayWidth / 2 }}
                  title={[it.title, timeOn(it, it.date)].filter(Boolean).join(' · ')}
                  aria-label={`Rendez-vous : ${it.title}`}
                  onClick={() => navigate('calendar', { date: it.date })}
                  data-testid="production-appointment"
                />
              ))}
            </div>
            <div className={s.chartBody} style={{ height: bodyH }} onPointerMove={moveBarDrag} onPointerUp={endBarDrag} onPointerCancel={() => setBar(null)}>
              <svg className={s.grid} width={width} height={bodyH} aria-hidden="true">
                {weekendBands.map((d) => (
                  <rect key={d} x={dayX(scale, d)} y={0} width={scale.dayWidth} height={bodyH} className={s.weekend} />
                ))}
                {rows.map((r, i) => (r.type === 'phase' ? <rect key={r.phase.id} x={0} y={i * RH} width={width} height={RH} className={s.phaseBand} /> : null))}
                {(scale.dayWidth >= 12 ? scale.weeks : []).map((w) => (
                  <line key={w.key} x1={w.x + 0.5} x2={w.x + 0.5} y1={0} y2={bodyH} className={s.weekLine} />
                ))}
                {scale.months.map((m) => (
                  <line key={m.key} x1={m.x + 0.5} x2={m.x + 0.5} y1={0} y2={bodyH} className={s.monthLine} />
                ))}
                <defs>
                  <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" className={s.arrowHead} />
                  </marker>
                </defs>
                {links.map((l) => (
                  <path key={l.key} d={l.path} className={[s.link, l.late ? s.late : ''].join(' ')} markerEnd="url(#gantt-arrow)" data-testid="gantt-link">
                    {l.late && <title>Dépendance non respectée</title>}
                  </path>
                ))}
                {todayX !== null && <line x1={todayX} x2={todayX} y1={0} y2={bodyH} className={s.todayLine} />}
              </svg>
              {rows.map((r, i) => {
                const id = r.type === 'task' ? r.task.id : r.phase.id;
                const top = i * RH;
                const rowCls = [s.chartRow, hover === id ? s.hover : '', focus === id ? s.focus : ''].join(' ');
                if (r.type === 'phase') {
                  const sp = phaseSpan(r.phase);
                  return (
                    <div key={id} className={rowCls} style={{ top }} onPointerEnter={() => setHover(id)}>
                      {sp && phaseDays(r.phase) ? <span className={s.summary} style={{ left: dayX(scale, sp.start), width: (daysBetween(sp.start, sp.end) + 1) * scale.dayWidth }} title={`${r.phase.name} · ${formatFrDate(sp.start)} – ${formatFrDate(sp.end)}`} /> : null}
                    </div>
                  );
                }
                const t = r.task;
                const g = barGeometry(scale, t);
                const pinned = isPinned(doc, t);
                const held = isHeld(doc, t);
                const tip = t.milestone ? `${t.name} · ${formatFrDate(t.start)}` : `${t.name} · ${formatFrDate(t.start)} – ${formatFrDate(t.end)} · ${durationDays(t)} j`;
                return (
                  <div key={id} className={rowCls} style={{ top }} onPointerEnter={() => setHover(id)}>
                    {t.milestone ? (
                      <span
                        className={[s.milestone, t.done ? s.done : '', readOnly ? '' : s.movable].join(' ')}
                        style={{ left: g.x }}
                        title={tip}
                        onPointerDown={(e) => startBarDrag(e, t, 'move')}
                        data-testid="gantt-milestone"
                        data-task={t.id}
                      />
                    ) : (
                      <span
                        className={[s.taskBar, t.done ? s.done : '', pinned ? s.pinned : '', readOnly || held ? '' : s.movable, bar?.id === t.id ? s.active : ''].join(' ')}
                        style={{ left: g.x, width: g.w, background: shade(r.index) }}
                        title={tip}
                        onPointerDown={(e) => startBarDrag(e, t, 'move')}
                        data-testid="gantt-bar"
                        data-task={t.id}
                      >
                        {!readOnly && !pinned && (
                          <>
                            {!held && <i className={[s.handle, s.handleStart].join(' ')} onPointerDown={(e) => startBarDrag(e, t, 'start')} />}
                            <i className={[s.handle, s.handleEnd].join(' ')} onPointerDown={(e) => startBarDrag(e, t, 'end')} />
                          </>
                        )}
                      </span>
                    )}
                    <span className={[s.barLabel, t.done ? s.doneLabel : ''].join(' ')} style={{ left: t.milestone ? g.x + 10 : g.x + g.w + 6 }}>
                      {t.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <RowMenu
          menu={menu}
          doc={doc}
          onClose={() => setMenu(null)}
          onDeps={() => setMenu({ ...menu, deps: true })}
          onAdd={(m) => add(menu.row, m)}
          onAddPhase={() => addPhaseAfter(menu.row.phase.id)}
          onRemove={() => void remove(menu.row)}
        />
      )}
    </div>
  );
}

/** Applique un glisser de barre : déplacement, ou début / fin tirés (jamais au-delà de l'autre bord). */
function applyBarDrag(d: ProjectDoc, drag: BarDrag): void {
  const t = findTask(d.production, drag.id)?.task;
  if (!t) return;
  if (drag.mode === 'move') return moveTask(d, drag.id, drag.days);
  if (drag.mode === 'start') {
    const start = addDays(t.start, drag.days);
    return setTaskDates(d, drag.id, start > t.end ? t.end : start, t.end);
  }
  const end = addDays(t.end, drag.days);
  setTaskDates(d, drag.id, t.start, end < t.start ? t.start : end);
}

/**
 * Ligne lâchée dans l'intervalle `gap` (avant la ligne `gap`) : une étape se range après la ligne du
 * dessus (en tête de sa phase si c'est une phase) ; une phase, entre deux phases.
 */
function dropRow(plan: Production, rows: readonly GanttRow[], row: GanttRow, gap: number): void {
  if (row.type === 'phase') {
    const before = rows.slice(0, gap).filter((r) => r.type === 'phase').length;
    // Lâchée au milieu d'une phase : elle passe après celle-ci.
    return placePhase(plan, row.phase.id, before);
  }
  const above = rows[gap - 1];
  if (!above) return placeTask(plan, row.task.id, plan.phases[0].id, 0);
  if (above.type === 'phase') {
    const phase = plan.phases.find((p) => p.id === above.phase.id)!;
    // Sous une phase dépliée : en tête ; sous une phase repliée : à sa fin.
    const next = rows[gap];
    const open = next?.type === 'task' && next.phase.id === phase.id;
    return placeTask(plan, row.task.id, phase.id, open ? 0 : phase.tasks.length);
  }
  if (above.task.id === row.task.id) return;
  const phase = plan.phases.find((p) => p.id === above.phase.id)!;
  placeTask(plan, row.task.id, phase.id, phase.tasks.findIndex((t) => t.id === above.task.id) + 1);
}

// --- Ligne du tableau ------------------------------------------------------------------------------

interface RowProps {
  doc: ProjectDoc;
  row: GanttRow;
  readOnly: boolean;
  collapsed: boolean;
  renaming: boolean;
  hover: boolean;
  focus: boolean;
  dragged: boolean;
  onHover: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onGrip: (e: ReactPointerEvent) => void;
  onMenu: (x: number, y: number) => void;
}

function TableRow({ doc, row, readOnly, collapsed, renaming, hover, focus, dragged, onHover, onToggle, onRename, onStartRename, onCancelRename, onGrip, onMenu }: RowProps) {
  const isPhase = row.type === 'phase';
  const name = isPhase ? row.phase.name : row.task.name;
  const id = isPhase ? row.phase.id : row.task.id;
  const cls = [s.row, isPhase ? s.phaseRow : s.taskRow, hover ? s.hover : '', focus ? s.focus : '', dragged ? s.lifted : ''].join(' ');
  const menuBtn = (
    <button
      type="button"
      className={s.menuBtn}
      aria-label={`Actions : ${name}`}
      title="Actions"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onMenu(r.right, r.bottom + 2);
      }}
      data-testid="row-menu"
    >
      <MoreHorizontal {...SMALL} />
    </button>
  );
  const grip = (
    <span className={s.grip} onPointerDown={onGrip} aria-hidden="true" data-edit>
      <GripVertical {...SMALL} />
    </span>
  );
  const label = renaming ? (
    <NameInput initial={name} onDone={onRename} onCancel={onCancelRename} />
  ) : (
    <span className={s.name} onDoubleClick={onStartRename} title={name}>
      {name}
    </span>
  );

  if (isPhase) {
    const sp = phaseSpan(row.phase);
    return (
      <div className={cls} role="row" onPointerEnter={onHover} data-row={id} data-testid="phase-row">
        <span className={s.cName} role="cell">
          {grip}
          <button type="button" className={s.chevron} aria-label={collapsed ? `Déplier ${name}` : `Replier ${name}`} aria-expanded={!collapsed} onClick={onToggle} data-view>
            {collapsed ? <ChevronRight {...SMALL} /> : <ChevronDown {...SMALL} />}
          </button>
          {label}
        </span>
        <span className={s.cDate} role="cell">
          {formatFrDate(sp?.start)}
        </span>
        <span className={s.cDate} role="cell">
          {formatFrDate(sp?.end)}
        </span>
        <span className={s.cDur} role="cell">
          {phaseDays(row.phase) || ''}
        </span>
        <span className={s.cMenu}>{!readOnly && menuBtn}</span>
      </div>
    );
  }

  const t = row.task;
  const pinned = isPinned(doc, t);
  const locked = readOnly || pinned;
  // Plan de travail daté en partie : le début le suit, la fin reste réglable.
  const startLocked = locked || isHeld(doc, t);
  const range = t.linked ? shootingRange(doc) : undefined;
  const linkTip = range && range.dated < range.total ? `Suit le plan de travail (${range.dated} ${range.dated > 1 ? 'jours' : 'jour'} sur ${range.total} datés)` : 'Suit le plan de travail';
  return (
    <div className={[cls, t.done ? s.isDone : ''].join(' ')} role="row" onPointerEnter={onHover} data-row={id} data-testid="task-row">
      <span className={s.cName} role="cell">
        {grip}
        <label className={s.check} title={t.done ? 'Fait' : 'À faire'}>
          <input type="checkbox" checked={!!t.done} disabled={readOnly} aria-label={`Fait : ${t.name}`} onChange={(e) => mutateDoc((d) => setDone(d.production!, t.id, e.target.checked))} />
          <span className={s.box} aria-hidden="true">
            {t.done && <Check size={11} strokeWidth={2} />}
          </span>
        </label>
        {t.milestone && <span className={s.diamond} aria-label="Jalon" />}
        {label}
        {t.linked && (
          <span className={s.linked} title={linkTip} aria-label={linkTip} data-testid="linked-mark">
            <Link2 {...SMALL} />
          </span>
        )}
      </span>
      <span className={s.cDate} role="cell">
        <DateField value={t.start} locked={startLocked} label={t.milestone ? `Date : ${t.name}` : `Début : ${t.name}`} onCommit={(v) => mutateDoc((d) => setTaskDates(d, t.id, v, t.milestone ? v : addDays(v, daysBetween(t.start, t.end))))} />
      </span>
      <span className={s.cDate} role="cell">
        {!t.milestone && <DateField value={t.end} locked={locked} label={`Fin : ${t.name}`} onCommit={(v) => mutateDoc((d) => setTaskDates(d, t.id, t.start, v))} />}
      </span>
      <span className={s.cDur} role="cell">
        {t.milestone ? '' : <NumberField value={durationDays(t)} locked={locked} label={`Durée en jours : ${t.name}`} onCommit={(n) => mutateDoc((d) => setDuration(d, t.id, n))} />}
      </span>
      <span className={s.cMenu}>{!readOnly && menuBtn}</span>
    </div>
  );
}

function NameInput({ initial, onDone, onCancel }: { initial: string; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok && v.trim() && v.trim() !== initial) onDone(v);
    else onCancel();
  };
  return (
    <input
      className={s.nameInput}
      value={v}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      aria-label="Nom"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      data-testid="name-input"
    />
  );
}

/** Champ de date au clavier (jj/mm/aaaa) : validé à Entrée ou en sortant, Échap rétablit. */
function DateField({ value, locked, label, onCommit }: { value: string; locked: boolean; label: string; onCommit: (iso: string) => void }) {
  const shown = formatFrDate(value);
  const [draft, setDraft] = useState<string | null>(null);
  if (locked) return <span className={s.dateText}>{shown}</span>;
  const commit = () => {
    if (draft === null) return;
    const iso = parseFrDate(draft, value);
    setDraft(null);
    if (iso && iso !== value) onCommit(iso);
  };
  return (
    <input
      className={s.cellInput}
      value={draft ?? shown}
      inputMode="numeric"
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function NumberField({ value, locked, label, onCommit }: { value: number; locked: boolean; label: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (locked) return <span className={s.dateText}>{value}</span>;
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(',', '.'));
    setDraft(null);
    if (Number.isFinite(n) && n >= 1 && Math.round(n) !== value) onCommit(n);
  };
  return (
    <input
      className={[s.cellInput, s.num].join(' ')}
      value={draft ?? String(value)}
      inputMode="numeric"
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

// --- Menu « … » d'une ligne ------------------------------------------------------------------------

interface MenuProps {
  menu: Menu;
  doc: ProjectDoc;
  onClose: () => void;
  onDeps: () => void;
  onAdd: (milestone: boolean) => void;
  onAddPhase: () => void;
  onRemove: () => void;
}

function RowMenu({ menu, doc, onClose, onDeps, onAdd, onAddPhase, onRemove }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(menu.x - r.width, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) });
  }, [menu.x, menu.y, menu.deps]);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose, menu.deps]);
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const row = menu.row;
  const plan = doc.production!;
  let body;
  if (menu.deps && row.type === 'task') {
    const t = findTask(plan, row.task.id)?.task ?? row.task;
    const candidates = dependencyCandidates(plan, t.id);
    body = (
      <>
        <p className={s.menuHead}>Dépend de</p>
        <div className={s.menuScroll}>
          {plan.phases.map((ph) => {
            const list = candidates.filter((c) => c.phase.id === ph.id);
            if (!list.length) return null;
            return (
              <div key={ph.id}>
                <p className={s.menuGroup}>{ph.name}</p>
                {list.map(({ task: c }) => {
                  const on = !!t.after?.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => mutateDoc((d) => (on ? removeDependency(d.production!, t.id, c.id) : void addDependency(d, t.id, c.id)))}
                      data-testid="dep-option"
                    >
                      <span className={s.tick}>{on && <Check size={13} strokeWidth={1.5} />}</span>
                      {c.milestone && <span className={s.diamondSmall} aria-hidden="true" />}
                      <span className={s.menuLabel}>{c.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <button type="button" role="menuitem" onClick={act(() => onAdd(false))}>
          Ajouter une étape
        </button>
        <button type="button" role="menuitem" onClick={act(() => onAdd(true))}>
          Ajouter un jalon
        </button>
        {row.type === 'phase' && (
          <button type="button" role="menuitem" onClick={act(onAddPhase)}>
            Ajouter une phase
          </button>
        )}
        {row.type === 'task' && (
          <>
            <hr />
            <button type="button" role="menuitem" onClick={onDeps} data-testid="menu-deps">
              Dépendre de…
            </button>
            {!row.task.milestone && (
              <button type="button" role="menuitem" onClick={act(() => mutateDoc((d) => setLinked(d, row.task.id, !row.task.linked)))} data-testid="menu-link">
                {row.task.linked ? 'Délier du plan de travail' : 'Lier le plan de travail'}
              </button>
            )}
          </>
        )}
        <hr />
        <button type="button" role="menuitem" onClick={act(onRemove)} data-testid="menu-remove">
          {row.type === 'phase' ? 'Supprimer la phase' : 'Supprimer'}
        </button>
      </>
    );
  }
  return createPortal(
    <div ref={ref} className={s.menu} role="menu" style={pos} onMouseDown={(e) => e.stopPropagation()} data-testid="production-menu">
      {body}
    </div>,
    document.body,
  );
}
