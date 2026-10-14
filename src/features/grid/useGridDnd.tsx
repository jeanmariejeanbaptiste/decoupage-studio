import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { produce } from 'immer';
import { useMemo, useState, type ReactNode } from 'react';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import { moveSequence, moveShot } from '../../domain/ops';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { dropShot } from './actions';
import { parseDndId } from './dnd';
import s from './Grid.module.css';

type Drag =
  | { kind: 'shot'; id: string; target?: { seqId: string; index: number } }
  | { kind: 'seq'; id: string; target?: { index: number } };

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

/**
 * Glisser-déposer des plans et des séquences (§4.5). Pendant le glissement, la grille est rendue
 * à partir d'un document d'aperçu : la numérotation se met à jour en direct.
 */
export function useGridDnd(doc: ProjectDoc) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  const displayDoc = useMemo(() => {
    if (!drag?.target) return doc;
    return produce(doc, (d) => {
      if (drag.kind === 'shot' && drag.target) moveShot(d, drag.id, drag.target.seqId, drag.target.index);
      else if (drag.kind === 'seq' && drag.target) moveSequence(d, drag.id, drag.target.index);
    });
  }, [doc, drag]);

  const onDragStart = (e: DragStartEvent) => {
    const a = parseDndId(e.active.id);
    if (a?.kind === 'shot') setDrag({ kind: 'shot', id: a.id });
    else if (a?.kind === 'seq') setDrag({ kind: 'seq', id: a.id });
  };

  const onDragOver = (e: DragOverEvent) => {
    const over = parseDndId(e.over?.id);
    if (!drag || !over) return;
    if (drag.kind === 'shot') {
      if (over.kind === 'row') {
        if (over.id === drag.id) return;
        const target = doc.shots[over.id];
        if (!target) return;
        const index = doc.sequences[target.sequenceId].shotIds.indexOf(over.id);
        setDrag({ ...drag, target: { seqId: target.sequenceId, index } });
      } else if (over.kind === 'seqdrop' && !drag.target) {
        // Survol d'une séquence (hors ligne) : dépôt en fin de séquence.
        const seq = doc.sequences[over.id];
        if (seq && over.id !== doc.shots[drag.id]?.sequenceId) setDrag({ ...drag, target: { seqId: over.id, index: seq.shotIds.length } });
      }
    } else {
      const seqId = over.kind === 'row' ? doc.shots[over.id]?.sequenceId : over.kind === 'seqdrop' ? over.id : undefined;
      if (!seqId) return;
      setDrag({ ...drag, target: seqId === drag.id ? undefined : { index: doc.project.sequenceIds.indexOf(seqId) } });
    }
  };

  const onDragEnd = () => {
    const d = drag;
    setDrag(null);
    if (!d?.target) return;
    if (d.kind === 'shot') void dropShot(d.id, d.target.seqId, d.target.index);
    else {
      const index = d.target.index;
      mutateDoc((x) => moveSequence(x, d.id, index));
    }
  };

  const overlayLabel = (() => {
    if (!drag) return null;
    if (drag.kind === 'shot') {
      const shot = doc.shots[drag.id];
      return shot ? `Plan ${shotCode(displayDoc, drag.id)} · ${shot.subject || 'sans sujet'}${shot.value ? ` · ${shot.value}` : ''}` : null;
    }
    return `Séquence ${sequenceHeading(displayDoc, drag.id)}`;
  })();

  const wrap = (children: ReactNode) => (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
      accessibility={{
        screenReaderInstructions: { draggable: 'Espace pour saisir, flèches pour déplacer, Espace pour déposer, Échap pour annuler.' },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{overlayLabel && <div className={s.dragCard}>{overlayLabel}</div>}</DragOverlay>
    </DndContext>
  );

  return { displayDoc, dragging: drag, wrap };
}
