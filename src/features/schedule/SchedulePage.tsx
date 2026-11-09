import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { ArrowDown, ArrowUp, CalendarDays, CalendarRange, ChevronDown, ChevronRight, Clock, Map as MapIcon, Plus, Trash2, X } from 'lucide-react';
import { DayTimeline } from './DayTimeline';
import { sequenceCharacterIds } from '../../domain/characters';
import { sequenceNumber, shotCode } from '../../domain/numbering';
import { addBanner, BANNER_KINDS, bannerLabel, clockTime, dayAgenda, showTime, moveBanner, removeBanner, setStripMinutes, estimatedStripMinutes, updateBanner, type AgendaItem, type BannerKind, stripsByTime, addDay, assignShots, dayStats, dayTotalsText, longDate, removeDay, scheduleDays, stripsByDay, stripTone, suggestSchedule, updateDay, type Strip, type StripTone, stripCharacterIds } from '../../domain/schedule';
import { computeTiming } from '../../domain/timing';
import type { ID, ProjectDoc } from '../../domain/types';
import { characterNumbers, numberedCast } from '../../domain/registry';
import { mutateDoc } from '../../store/projectStore';
import { navigate, useLocation } from '../../app/router';
import { eventsOn, timeOn } from '../../domain/calendar';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { ask } from '../../ui/dialogStore';
import s from './SchedulePage.module.css';
import { TabExport } from '../export/TabExport';
import { scheduleCsv } from '../../domain/exports';
import { scheduleDocument } from '../../domain/documents';
import { exportBase } from '../../domain/serialize';
import { mapPlaces } from '../../domain/geo';
import { ScheduleMap } from '../map/PlacesMap';
import { useMapVisible } from '../map/visibility';

const TONE: Record<StripTone, string> = {
  'int-day': s.tIntDay,
  'ext-day': s.tExtDay,
  'int-night': s.tIntNight,
  'ext-night': s.tExtNight,
  'int-twilight': s.tIntTwilight,
  'ext-twilight': s.tExtTwilight,
};

/** Plan de travail (§15.3) : bandes par jour de tournage. */
export function SchedulePage({ doc }: { doc: ProjectDoc }) {
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const strips = useMemo(() => stripsByDay(doc), [doc]);
  const nums = useMemo(() => characterNumbers(doc), [doc]);
  const days = scheduleDays(doc);
  const places = useMemo(() => mapPlaces(doc), [doc]);
  const [mapOn, toggleMap] = useMapVisible();
  const showMap = mapOn && places.length > 0;
  const [capacity, setCapacity] = useState(20);
  const [openDays, setOpenDays] = useState<number[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  // Venu du calendrier (« ?day=n ») : la journée demandée s'affiche en haut.
  const focusDay = useLocation().params.get('day');
  useEffect(() => {
    if (focusDay) document.querySelector(`[data-testid="band-${CSS.escape(focusDay)}"]`)?.scrollIntoView({ block: 'start' });
  }, [focusDay]);

  const onDragEnd = (e: DragEndEvent) => {
    const from = String(e.active.id).split(':');
    const to = e.over ? String(e.over.id).split(':') : null;
    if (from[0] !== 'strip' || !to || to[0] !== 'day') return;
    const fromDay = Number(from[1]);
    const toDay = Number(to[1]);
    if (fromDay === toDay) return;
    const strip = strips.get(fromDay)?.find((x) => x.seqId === from[2]);
    if (strip) mutateDoc((d) => assignShots(d, strip.shotIds, toDay || undefined));
  };

  const suggest = async () => {
    if (days.length) {
      const r = await ask({ title: 'Remplacer le plan de travail ?', body: 'Tous les plans seront réaffectés : regroupement par décor, puis par comédiens, puis par axes.', confirmLabel: 'Répartir' });
      if (!r.ok) return;
    }
    // Sans toast : la confirmation précède, l'annulation générale défait la répartition.
    mutateDoc((d) => void suggestSchedule(d, capacity));
  };

  const total = [...strips.values()].flat().reduce((n, x) => n + x.shotIds.length, 0);
  const planned = total - (strips.get(0) ?? []).reduce((n, x) => n + x.shotIds.length, 0);

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div className={s.toolbar}>
          <TabExport id="schedule" orientation="portrait" doc={() => scheduleDocument(doc)} fileBase={`${exportBase(doc)}-plan-de-travail`} file={{ label: 'CSV', name: `${exportBase(doc)}-plan-de-travail.csv`, content: () => scheduleCsv(doc) }} />
          <label className={s.cap} data-edit>
            <span>plans / jour</span>
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))} aria-label="Plans par jour au maximum" />
          </label>
          <Button variant="outline" icon={<CalendarRange size={15} strokeWidth={1.25} />} onClick={suggest} title="Répartir les plans sur les jours : par décor, puis par comédiens, puis par axes" data-testid="suggest-schedule">
            Répartir
          </Button>
          <Button variant="primary" icon={<Plus size={15} strokeWidth={1.5} />} onClick={() => mutateDoc((d) => addDay(d))} data-testid="add-day">
            Ajouter un jour
          </Button>
          {places.length > 0 && (
            <Button variant={showMap ? 'primary' : 'outline'} icon={<MapIcon size={15} strokeWidth={1.25} />} aria-pressed={showMap} onClick={toggleMap} data-view data-testid="map-toggle">
              Carte
            </Button>
          )}
        </div>
      </header>
      <p className={s.summary}>
        <Hand>
          {planned} plan{planned > 1 ? 's' : ''} planifié{planned > 1 ? 's' : ''} sur {total}
        </Hand>
      </p>

      <div className={s.layout}>
      <div className={[s.columns, showMap ? s.withMap : ''].join(' ')}>
      {showMap && (
        <aside className={s.mapSide}>
          <ScheduleMap doc={doc} places={places} days={days.map((d) => d.n)} />
        </aside>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className={s.bands}>
          {days.map((d) => {
            const st = dayStats(doc, timing, d.n);
            return (
              <Band key={d.n} day={d.n} doc={doc} strips={stripsByTime(doc, d.n)} items={dayAgenda(doc, d.n)} days={days.map((x) => x.n)} nums={nums} extra={openDays.includes(d.n) ? <DayTimeline doc={doc} day={d.n} /> : null}>
                <div className={s.dayHead}>
                  <strong>
                    Jour {d.n} <span className={s.of}>sur {days.length}</span>
                  </strong>
                  {/* La date longue est le libellé du sélecteur de date : une seule mention à l'écran. */}
                  <label className={[s.date, d.date ? '' : s.dateEmpty].join(' ')}>
                    {longDate(d.date) || 'Date'}
                    <input
                      type="date"
                      value={d.date ?? ''}
                      onClick={(e) => e.currentTarget.showPicker?.()}
                      onChange={(e) => mutateDoc((x) => updateDay(x, d.n, { date: e.target.value || undefined }))}
                      aria-label={`Date du jour ${d.n}`}
                    />
                  </label>
                  <label className={s.rdv}>
                    RDV
                    <input type="time" value={d.callTime ?? ''} onChange={(e) => mutateDoc((x) => updateDay(x, d.n, { callTime: e.target.value || undefined }))} aria-label={`Rendez-vous du jour ${d.n}`} />
                  </label>
                  <span className={s.stats} data-testid={`day-stats-${d.n}`}>
                    {dayTotalsText(doc, st)}
                  </span>
                  <select
                    className={s.addBanner}
                    value=""
                    aria-label={`Ajouter un bandeau au jour ${d.n}`}
                    onChange={(e) => e.target.value && mutateDoc((x) => void addBanner(x, d.n, e.target.value as BannerKind))}
                    data-testid={`add-banner-${d.n}`}
                  >
                    <option value="" hidden>
                      + Bandeau
                    </option>
                    {BANNER_KINDS.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant={openDays.includes(d.n) ? 'primary' : 'outline'}
                    icon={<Clock size={13} strokeWidth={1.5} />}
                    aria-expanded={openDays.includes(d.n)}
                    onClick={() => setOpenDays(openDays.includes(d.n) ? openDays.filter((x) => x !== d.n) : [...openDays, d.n])}
                    data-testid={`timeline-toggle-${d.n}`}
                  >
                    Emploi du temps
                  </Button>
                  <Button
                    variant="icon"
                    size="sm"
                    aria-label={`Supprimer le jour ${d.n}`}
                    icon={<Trash2 size={13} strokeWidth={1.25} />}
                    onClick={() => mutateDoc((x) => removeDay(x, d.n))}
                  />
                  <DayEvents doc={doc} date={d.date} />
                </div>
              </Band>
            );
          })}
          <Band day={0} doc={doc} strips={strips.get(0) ?? []} days={days.map((x) => x.n)} nums={nums}>
            <p className={s.unplannedHead}>
              Non planifié · {(strips.get(0) ?? []).reduce((n, x) => n + x.shotIds.length, 0)} plans
              <span> — piochez-les plutôt depuis l’emploi du temps d’un jour</span>
            </p>
          </Band>
        </div>
      </DndContext>
      </div>
      </div>
    </div>
  );
}

/** Rendez-vous du calendrier ce jour-là : une ligne discrète, un clic ouvre le jour dans le calendrier. */
function DayEvents({ doc, date }: { doc: ProjectDoc; date?: string }) {
  const items = eventsOn(doc, date);
  if (!date || !items.length) return null;
  const open = () => navigate('calendar', { date });
  return (
    <p className={s.events} data-view data-testid="day-events">
      <CalendarDays size={13} strokeWidth={1.25} aria-hidden />
      {items.map((it) => {
        const time = timeOn(it, date);
        return (
          <button key={it.key} type="button" className={s.event} onClick={open} title="Ouvrir ce jour dans le calendrier" data-testid="day-event">
            {time && <span className={s.eventTime}>{time}</span>}
            {it.title}
          </button>
        );
      })}
    </p>
  );
}

function Band({ day, doc, strips, items, days, nums, children, extra }: { day: number; doc: ProjectDoc; strips: Strip[]; items?: AgendaItem[]; days: number[]; nums: Map<ID, number>; children: React.ReactNode; extra?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  // Jour de tournage : bandes et bandeaux dans l'ordre du déroulé ; réserve : bandes seules.
  const list: AgendaItem[] = items ?? strips.map((strip) => ({ type: 'strip', strip, computed: false }));
  return (
    <section ref={setNodeRef} className={[s.band, day === 0 ? s.unplanned : '', isOver ? s.over : ''].join(' ')} data-testid={`band-${day}`}>
      {children}
      <div className={s.strips}>
        {strips.length === 0 && <p className={s.empty}>{day === 0 ? 'Tout est planifié.' : 'Déposez ici des séquences.'}</p>}
        {list.map((it, i) =>
          it.type === 'strip' ? (
            <StripRow key={it.strip.seqId} doc={doc} day={day} item={it} days={days} nums={nums} />
          ) : (
            <BannerRow key={it.banner.id} day={day} item={it} first={i === 0} last={i === list.length - 1} />
          ),
        )}
      </div>
      {extra}
    </section>
  );
}

function BannerRow({ day, item, first, last }: { day: number; item: Extract<AgendaItem, { type: 'banner' }>; first: boolean; last: boolean }) {
  const b = item.banner;
  const set = (patch: Parameters<typeof updateBanner>[3]) => mutateDoc((d) => updateBanner(d, day, b.id, patch));
  const name = bannerLabel(b);
  return (
    <div className={s.banner} data-testid="banner">
      {/* Horaire : déduit du déroulé (gris) tant qu'aucun début n'est imposé. */}
      <input
        type="time"
        className={[s.bannerTime, item.computed ? s.computed : ''].join(' ')}
        value={clockTime(b.start ?? item.start)}
        onChange={(e) => set({ start: e.target.value || undefined })}
        aria-label={`Début : ${name}`}
      />
      <span className={s.bannerEnd}>{item.end ? `– ${showTime(item.end)}` : ''}</span>
      <span className={s.bannerKind}>{name}</span>
      <input className={s.bannerLabel} value={b.label ?? ''} placeholder="Précision" onChange={(e) => set({ label: e.target.value })} aria-label={`Précision : ${name}`} />
      <label className={s.bannerMin}>
        <input type="number" min={0} step={5} value={b.minutes} onChange={(e) => set({ minutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })} aria-label={`Durée : ${name}`} />
        min
      </label>
      <span className={s.bannerTools}>
        <Button variant="icon" size="sm" aria-label="Avancer" disabled={first} icon={<ArrowUp size={13} strokeWidth={1.25} />} onClick={() => mutateDoc((d) => moveBanner(d, day, b.id, -1))} />
        <Button variant="icon" size="sm" aria-label="Reculer" disabled={last} icon={<ArrowDown size={13} strokeWidth={1.25} />} onClick={() => mutateDoc((d) => moveBanner(d, day, b.id, 1))} />
        <Button variant="icon" size="sm" aria-label={`Supprimer : ${name}`} icon={<X size={13} strokeWidth={1.25} />} onClick={() => mutateDoc((d) => removeBanner(d, day, b.id))} />
      </span>
    </div>
  );
}

function StripRow({ doc, day, item, days, nums }: { doc: ProjectDoc; day: number; item: Extract<AgendaItem, { type: 'strip' }>; days: number[]; nums: Map<ID, number> }) {
  const strip = item.strip;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `strip:${day}:${strip.seqId}` });
  const [open, setOpen] = useState(false);
  const seq = doc.sequences[strip.seqId];
  const decor = seq?.decorId ? doc.decors[seq.decorId] : undefined;
  // Distribution du jour : les personnages des plans de cette bande (pas toute la séquence).
  const cast = numberedCast(doc, day > 0 ? stripCharacterIds(doc, strip) : sequenceCharacterIds(doc, strip.seqId), nums);
  const totalInSeq = seq?.shotIds.length ?? 0;
  const planned = doc.schedule?.days.find((x) => x.n === day)?.durations?.[strip.seqId];
  return (
    <div
      ref={setNodeRef}
      className={[s.strip, TONE[stripTone(seq)], isDragging ? s.dragging : ''].join(' ')}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined}
      data-testid="strip"
    >
      <div className={s.stripMain} {...listeners} {...attributes} aria-label={`Séquence ${sequenceNumber(doc, strip.seqId)}, glisser vers un autre jour`}>
        <span className={s.num}>{sequenceNumber(doc, strip.seqId)}</span>
        <span className={s.ie}>{[seq?.intExt, seq?.effect].filter(Boolean).join(' · ')}</span>
        <span className={s.label}>{seq?.label.toUpperCase()}</span>
        <span className={s.decor}>{decor && decor.name.toUpperCase() !== seq?.label.toUpperCase() ? decor.name : ''}</span>
        <span className={s.cast}>{cast}</span>
        <span className={[s.when, item.computed ? s.computed : ''].join(' ')}>{item.start ? `${showTime(item.start)}–${showTime(item.end)}` : ''}</span>
        <span className={s.count}>
          {strip.shotIds.length}
          {strip.shotIds.length !== totalInSeq ? ` / ${totalInSeq}` : ''} pl.
        </span>
      </div>
      <button type="button" className={s.toggle} aria-expanded={open} aria-label="Détail des plans" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && day > 0 && (
        <label className={s.planned}>
          Durée prévue
          <input
            type="number"
            min={0}
            step={15}
            value={planned ?? ''}
            placeholder={String(estimatedStripMinutes(doc, strip))}
            onChange={(e) => mutateDoc((d) => setStripMinutes(d, day, strip.seqId, Number(e.target.value) || undefined))}
            aria-label={`Durée prévue de la séquence ${sequenceNumber(doc, strip.seqId)}, en minutes`}
          />
          min
        </label>
      )}
      {open && (
        <ul className={s.shots}>
          {strip.shotIds.map((id) => (
            <li key={id}>
              <b>{shotCode(doc, id)}</b> {doc.shots[id].subject} · {doc.shots[id].value} · {doc.shots[id].angle.join(', ')}
              <select
                value={doc.shots[id].shootingDay ?? 0}
                onChange={(e) => mutateDoc((d) => assignShots(d, [id], Number(e.target.value) || undefined))}
                aria-label={`Jour du plan ${shotCode(doc, id)}`}
              >
                <option value={0}>non planifié</option>
                {days.map((n) => (
                  <option key={n} value={n}>
                    Jour {n}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
