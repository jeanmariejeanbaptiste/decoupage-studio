import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { CSSProperties, ReactNode } from 'react';
import s from './Grid.module.css';

export const shotDragId = (id: string) => `shot:${id}`;
export const seqDragId = (id: string) => `seq:${id}`;
export const rowDropId = (id: string) => `row:${id}`;
export const seqDropId = (id: string) => `seqdrop:${id}`;

export function parseDndId(id: string | number | undefined): { kind: string; id: string } | null {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(':');
  return i < 0 ? null : { kind: id.slice(0, i), id: id.slice(i + 1) };
}

function Dots() {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
      {[2, 7, 12].map((y) => [2, 6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />))}
    </svg>
  );
}

/** Poignée (6 points) d'une ligne de plan. */
export function ShotHandle({ shotId, label }: { shotId: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: shotDragId(shotId) });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={[s.handle, isDragging ? s.dragging : ''].join(' ')}
      aria-label={`Déplacer le plan ${label}`}
      title="Glisser pour déplacer le plan"
      data-testid="shot-handle"
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <Dots />
    </button>
  );
}

/** Cellule N° entière servant de poignée : le numéro reste lisible, la main indique qu'on peut glisser. */
export function NumberHandle({ shotId, label, num }: { shotId: string; label: string; num: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: shotDragId(shotId) });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={[s.numHandle, isDragging ? s.dragging : ''].join(' ')}
      aria-label={`Déplacer le plan ${label}`}
      title="Glisser pour déplacer le plan"
      data-testid="shot-handle"
      onMouseDown={(e) => e.stopPropagation()}
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <span className={s.num}>{num}</span>
    </button>
  );
}

/** Poignée d'une séquence entière, sur la cellule SÉQUENCE. */
export function SeqHandle({ seqId, label }: { seqId: string; label: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: seqDragId(seqId) });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={s.seqHandle}
      aria-label={`Déplacer la séquence ${label}`}
      title="Glisser pour déplacer la séquence entière"
      data-testid="seq-handle"
      onMouseDown={(e) => e.stopPropagation()}
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <Dots />
    </button>
  );
}

export function DroppableRow({ shotId, children, className, ...rest }: { shotId: string; children: ReactNode; className?: string } & Record<string, unknown>) {
  const { setNodeRef, isOver } = useDroppable({ id: rowDropId(shotId) });
  return (
    <tr ref={setNodeRef} className={[className, isOver ? s.over : ''].join(' ')} {...rest}>
      {children}
    </tr>
  );
}

export function DroppableBody({ seqId, children, className, style }: { seqId: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  const { setNodeRef, isOver } = useDroppable({ id: seqDropId(seqId) });
  return (
    <tbody ref={setNodeRef} className={[className, isOver ? s.overSeq : ''].join(' ')} style={style} data-seq={seqId}>
      {children}
    </tbody>
  );
}
