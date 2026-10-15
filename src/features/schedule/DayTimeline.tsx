import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Minus, Plus, X } from 'lucide-react';
import { shotCode, sequenceHeading } from '../../domain/numbering';
import {
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  fromMin,
  placeSequence,
  placeShot,
  resizeShot,
  SLOT_MIN,
  stripsByDay,
  timelineOf,
  toMin,
  unplaceShot,
  updateDay,
  scheduleDays,
} from '../../domain/schedule';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import s from './DayTimeline.module.css';

const ROW = 18; // hauteur d'un créneau de 15 min, en px

/** Emploi du temps horaire d'un jour : on y dépose les plans (ou une séquence entière). */
export function DayTimeline({ doc, day }: { doc: ProjectDoc; day: number }) {
  const meta = scheduleDays(doc).find((d) => d.n === day);
  const start = toMin(meta?.dayStart ?? DEFAULT_DAY_START);
  const end = Math.max(start + 60, toMin(meta?.dayEnd ?? DEFAULT_DAY_END));
  const entries = timelineOf(doc, day);
  const placed = new Set(entries.map((e) => e.shotId));
  const strips = stripsByDay(doc).get(day) ?? [];
  const lanes = Math.max(1, ...entries.map((e) => e.lane + 1));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const slots: number[] = [];
  for (let m = start; m < end; m += SLOT_MIN) slots.push(m);

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over ? String(e.over.id) : '';
    const what = String(e.active.id).split(':');
    if (!over.startsWith('slot:')) return;
    const at = fromMin(Number(over.slice(5)));
    if (what[0] === 'tshot') mutateDoc((d) => placeShot(d, day, what[1], at));
    else if (what[0] === 'tseq') {
      const strip = strips.find((x) => x.seqId === what[1]);
      if (strip) mutateDoc((d) => placeSequence(d, day, strip.shotIds, at));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className={s.wrap} data-testid={`timeline-${day}`}>
        <aside className={s.pool} aria-label="Plans du jour à placer">
          <p className={s.hint}>Glissez un plan, ou une séquence entière, dans l’emploi du temps.</p>
          {strips.map((st) => {
            const rest = st.shotIds.filter((id) => !placed.has(id));
            return (
              <div key={st.seqId} className={s.group}>
                <Chip id={`tseq:${st.seqId}`} className={s.seqChip} disabled={!rest.length}>
                  {sequenceHeading(doc, st.seqId)} <em>{rest.length ? `${rest.length} à placer` : 'tout est placé'}</em>
                </Chip>
                <div className={s.chips}>
                  {rest.map((id) => (
                    <Chip key={id} id={`tshot:${id}`} className={s.shotChip} testid="pool-shot">
                      <b>{shotCode(doc, id)}</b> {doc.shots[id].value}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}
          {!strips.length && <p className={s.hint}>Aucun plan dans ce jour.</p>}
          <div className={s.range}>
            <label>
              de <input type="time" value={fromMin(start)} onChange={(e) => e.target.value && mutateDoc((d) => updateDay(d, day, { dayStart: e.target.value }))} aria-label="Début de journée" />
            </label>
            <label>
              à <input type="time" value={fromMin(end)} onChange={(e) => e.target.value && mutateDoc((d) => updateDay(d, day, { dayEnd: e.target.value }))} aria-label="Fin de journée" />
            </label>
          </div>
        </aside>
        <div className={s.grid} style={{ height: slots.length * ROW }}>
          {slots.map((m) => (
            <Slot key={m} minute={m} />
          ))}
          {entries.map((e) => {
            const sh = doc.shots[e.shotId];
            const top = ((Math.max(e.start, start) - start) / SLOT_MIN) * ROW;
            const height = Math.max(ROW, ((Math.min(e.end, end) - Math.max(e.start, start)) / SLOT_MIN) * ROW - 2);
            return (
              <Block key={e.shotId} id={e.shotId} style={{ top, height, left: `calc(52px + (100% - 56px) * ${e.lane / lanes})`, width: `calc((100% - 56px) / ${lanes} - 3px)` }}>
                <span className={s.blockHead}>
                  <b>{shotCode(doc, e.shotId)}</b> {fromMin(e.start)}–{fromMin(e.end)}
                </span>
                <span className={s.blockText}>
                  {sh.subject} · {sh.value} — {doc.blocks[sh.actionBlockId]?.text}
                </span>
                <span className={s.tools} onPointerDown={(ev) => ev.stopPropagation()}>
                  <button type="button" aria-label="Raccourcir de 15 min" onClick={() => mutateDoc((d) => resizeShot(d, day, e.shotId, -SLOT_MIN))}>
                    <Minus size={11} />
                  </button>
                  <button type="button" aria-label="Allonger de 15 min" onClick={() => mutateDoc((d) => resizeShot(d, day, e.shotId, SLOT_MIN))}>
                    <Plus size={11} />
                  </button>
                  <button type="button" aria-label="Retirer de l’emploi du temps" onClick={() => mutateDoc((d) => unplaceShot(d, day, e.shotId))}>
                    <X size={11} />
                  </button>
                </span>
              </Block>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

function Chip({ id, className, children, disabled, testid }: { id: string; className: string; children: React.ReactNode; disabled?: boolean; testid?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return (
    <span
      ref={setNodeRef}
      className={[className, isDragging ? s.dragging : '', disabled ? s.disabled : ''].join(' ')}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: 'relative' } : undefined}
      data-testid={testid}
      {...listeners}
      {...attributes}
    >
      {children}
    </span>
  );
}

function Slot({ minute }: { minute: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${minute}` });
  const hour = minute % 60 === 0;
  return (
    <div ref={setNodeRef} className={[s.slot, hour ? s.hour : '', isOver ? s.over : ''].join(' ')} style={{ height: ROW }} data-testid={`slot-${fromMin(minute)}`}>
      {hour && <span className={s.label}>{fromMin(minute)}</span>}
    </div>
  );
}

function Block({ id, style, children }: { id: ID; style: React.CSSProperties; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `tshot:${id}` });
  return (
    <div
      ref={setNodeRef}
      className={[s.block, isDragging ? s.dragging : ''].join(' ')}
      style={{ ...style, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      data-testid="timeline-block"
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}
