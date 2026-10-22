import { useMemo, useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Clock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { DayTimeline } from './DayTimeline';
import { sequenceCharacterIds } from '../../domain/characters';
import { sequenceNumber, shotCode } from '../../domain/numbering';
import { stripRange, stripsByTime, addDay, assignShots, dayStats, removeDay, scheduleDays, stripsByDay, suggestSchedule, updateDay, type Strip } from '../../domain/schedule';
import { formatTc } from '../../domain/timecode';
import { computeTiming } from '../../domain/timing';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, undo } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { ask } from '../../ui/dialogStore';
import s from './SchedulePage.module.css';
import { TabExport } from '../export/TabExport';
import { scheduleCsv } from '../../domain/exports';
import { scheduleDocument } from '../../domain/documents';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function stripTone(doc: ProjectDoc, seqId: ID): string {
  const seq = doc.sequences[seqId];
  const night = seq?.effect === 'NUIT';
  const twilight = seq?.effect === 'AUBE' || seq?.effect === 'CRÉPUSCULE';
  const ext = seq?.intExt === 'EXT';
  if (twilight) return s.tTwilight;
  if (night) return ext ? s.tExtNight : s.tIntNight;
  return ext ? s.tExtDay : s.tIntDay;
}

/** Plan de travail (§15.3) : bandes par jour de tournage. */
export function SchedulePage({ doc }: { doc: ProjectDoc }) {
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const strips = useMemo(() => stripsByDay(doc), [doc]);
  const days = scheduleDays(doc);
  const [capacity, setCapacity] = useState(20);
  const [openDays, setOpenDays] = useState<number[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const toast = useUi((u) => u.toast);

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
      const r = await ask({ title: 'Remplacer le plan de travail ?', body: 'Tous les plans seront réaffectés : regroupement par décor, puis par comédiens, puis par axes.', confirmLabel: 'Suggérer' });
      if (!r.ok) return;
    }
    const n = mutateDoc((d) => suggestSchedule(d, capacity)) ?? 0;
    toast({ message: `Plan de travail suggéré sur ${n} jour${n > 1 ? 's' : ''}.`, actionLabel: 'Annuler', action: undo });
  };

  const total = [...strips.values()].flat().reduce((n, x) => n + x.shotIds.length, 0);
  const planned = total - (strips.get(0) ?? []).reduce((n, x) => n + x.shotIds.length, 0);

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div className={s.toolbar}>
          <TabExport doc={() => scheduleDocument(doc)} fileBase={`${doc.project.title || 'projet'}-plan-de-travail`} file={{ label: 'CSV', name: `${doc.project.title || 'projet'}-plan-de-travail.csv`, content: () => scheduleCsv(doc) }} />
          <label className={s.cap}>
            <span>plans / jour</span>
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))} aria-label="Plans par jour au maximum" />
          </label>
          <Button variant="outline" icon={<Sparkles size={15} strokeWidth={1.25} />} onClick={suggest} data-testid="suggest-schedule">
            Suggérer
          </Button>
          <Button variant="primary" icon={<Plus size={15} strokeWidth={1.5} />} onClick={() => mutateDoc((d) => addDay(d))} data-testid="add-day">
            Ajouter un jour
          </Button>
        </div>
      </header>
      <p className={s.summary}>
        <Hand>
          {planned} plan{planned > 1 ? 's' : ''} planifié{planned > 1 ? 's' : ''} sur {total}
        </Hand>
      </p>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className={s.bands}>
          {days.map((d) => {
            const st = dayStats(doc, timing, d.n);
            return (
              <Band key={d.n} day={d.n} doc={doc} strips={stripsByTime(doc, d.n)} days={days.map((x) => x.n)} extra={openDays.includes(d.n) ? <DayTimeline doc={doc} day={d.n} /> : null}>
                <div className={s.dayHead}>
                  <strong>Jour {d.n}</strong>
                  <input
                    type="date"
                    value={d.date ?? ''}
                    onChange={(e) => mutateDoc((x) => updateDay(x, d.n, { date: e.target.value || undefined }))}
                    aria-label={`Date du jour ${d.n}`}
                  />
                  {d.date && <span className={s.date}>{dateFmt.format(new Date(`${d.date}T12:00`))}</span>}
                  <label className={s.rdv}>
                    RDV
                    <input type="time" value={d.callTime ?? ''} onChange={(e) => mutateDoc((x) => updateDay(x, d.n, { callTime: e.target.value || undefined }))} aria-label={`Rendez-vous du jour ${d.n}`} />
                  </label>
                  <span className={s.stats} data-testid={`day-stats-${d.n}`}>
                    {st.shots} plan{st.shots > 1 ? 's' : ''} · <span className="mono">{formatTc(st.screenSec)}</span> d’écran · {st.decorIds.length} décor{st.decorIds.length > 1 ? 's' : ''}
                  </span>
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
                </div>
              </Band>
            );
          })}
          <Band day={0} doc={doc} strips={strips.get(0) ?? []} days={days.map((x) => x.n)}>
            <p className={s.unplannedHead}>
              Non planifié · {(strips.get(0) ?? []).reduce((n, x) => n + x.shotIds.length, 0)} plans
              <span> — piochez-les plutôt depuis l’emploi du temps d’un jour</span>
            </p>
          </Band>
        </div>
      </DndContext>
    </div>
  );
}

function Band({ day, doc, strips, days, children, extra }: { day: number; doc: ProjectDoc; strips: Strip[]; days: number[]; children: React.ReactNode; extra?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}` });
  return (
    <section ref={setNodeRef} className={[s.band, day === 0 ? s.unplanned : '', isOver ? s.over : ''].join(' ')} data-testid={`band-${day}`}>
      {children}
      <div className={s.strips}>
        {strips.length === 0 && <p className={s.empty}>{day === 0 ? 'Tout est planifié.' : 'Déposez ici des séquences.'}</p>}
        {strips.map((st) => (
          <StripRow key={st.seqId} doc={doc} day={day} strip={st} days={days} />
        ))}
      </div>
      {extra}
    </section>
  );
}

function StripRow({ doc, day, strip, days }: { doc: ProjectDoc; day: number; strip: Strip; days: number[] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `strip:${day}:${strip.seqId}` });
  const [open, setOpen] = useState(false);
  const seq = doc.sequences[strip.seqId];
  const decor = seq?.decorId ? doc.decors[seq.decorId] : undefined;
  const cast = sequenceCharacterIds(doc, strip.seqId).map((id) => doc.characters[id]?.name).filter(Boolean);
  const totalInSeq = seq?.shotIds.length ?? 0;
  const range = day > 0 ? stripRange(doc, day, strip) : undefined;
  return (
    <div
      ref={setNodeRef}
      className={[s.strip, stripTone(doc, strip.seqId), isDragging ? s.dragging : ''].join(' ')}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined}
      data-testid="strip"
    >
      <div className={s.stripMain} {...listeners} {...attributes} aria-label={`Séquence ${sequenceNumber(doc, strip.seqId)}, glisser vers un autre jour`}>
        <span className={s.num}>{sequenceNumber(doc, strip.seqId)}</span>
        <span className={s.ie}>{[seq?.intExt, seq?.effect].filter(Boolean).join(' · ')}</span>
        <span className={s.label}>{seq?.label.toUpperCase()}</span>
        <span className={s.decor}>{decor && decor.name.toUpperCase() !== seq?.label.toUpperCase() ? decor.name : ''}</span>
        <span className={s.cast}>{cast.join(', ')}</span>
        <span className={s.when}>{range ? `${range.start}–${range.end}` : ''}</span>
        <span className={s.count}>
          {strip.shotIds.length}
          {strip.shotIds.length !== totalInSeq ? ` / ${totalInSeq}` : ''} pl.
        </span>
      </div>
      <button type="button" className={s.toggle} aria-expanded={open} aria-label="Détail des plans" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
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
