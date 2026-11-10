import { useState } from 'react';
import {
  closestCenter,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { OutlineItem } from '../../../domain/outline';
import { moveTo } from './outlineActions';
import { dropMove, dropOnPart } from './outlineModel';

/** Où la séquence lâchée irait : avant / après une séquence, ou en tête d'une partie. */
export type DropMark = { n: number; place: 'before' | 'after' } | { part: number } | null;

const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

const seqOf = (id: unknown) => (typeof id === 'string' && id.startsWith('seq-') ? Number(id.slice(4)) : null);
const partOf = (id: unknown) => (typeof id === 'string' && id.startsWith('part-') ? Number(id.slice(5)) : null);

/**
 * Glisser d'une séquence par sa poignée (Liste et Par intrigue). L'endroit de dépôt est marqué par un
 * filet ; le dépôt appelle `moveEntry` puis `applyScenarioEdit` (une seule annulation).
 */
export function useOutlineDnd(items: readonly OutlineItem[]) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [dragging, setDragging] = useState<number | null>(null);
  const [mark, setMark] = useState<DropMark>(null);

  const markOf = (e: DragMoveEvent): DropMark => {
    const { over, activatorEvent, delta } = e;
    if (!over) return null;
    const part = partOf(over.id);
    if (part !== null) return { part };
    const n = seqOf(over.id);
    if (n === null) return null;
    const y = (activatorEvent as PointerEvent).clientY + delta.y;
    const r = over.rect;
    return { n, place: Number.isFinite(y) && y > r.top + r.height / 2 ? 'after' : 'before' };
  };

  const onDragStart = (e: DragStartEvent) => setDragging(seqOf(e.active.id));
  const onDragMove = (e: DragMoveEvent) => {
    const m = markOf(e);
    setMark((cur) => (JSON.stringify(cur) === JSON.stringify(m) ? cur : m));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const from = seqOf(e.active.id);
    const m = markOf(e);
    setDragging(null);
    setMark(null);
    if (from === null || !m) return;
    const move = 'part' in m ? dropOnPart(items, from, m.part) : m.n === from ? null : dropMove(from, m.n, m.place);
    if (move) moveTo(from, move);
  };
  const onDragCancel = () => {
    setDragging(null);
    setMark(null);
  };

  /** Marque visible : rien sur la séquence qui glisse elle-même. */
  const markFor = (n: number): 'before' | 'after' | null => (mark && 'n' in mark && mark.n === n && dragging !== n ? mark.place : null);
  const partMarked = (index: number) => !!mark && 'part' in mark && mark.part === index;

  return {
    ctx: { sensors, collisionDetection: collide, onDragStart, onDragMove, onDragEnd, onDragCancel },
    dragging,
    markFor,
    partMarked,
  };
}

/** Poignée et zone de dépôt d'une séquence. */
export function useSeqDnd(n: number, disabled: boolean) {
  const drag = useDraggable({ id: `seq-${n}`, disabled });
  const drop = useDroppable({ id: `seq-${n}`, disabled });
  return {
    setRow: drop.setNodeRef,
    setHandle: drag.setNodeRef,
    // Au clavier, ⌥↑ / ⌥↓ : la poignée n'est pas un arrêt de tabulation.
    handleProps: { ...drag.attributes, ...drag.listeners, tabIndex: -1 },
  };
}

export const usePartDrop = (index: number, disabled: boolean) => useDroppable({ id: `part-${index}`, disabled }).setNodeRef;
