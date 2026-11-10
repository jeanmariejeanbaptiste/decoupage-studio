import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { CalendarArrowDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { navigate, useLocation } from '../../app/router';
import {
  addEvent,
  busyDates,
  calendarIcs,
  calendarItems,
  eventFields,
  eventFromFields,
  hourRange,
  isValidDate,
  isWeekend,
  itemsOn,
  layoutDay,
  monthGrid,
  newEventFields,
  periodTitle,
  removeEvent,
  sameMonth,
  shiftAnchor,
  todayIso,
  updateEvent,
  weekDays,
  weekday,
  yearMonths,
  type CalendarItem,
  type CalendarView,
  type EventFields,
} from '../../domain/calendar';
import { exportBase } from '../../domain/serialize';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { downloadBlob } from '../../store/persistence';
import { useReadOnly } from '../../store/share';
import { Button } from '../../ui/Button';
import { ProductionPage } from '../production/ProductionPage';
import { EventDialog } from './EventDialog';
import s from './CalendarPage.module.css';

/** Vues de la page : les quatre échelles de l'agenda, puis la frise du calendrier de production. */
type PageView = CalendarView | 'production';
const VIEWS: ReadonlyArray<{ view: PageView; label: string }> = [
  { view: 'day', label: 'Jour' },
  { view: 'week', label: 'Semaine' },
  { view: 'month', label: 'Mois' },
  { view: 'year', label: 'Année' },
  { view: 'production', label: 'Production' },
];
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const VIEW_KEY = 'ds-calendar-view';
const HOUR = 44;
const ICON = { size: 16, strokeWidth: 1.25 } as const;

const shortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const utc = (date: string) => new Date(`${date}T00:00Z`);
const dayNum = (date: string) => Number(date.slice(8, 10));

function storedView(): PageView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some((x) => x.view === v)) return v as PageView;
  } catch {
    /* stockage indisponible */
  }
  return 'month';
}

/** Heure courante, rafraîchie chaque minute (ligne « maintenant », jour courant). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

interface Editing {
  id?: ID;
  fields: EventFields;
}

/**
 * Calendrier du projet, une seule page : rendez-vous saisis, jours de tournage datés du plan de
 * travail et étapes du calendrier de production (Jour, Semaine, Mois, Année), ou la frise de
 * production elle-même (vue « Production », adresse `#/production`).
 */
export function CalendarPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const now = useNow();
  const today = todayIso(now);
  // Venu d'une autre page (« ?date=AAAA-MM-JJ ») : ce jour-là, en vue Jour, ou dans la vue demandée
  // (« &view=month »), sans changer la vue retenue. « #/production » ouvre la frise.
  const { route, params } = useLocation();
  const focus = params.get('date') ?? undefined;
  const asked = params.get('view');
  const toProduction = route === 'production' || asked === 'production';
  const focusView: CalendarView = VIEWS.some((x) => x.view === asked && x.view !== 'production') ? (asked as CalendarView) : 'day';
  const [view, setViewState] = useState<PageView>(() => (toProduction ? 'production' : isValidDate(focus) ? focusView : storedView()));
  const [anchor, setAnchor] = useState(() => (isValidDate(focus) ? focus : today));
  useEffect(() => {
    if (toProduction) return setViewState('production');
    if (!isValidDate(focus)) return;
    setAnchor(focus);
    setViewState(focusView);
  }, [focus, focusView, toProduction]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const items = useMemo(() => calendarItems(doc), [doc]);

  const setView = (v: PageView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* stockage indisponible */
    }
    // Une seule page : l'adresse suit la vue (« #/production » pour la frise), sans recharger.
    const target = v === 'production' ? 'production' : 'calendar';
    if (route !== target || params.toString()) navigate(target);
  };
  const openDay = (date: string) => {
    setAnchor(date);
    setView('day');
  };
  const create = (date: string, hour?: number, allDay = false) => {
    if (!readOnly) setEditing({ fields: newEventFields(date, hour, allDay) });
  };
  const open = (it: CalendarItem) => {
    if (it.source === 'shooting') return navigate('schedule', { day: String(it.day) });
    // Étapes du calendrier de production : lecture seule ici, modifiables là-bas.
    if (it.source === 'production') return navigate('production', { task: it.taskId! });
    const e = doc.calendar?.find((x) => x.id === it.eventId);
    // Lecture seule : la fenêtre s'ouvre quand même, pour lire l'horaire et la note.
    if (e) setEditing({ id: e.id, fields: eventFields(e) });
  };
  const save = (f: EventFields) => {
    if (readOnly) return setEditing(null);
    const ev = eventFromFields(f);
    const id = editing?.id;
    mutateDoc((d) => (id ? updateEvent(d, id, ev) : void addEvent(d, ev)));
    setEditing(null);
  };
  const exportIcs = () => {
    const name = doc.project.title || 'Projet';
    downloadBlob(new Blob([calendarIcs(items, name)], { type: 'text/calendar;charset=utf-8' }), `${exportBase(doc)}-calendrier.ics`);
  };

  const seg = (
    <div className={s.seg} role="tablist" aria-label="Vue" data-view>
      {VIEWS.map((v) => (
        <button key={v.view} type="button" role="tab" aria-selected={view === v.view} className={view === v.view ? s.on : ''} onClick={() => setView(v.view)} data-testid={`calendar-view-${v.view}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
  if (view === 'production') return <ProductionPage doc={doc} seg={seg} />;

  const title = periodTitle(anchor, view);
  const props: ViewProps = { anchor, today, now, items, onCreate: create, onOpen: open, onDay: openDay };

  return (
    <div className={s.page} data-testid="calendar">
      {/* Une barre pour toutes les vues : la vue à gauche (fixe), le temps ensuite, les actions à droite. */}
      <header className={s.bar}>
        {seg}
        <div className={s.nav} data-view>
          <Button variant="outline" size="sm" className={s.todayBtn} onClick={() => setAnchor(today)}>
            Aujourd’hui
          </Button>
          <Button variant="icon" size="sm" aria-label="Précédent" title="Précédent" icon={<ChevronLeft {...ICON} />} onClick={() => setAnchor(shiftAnchor(anchor, view, -1))} />
          <Button variant="icon" size="sm" aria-label="Suivant" title="Suivant" icon={<ChevronRight {...ICON} />} onClick={() => setAnchor(shiftAnchor(anchor, view, 1))} />
          <h1 className={s.title} data-testid="calendar-title">
            <strong>{title.main}</strong> {title.sub}
          </h1>
        </div>
        <div className={s.barEnd} data-view>
          <Button variant="icon" aria-label="Nouvel événement" title="Nouvel événement" icon={<Plus {...ICON} />} onClick={() => create(view === 'year' || view === 'month' ? (sameMonth(anchor, today) ? today : anchor) : anchor)} data-edit data-testid="event-add" />
          <Button variant="icon" aria-label="Exporter le calendrier (.ics)" title="Exporter le calendrier (.ics)" icon={<CalendarArrowDown {...ICON} />} disabled={!items.length} onClick={exportIcs} data-export data-testid="calendar-ics" />
        </div>
      </header>
      {/* Vues marquées data-view : en lecture seule, on y lit et on ouvre les éléments. */}
      {view === 'month' && <MonthView {...props} />}
      {view === 'week' && <TimeGrid {...props} dates={weekDays(anchor)} />}
      {view === 'day' && <TimeGrid {...props} dates={[anchor]} />}
      {view === 'year' && <YearView {...props} onMonth={(m) => (setAnchor(m), setView('month'))} />}
      {editing && (
        <EventDialog
          initial={editing.fields}
          existing={!!editing.id}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={() => {
            const id = editing.id!;
            mutateDoc((d) => removeEvent(d, id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

interface ViewProps {
  anchor: string;
  today: string;
  now: Date;
  items: CalendarItem[];
  onCreate: (date: string, hour?: number, allDay?: boolean) => void;
  onOpen: (it: CalendarItem) => void;
  onDay: (date: string) => void;
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

/** Élément compact : journée entière en pastille, rendez-vous en ligne « titre … 14:00 ». */
function Chip({ it, onOpen, date }: { it: CalendarItem; onOpen: (it: CalendarItem) => void; date?: string }) {
  // Étape de production ou rendez-vous sur plusieurs jours : nommé le premier jour et chaque lundi,
  // bords ouverts du côté de la suite.
  const span = !!date && it.allDay && ((it.source === 'production' && !it.milestone) || (it.source === 'project' && it.endDate > it.date));
  const cont = span && date !== it.date && weekday(date) !== 0;
  const goes = span && date !== it.endDate && weekday(date) !== 6;
  const label = it.allDay ? it.title : `${it.title}, ${it.start}`;
  return (
    <button
      type="button"
      className={[it.allDay ? s.pill : s.line, it.source === 'shooting' ? s.shoot : '', it.source === 'production' ? s.prod : '', it.milestone ? s.milestone : '', cont ? s.contL : '', goes ? s.contR : ''].join(' ')}
      aria-label={cont ? it.title : undefined}
      data-kind={it.kind}
      title={[it.allDay && it.start ? `${it.title} · RDV ${it.start}` : label, it.group, it.note].filter(Boolean).join('\n')}
      onClick={stop(() => onOpen(it))}
      data-testid="calendar-item"
    >
      <span className={s.chipTitle}>{cont ? '' : it.title}</span>
      {it.start && <span className={s.chipTime}>{it.start}</span>}
    </button>
  );
}

/** Hauteur d'un élément, suivie au redimensionnement. */
function useHeight<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}

function MonthView({ anchor, today, items, onCreate, onOpen, onDay }: ViewProps) {
  const weeks = monthGrid(anchor);
  const [ref, height] = useHeight<HTMLDivElement>();
  // Lignes visibles par case : le reste se résume en « n de plus » (ouvre la journée).
  const lines = Math.max(1, Math.floor((height / weeks.length - 30) / 20));
  return (
    <div className={s.month} data-view data-testid="calendar-month">
      <div className={s.weekdays}>
        {WEEKDAYS.map((d, i) => (
          <span key={d} className={i >= 5 ? s.weekend : ''}>
            {d}
          </span>
        ))}
      </div>
      <div ref={ref} className={s.monthBody} style={{ '--rows': weeks.length } as CSSProperties}>
        {weeks.flatMap((w) =>
          w.days.map((date) => {
            const list = itemsOn(items, date);
            const shown = list.length > lines ? list.slice(0, lines - 1) : list;
            const out = sameMonth(date, anchor);
            return (
              <div
                key={date}
                className={[s.cell, isWeekend(date) ? s.weekendCell : '', out ? '' : s.outside].join(' ')}
                onClick={() => onCreate(date)}
                data-date={date}
                data-testid={`day-${date}`}
              >
                <button type="button" className={[s.num, date === today ? s.today : ''].join(' ')} aria-label={longDay.format(utc(date))} onClick={stop(() => onDay(date))}>
                  {dayNum(date) === 1 && date !== today ? `1 ${shortMonth.format(utc(date))}` : dayNum(date)}
                </button>
                <div className={s.chips}>
                  {shown.map((it) => (
                    <Chip key={it.key} it={it} onOpen={onOpen} date={date} />
                  ))}
                  {shown.length < list.length && (
                    <button type="button" className={s.more} onClick={stop(() => onDay(date))}>
                      {list.length - shown.length} de plus
                    </button>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

function TimeGrid({ dates, today, now, items, onCreate, onOpen, onDay }: ViewProps & { dates: string[] }) {
  const range = hourRange(items, dates);
  const hours = Array.from({ length: range.to - range.from }, (_, i) => range.from + i);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const scroller = useRef<HTMLDivElement>(null);
  const cols = { '--cols': dates.length } as CSSProperties;
  // La journée s'ouvre à 7 h, même quand la grille commence plus tôt.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (7 - range.from) * HOUR);
  }, [range.from]);
  // Barre de défilement de la grille horaire (toujours visible sur certains systèmes) : l'en-tête et la
  // rangée « journée » lui réservent la même largeur, sinon leurs colonnes ne tombent plus en face.
  const [bar, setBar] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBar(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const single = dates.length === 1;
  return (
    <div className={s.timeGrid} style={{ '--sb': `${bar}px` } as CSSProperties} data-view data-testid={single ? 'calendar-day' : 'calendar-week'}>
      {/* Vue Jour : la date est déjà le titre de la page. */}
      {!single && (
        <div className={s.tgHead} style={cols}>
          <span />
          {dates.map((date) => (
            <button key={date} type="button" className={[s.colHead, isWeekend(date) ? s.weekend : ''].join(' ')} onClick={() => onDay(date)} aria-label={longDay.format(utc(date))}>
              <span className={s.colDay}>{WEEKDAYS[weekday(date)]}</span>
              <span className={s.colInitial} aria-hidden="true">
                {INITIALS[weekday(date)]}
              </span>{' '}
              <b className={date === today ? s.today : ''}>{dayNum(date)}</b>
            </button>
          ))}
        </div>
      )}
      <div className={s.allDay} style={cols}>
        <span className={s.gutterLabel}>journée</span>
        {dates.map((date) => (
          <div key={date} className={[s.allDayCell, isWeekend(date) ? s.weekendCell : ''].join(' ')} onClick={() => onCreate(date, undefined, true)}>
            {itemsOn(items, date)
              .filter((it) => it.allDay)
              .map((it) => (
                <Chip key={it.key} it={it} onOpen={onOpen} date={date} />
              ))}
          </div>
        ))}
      </div>
      <div ref={scroller} className={s.tgScroll}>
        <div className={s.tgBody} style={{ ...cols, height: hours.length * HOUR } as CSSProperties}>
          <div className={s.hours}>
            {hours.map((h, i) => (
              <span key={h} style={{ top: i * HOUR }}>
                {`${String(h).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {dates.map((date) => (
            <div
              key={date}
              className={[s.col, isWeekend(date) ? s.weekendCell : ''].join(' ')}
              style={{ backgroundSize: `100% ${HOUR}px` }}
              onClick={(e) => onCreate(date, range.from + Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / HOUR))}
            >
              {layoutDay(items, date, range.from, range.to).map((p) => (
                <button
                  key={p.item.key}
                  type="button"
                  className={[s.block, p.height < 40 ? s.blockShort : ''].join(' ')}
                  data-kind={p.item.kind}
                  style={{
                    top: (p.top / 60) * HOUR + 1,
                    height: Math.max(16, (p.height / 60) * HOUR - 2),
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${100 / p.cols}% - 4px)`,
                  }}
                  title={[`${p.item.title}, ${p.item.start} – ${p.item.end}`, p.item.note].filter(Boolean).join('\n')}
                  onClick={stop(() => onOpen(p.item))}
                  data-testid="calendar-item"
                >
                  <span className={s.chipTitle}>{p.item.title}</span>
                  <span className={s.chipTime}>{p.item.start}</span>
                </button>
              ))}
              {date === today && nowMin >= range.from * 60 && nowMin <= range.to * 60 && <span className={s.nowLine} style={{ top: ((nowMin - range.from * 60) / 60) * HOUR }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function YearView({ anchor, today, items, onDay, onMonth }: ViewProps & { onMonth: (date: string) => void }) {
  const year = anchor.slice(0, 4);
  // Les étapes de production durent des semaines : seuls leurs jalons marquent un jour.
  const busy = useMemo(() => busyDates(items.filter((it) => it.source !== 'production' || it.milestone), `${year}-01-01`, `${year}-12-31`), [items, year]);
  // Jours de tournage : marqués à part, c'est ce qu'on cherche d'abord sur l'année.
  const shoot = useMemo(() => busyDates(items.filter((it) => it.source === 'shooting'), `${year}-01-01`, `${year}-12-31`), [items, year]);
  return (
    <div className={s.year} data-view data-testid="calendar-year">
      {yearMonths(anchor).map((m) => (
        <section key={m} className={s.mini}>
          <button type="button" className={s.miniTitle} onClick={() => onMonth(m)}>
            {periodTitle(m, 'month').main}
          </button>
          <div className={s.miniGrid}>
            {INITIALS.map((d, i) => (
              <span key={i} className={[s.miniHead, i >= 5 ? s.weekend : ''].join(' ')}>
                {d}
              </span>
            ))}
            {monthGrid(m).flatMap((w) =>
              w.days.map((date) =>
                sameMonth(date, m) ? (
                  <button
                    key={date}
                    type="button"
                    className={[s.miniDay, isWeekend(date) ? s.weekend : '', date === today ? s.today : '', shoot.has(date) ? s.shootDay : busy.has(date) ? s.busy : ''].join(' ')}
                    aria-label={[longDay.format(utc(date)), shoot.has(date) ? 'jour de tournage' : busy.has(date) ? 'occupé' : ''].filter(Boolean).join(', ')}
                    onClick={() => onDay(date)}
                    data-testid={`year-${date}`}
                  >
                    {dayNum(date)}
                  </button>
                ) : (
                  <span key={date} />
                ),
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
