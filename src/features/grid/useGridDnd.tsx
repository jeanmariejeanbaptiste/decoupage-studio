import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import { produce } from 'immer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { interviewGroupOf, moveSequence, moveShotTo } from '../../domain/ops';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { dropShot } from './actions';
import { parseDndId } from './dnd';

/** Glissement en cours ; la cible est une place comptée parmi les éléments qui restent (0 = en tête). */
type Drag =
  | { kind: 'shot'; id: string; target?: { seqId: string; index: number } }
  | { kind: 'seq'; id: string; target?: { index: number } };

/** Ce qu'on tient en main : les lignes du plan (les caméras d'un cadre d'interview ensemble) ou le corps d'une séquence. */
interface Lift {
  sels: string[];
  /** Haut de la première ligne dans le tableau, haut du tableau à l'écran, main au départ, déplacement. */
  top: number;
  screen: number;
  startY?: number;
  fallbackY: number;
  dy: number;
}

const rowSel = (id: string) => `tr[data-shot="${CSS.escape(id)}"]`;
const bodySel = (id: string) => `tbody[data-seq="${CSS.escape(id)}"]`;
const els = (sels: string[]) => sels.map((s) => document.querySelector<HTMLElement>(s)).filter((x): x is HTMLElement => !!x);
/** Haut à l'écran d'un élément, à sa place (sans le décalage d'une animation en cours). */
const screenTop = (el: HTMLElement) => ((el.offsetParent as HTMLElement | null)?.getBoundingClientRect().top ?? 0) + el.offsetTop;
const pointerY = (e: Event | null): number | undefined => (e && 'clientY' in e ? (e as PointerEvent).clientY : undefined);

/**
 * Glisser-déposer des plans et des séquences (§4.5), comme une liste triable : la ligne prise suit la
 * main, soulevée ; les autres glissent pour lui faire place, et la grille est rendue à partir d'un
 * document d'aperçu (numérotation à jour en direct). La place visée se lit sur la mise en page réelle.
 */
export function useGridDnd(doc: ProjectDoc) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

  const displayDoc = useMemo(() => {
    if (!drag?.target) return doc;
    return produce(doc, (d) => {
      if (drag.kind === 'shot' && drag.target) moveShotTo(d, drag.id, drag.target.seqId, drag.target.index);
      else if (drag.kind === 'seq' && drag.target) moveSequence(d, drag.id, drag.target.index);
    });
  }, [doc, drag]);

  const lift = useRef<Lift | null>(null);
  // État courant du glissement, lisible sans attendre le rendu (le dépôt peut suivre de près le dernier mouvement).
  const dragRef = useRef<Drag | null>(null);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  /** Les éléments tenus suivent la main. */
  const place = () => {
    const l = lift.current;
    const held = l ? els(l.sels) : [];
    if (!l || !held.length) return;
    const table = held[0].offsetParent as HTMLElement | null;
    const scrolled = l.screen - (table?.getBoundingClientRect().top ?? l.screen);
    const y = l.top + l.dy + scrolled - held[0].offsetTop;
    for (const el of held) {
      el.dataset.lifted = '';
      el.style.transform = `translateY(${y}px)`;
    }
  };

  /** Place visée sous la main, d'après la position actuelle des autres lignes (creux compris). */
  const aim = () => {
    const l = lift.current;
    const d = dragRef.current;
    if (!l || !d) return;
    // Comme une liste triable : en montant, le haut de ce qu'on tient ; en descendant, son bas.
    const held = els(l.sels).map((el) => el.getBoundingClientRect());
    const y = held.length ? (l.dy < 0 ? Math.min(...held.map((r) => r.top)) : Math.max(...held.map((r) => r.bottom))) : (l.startY ?? l.fallbackY) + l.dy;
    const bodies = Array.from(document.querySelectorAll<HTMLElement>('tbody[data-seq]'));
    if (d.kind === 'seq') {
      const others = bodies.filter((b) => !b.hasAttribute('data-lifted'));
      const index = others.filter((b) => screenTop(b) + b.offsetHeight / 2 < y).length;
      if (d.target?.index !== index) update({ ...d, target: { index } });
      return;
    }
    // Séquence sous la main (la plus proche entre deux séquences).
    let body: HTMLElement | undefined;
    let best = Infinity;
    for (const b of bodies) {
      const top = screenTop(b);
      const dist = y < top ? top - y : y > top + b.offsetHeight ? y - top - b.offsetHeight : 0;
      if (dist < best) {
        best = dist;
        body = b;
      }
    }
    const seqId = body?.dataset.seq;
    if (!body || !seqId) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>('tr[data-shot]')).filter((r) => !r.hasAttribute('data-lifted'));
    const index = rows.filter((r) => screenTop(r) + r.offsetHeight / 2 < y).length;
    if (d.target?.seqId !== seqId || d.target.index !== index) update({ ...d, target: { seqId, index } });
  };

  // Dépôt : les éléments quittent la main et rejoignent leur place en glissant.
  const settle = useRef<{ sels: string[]; from: number[] } | null>(null);
  const release = () => {
    const l = lift.current;
    lift.current = null;
    if (!l) return;
    const held = els(l.sels);
    settle.current = { sels: l.sels, from: held.map((el) => el.getBoundingClientRect().top) };
    for (const el of held) {
      el.style.transform = '';
      delete el.dataset.lifted;
    }
  };
  useLayoutEffect(() => {
    if (lift.current) place();
    const st = settle.current;
    if (!st || drag) return;
    settle.current = null;
    st.sels.forEach((sel, i) => {
      const el = document.querySelector<HTMLElement>(sel);
      const dy = el ? st.from[i] - el.getBoundingClientRect().top : 0;
      if (el && Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    });
  });

  // La main est lue directement (pointeur) : dnd-kit ne transmet ses mouvements qu'après le rendu,
  // trop tard quand la grille se redessine. Le clavier passe par onDragMove.
  const down = useRef<number | undefined>(undefined);
  const viaPointer = useRef(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => void (down.current = e.clientY);
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const l = lift.current;
      if (!l || !viaPointer.current) return;
      l.dy = e.clientY - (l.startY ?? l.fallbackY);
      place();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(aim);
    };
    const onUp = () => void (lift.current || (down.current = undefined));
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointermove', onMove, true);
      cancelAnimationFrame(frame);
    };
  });

  const onDragStart = (e: DragStartEvent) => {
    const a = parseDndId(e.active.id);
    const d: Drag | null = a?.kind === 'shot' ? { kind: 'shot', id: a.id } : a?.kind === 'seq' ? { kind: 'seq', id: a.id } : null;
    if (!d) return;
    const sels = d.kind === 'shot' ? interviewGroupOf(doc, d.id).map(rowSel) : [bodySel(d.id)];
    const held = els(sels);
    if (!held.length) return;
    const first = held[0];
    const table = first.offsetParent as HTMLElement | null;
    const box = first.getBoundingClientRect();
    viaPointer.current = down.current !== undefined;
    lift.current = { sels, top: first.offsetTop, screen: table?.getBoundingClientRect().top ?? 0, dy: 0, startY: down.current, fallbackY: box.top + box.height / 2 };
    down.current = undefined;
    update(d);
    place();
  };

  const onDragMove = (e: DragMoveEvent) => {
    if (!lift.current || viaPointer.current) return;
    lift.current.startY ??= pointerY(e.activatorEvent) ?? lift.current.fallbackY;
    lift.current.dy = e.delta.y;
    place();
    aim();
  };

  const onDragEnd = () => {
    aim();
    const d = dragRef.current;
    release();
    update(null);
    if (!d?.target) return;
    if (d.kind === 'shot') void dropShot(d.id, d.target.seqId, d.target.index, true);
    else {
      const index = d.target.index;
      mutateDoc((x) => moveSequence(x, d.id, index));
    }
  };

  const wrap = (children: ReactNode) => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      autoScroll={{ threshold: { x: 0, y: 0.15 } }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        release();
        update(null);
      }}
      accessibility={{
        screenReaderInstructions: { draggable: 'Espace pour saisir, flèches pour déplacer, Espace pour déposer, Échap pour annuler.' },
      }}
    >
      {children}
    </DndContext>
  );

  return { displayDoc, dragging: drag, wrap };
}
