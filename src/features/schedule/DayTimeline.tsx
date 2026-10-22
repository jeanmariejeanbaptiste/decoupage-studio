import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { formatFocal } from '../../domain/focal';
import { renderTokens } from '../../domain/tokens';
import { isZoom } from '../../domain/vocabulary';
import { Minus, Plus, Scissors, X } from 'lucide-react';
import { valueLabel } from '../../domain/vocabulary';
import { shotCode, sequenceHeading } from '../../domain/numbering';
import {
  dayItinerary,
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
  splitShot,
  placePart,
  resizePart,
  removePart,
  movePartToDay,
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
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  // Réserve : tous les plans non encore placés dans un jour, séquence par séquence.
  const free = new Set(
    [...(stripsByDay(doc).get(0) ?? []), ...(stripsByDay(doc).get(day) ?? [])].flatMap((x) => x.shotIds),
  );
  const q = fold(query);
  const strips = doc.project.sequenceIds
    .map((seqId) => ({
      seqId,
      shotIds: (doc.sequences[seqId]?.shotIds ?? []).filter(
        (id) =>
          free.has(id) &&
          !placed.has(id) &&
          (!q ||
            fold(`${sequenceHeading(doc, seqId)} ${shotCode(doc, id)} ${shotText(doc, id)}`).includes(q)),
      ),
    }))
    .filter((x) => x.shotIds.length);
  const lanes = Math.max(1, ...entries.map((e) => e.lane + 1));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const slots: number[] = [];
  for (let m = start; m < end; m += SLOT_MIN) slots.push(m);

  const otherDays = scheduleDays(doc).map((x) => x.n).filter((n) => n !== day);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const over = e.over ? String(e.over.id) : '';
    const what = String(e.active.id).split(':');
    if (over === 'pool' && what[0] === 'tshot' && placed.has(what[1]))
      return mutateDoc((d) => unplaceShot(d, day, what[1]));
    if (!over.startsWith('slot:')) return;
    const at = fromMin(Number(over.slice(5)));
    if (what[0] === 'tshot') mutateDoc((d) => placeShot(d, day, what[1], at));
    else if (what[0] === 'tpart') mutateDoc((d) => placePart(d, day, what[1], Number(what[2]), at));
    else if (what[0] === 'tseq') {
      const strip = strips.find((x) => x.seqId === what[1]);
      if (strip) mutateDoc((d) => placeSequence(d, day, strip.shotIds, at));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActive(String(e.active.id))}
      onDragCancel={() => setActive(null)}
      onDragEnd={onDragEnd}
    >
      <div className={s.wrap} data-testid={`timeline-${day}`}>
        <Pool>
          <input
            className={s.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer : séquence, valeur, comédien, action…"
            aria-label="Filtrer les plans"
          />
          <div className={s.scroll}>
            {strips.map((st) => (
              <div key={st.seqId} className={s.group}>
                <Chip id={`tseq:${st.seqId}`} className={s.seqChip}>
                  {sequenceHeading(doc, st.seqId)} <em>{st.shotIds.length} à placer</em>
                </Chip>
                {st.shotIds.map((id) => (
                  <Chip key={id} id={`tshot:${id}`} className={s.shotCard} testid="pool-shot">
                    <ShotCard doc={doc} id={id} />
                  </Chip>
                ))}
              </div>
            ))}
            {!strips.length && (
              <p className={s.hint}>{q ? 'Aucun plan ne correspond.' : 'Tous les plans sont placés.'}</p>
            )}
          </div>
          <div className={s.range}>
            <label>
              de{' '}
              <input
                type="time"
                value={fromMin(start)}
                onChange={(e) =>
                  e.target.value && mutateDoc((d) => updateDay(d, day, { dayStart: e.target.value }))
                }
                aria-label="Début de journée"
              />
            </label>
            <label>
              à{' '}
              <input
                type="time"
                value={fromMin(end)}
                onChange={(e) =>
                  e.target.value && mutateDoc((d) => updateDay(d, day, { dayEnd: e.target.value }))
                }
                aria-label="Fin de journée"
              />
            </label>
          </div>
        </Pool>
        <div className={s.grid} style={{ height: slots.length * ROW }}>
          {slots.map((m) => (
            <Slot key={m} minute={m} />
          ))}
          {dayItinerary(doc, day).map((stop, i, all) => {
            const prev = all[i - 1];
            if (!stop.start || (prev && prev.address === stop.address && prev.decorId === stop.decorId))
              return null;
            const top = ((Math.max(toMin(stop.start), start) - start) / SLOT_MIN) * ROW;
            const place = [
              stop.decorId ? doc.decors[stop.decorId]?.name : undefined,
              stop.address || 'adresse à préciser',
            ]
              .filter(Boolean)
              .join(' — ');
            return (
              <div key={stop.seqIds[0]} className={s.move} style={{ top }} data-testid="timeline-move">
                <span>
                  {i === 0 ? 'Lieu' : 'Changement de lieu'} {stop.start} : {place}
                </span>
              </div>
            );
          })}
          {entries.map((e) => {
            const sh = doc.shots[e.shotId];
            const top = ((Math.max(e.start, start) - start) / SLOT_MIN) * ROW;
            const height = Math.max(ROW, ((Math.min(e.end, end) - Math.max(e.start, start)) / SLOT_MIN) * ROW - 2);
            const tall = height >= ROW * 3;
            const tags = [valueLabel(sh.value, doc.project.settings.labelStyle), renderTokens(sh.angle), renderTokens(sh.movement, sh.movementSep), formatFocal(sh.focal, isZoom(sh.movement))].filter(Boolean);
            const resize = (delta: number) => mutateDoc((d) => (e.part ? resizePart(d, day, e.shotId, e.part, delta) : resizeShot(d, day, e.shotId, delta)));
            return (
              <Block
                key={`${e.shotId}:${e.part}`}
                dragId={e.part ? `tpart:${e.shotId}:${e.part}` : `tshot:${e.shotId}`}
                style={{
                  top,
                  height,
                  left: `calc(52px + (100% - 56px) * ${e.lane / lanes})`,
                  width: `calc((100% - 56px) / ${lanes} - 3px)`,
                }}
                part={e.part}
              >
                <span className={s.blockHead}>
                  <b>{shotCode(doc, e.shotId)}</b>
                  {e.part > 0 && <em className={s.partTag}>reprise {e.part}</em>}
                  <span className={s.blockTime}>
                    {fromMin(e.start)}–{fromMin(e.end)}
                  </span>
                  {sh.subject && <strong className={s.blockSubject}>{sh.subject}</strong>}
                </span>
                {tall && (
                  <span className={s.blockTags}>
                    {tags.map((x, k) => (
                      <i key={k} className={s[`bt${k}`]}>
                        {x}
                      </i>
                    ))}
                  </span>
                )}
                {tall && doc.blocks[sh.actionBlockId]?.text && <span className={s.blockText}>{doc.blocks[sh.actionBlockId]?.text}</span>}
                <span className={s.tools} onPointerDown={(ev) => ev.stopPropagation()}>
                  <button type="button" aria-label="Raccourcir de 15 min" onClick={() => resize(-SLOT_MIN)}>
                    <Minus size={11} />
                  </button>
                  <button type="button" aria-label="Allonger de 15 min" onClick={() => resize(SLOT_MIN)}>
                    <Plus size={11} />
                  </button>
                  {e.part === 0 && (
                    <button type="button" aria-label="Fractionner (pause, reprise)" title="Fractionner : la seconde moitié devient une reprise à placer" onClick={() => mutateDoc((d) => splitShot(d, day, e.shotId))} data-testid="timeline-split">
                      <Scissors size={11} />
                    </button>
                  )}
                  {e.part > 0 && otherDays.length > 0 && (
                    <select aria-label="Reprendre un autre jour" value="" onChange={(ev) => ev.target.value && mutateDoc((d) => movePartToDay(d, day, e.shotId, e.part, Number(ev.target.value)))} data-testid="timeline-part-day">
                      <option value="">→ jour</option>
                      {otherDays.map((n) => (
                        <option key={n} value={n}>
                          J{n}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" aria-label="Retirer de l’emploi du temps" onClick={() => mutateDoc((d) => (e.part ? removePart(d, day, e.shotId, e.part) : unplaceShot(d, day, e.shotId)))}>
                    <X size={11} />
                  </button>
                </span>
              </Block>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className={[s.shotCard, s.dragging].join(' ')}>
            {active.startsWith('tseq:') ? (
              sequenceHeading(doc, active.slice(5))
            ) : (
              <ShotCard doc={doc} id={active.slice(6)} />
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Chip({
  id,
  className,
  children,
  disabled,
  testid,
}: {
  id: string;
  className: string;
  children: React.ReactNode;
  disabled?: boolean;
  testid?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={[className, isDragging ? s.ghost : '', disabled ? s.disabled : ''].join(' ')}
      data-testid={testid}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

function Pool({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' });
  return (
    <aside ref={setNodeRef} className={[s.pool, isOver ? s.over : ''].join(' ')} aria-label="Plans à placer">
      {children}
    </aside>
  );
}

const fold = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function shotText(doc: ProjectDoc, id: ID): string {
  const sh = doc.shots[id];
  const actors = (sh.characterIds ?? []).map((c) => doc.characters[c]?.name).join(' ');
  return [
    sh.subject,
    sh.value,
    renderTokens(sh.angle),
    renderTokens(sh.movement, sh.movementSep),
    formatFocal(sh.focal, isZoom(sh.movement)),
    actors,
    doc.blocks[sh.actionBlockId]?.text,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Fiche détaillée d’un plan, pour choisir quoi tourner. */
function ShotCard({ doc, id }: { doc: ProjectDoc; id: ID }) {
  const sh = doc.shots[id];
  if (!sh) return null;
  const tech = [
    renderTokens(sh.angle),
    renderTokens(sh.movement, sh.movementSep),
    formatFocal(sh.focal, isZoom(sh.movement)),
  ]
    .filter(Boolean)
    .join(' · ');
  const action = doc.blocks[sh.actionBlockId]?.text;
  return (
    <>
      <span className={s.cardHead}>
        <b>{shotCode(doc, id)}</b> {sh.value || 'valeur ?'}
        {sh.subject && <span> · {sh.subject}</span>}
      </span>
      {tech && <span className={s.cardTech}>{tech}</span>}
      {action && <span className={s.cardAction}>{action}</span>}
    </>
  );
}

function Slot({ minute }: { minute: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${minute}` });
  const hour = minute % 60 === 0;
  return (
    <div
      ref={setNodeRef}
      className={[s.slot, hour ? s.hour : '', isOver ? s.over : ''].join(' ')}
      style={{ height: ROW }}
      data-testid={`slot-${fromMin(minute)}`}
    >
      {hour && <span className={s.label}>{fromMin(minute)}</span>}
    </div>
  );
}

function Block({ dragId, style, part, children }: { dragId: string; style: React.CSSProperties; part: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: dragId });
  return (
    <div
      ref={setNodeRef}
      className={[s.block, part ? s.blockPart : '', isDragging ? s.dragging : ''].join(' ')}
      style={{ ...style, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      data-testid="timeline-block"
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}
