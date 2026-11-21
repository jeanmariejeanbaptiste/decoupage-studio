import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { addSequence, addShot, addShotAfter, deleteShot, duplicateShot, interviewGroupOf } from '../../../domain/ops';
import { computeTiming } from '../../../domain/timing';
import { activeColumns, tcLast } from '../../../domain/columns';
import type { ID, ProjectDoc } from '../../../domain/types';
import { mutateDoc } from '../../../store/projectStore';
import { useReadOnly } from '../../../store/share';
import { useUi } from '../../../store/uiStore';
import { dropShot } from '../actions';
import { ActionSheet } from './ActionSheet';
import { MovementSheet } from './MovementSheet';
import { Overview } from './Overview';
import { PlanScreen, type SheetKind } from './PlanScreen';
import { SoundSheet } from './SoundSheet';
import { SequenceSheet, TextSheet } from './TextSheet';
import { ValueSheet } from './ValueSheet';
import s from './MobileCut.module.css';

/** Point de départ du glissement du doigt (un seul doigt à la fois). */
const swipe = { x: 0, y: 0 };

/** Haut de l'écran : la page défile dans la zone principale de l'application. */
function toTop(el: Element | null) {
  const main = el?.closest('main');
  if (main) main.scrollTop = 0;
  else window.scrollTo({ top: 0 });
}

/**
 * Découpage sur téléphone : un plan à la fois (valeur en titre, une ligne par champ, chaque ligne
 * s'ouvre dans sa feuille du bas), le balayage ou les flèches pour passer au plan voisin, et la vue
 * d'ensemble pour ranger, insérer et réorganiser. Mêmes données et mêmes opérations que la grille.
 */
export function MobileCut({ doc, tools }: { doc: ProjectDoc; tools?: ReactNode }) {
  const readOnly = useReadOnly();
  const order = useMemo(() => doc.project.sequenceIds.flatMap((id) => doc.sequences[id]?.shotIds ?? []), [doc]);
  const timing = useMemo(() => computeTiming(doc), [doc]);
  // Arrivée d'une vérification ou d'un lien vers un plan : ce plan ; vers une séquence sans plan :
  // la vue d'ensemble, sur elle. Sinon le plan sélectionné, ou le premier.
  const [arrival] = useState(() => useUi.getState().cutFocus);
  const [current, setCurrent] = useState<ID | undefined>(() => {
    const sel = useUi.getState().selection;
    const wanted = arrival?.shotId ?? (sel ? order[sel.focus.row] : undefined);
    return wanted && order.includes(wanted) ? wanted : order[0];
  });
  const [list, setList] = useState(() => !!arrival && !arrival.shotId);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const shotId = current && order.includes(current) ? current : order[0];
  const shot = shotId ? doc.shots[shotId] : undefined;

  // L'inspecteur, l'aperçu et le panneau scénario ne servent pas sur téléphone.
  useEffect(() => {
    useUi.getState().set({ printView: false });
  }, []);
  // Plan disparu (annulation, suppression ailleurs) : sa feuille se referme.
  useEffect(() => {
    if (sheet && !shot) setSheet(null);
  }, [sheet, shot]);

  const open = (id: ID | undefined) => {
    if (!id) return;
    setCurrent(id);
    setList(false);
    setSheet(null);
    toTop(root);
  };
  const add = () => {
    if (!shotId) return;
    open(mutateDoc((d) => addShotAfter(d, shotId)));
  };
  const duplicate = () => shotId && open(mutateDoc((d) => duplicateShot(d, shotId)));
  // Supprimer : on reste sur le plan voisin ; l'annulation du haut le fait revenir.
  const remove = () => {
    if (!shotId) return;
    const i = order.indexOf(shotId);
    // Un plan d'interview part avec les autres caméras de son cadre.
    const gone = new Set(interviewGroupOf(doc, shotId));
    const neighbour = order.slice(i + 1).find((id) => !gone.has(id)) ?? order.slice(0, i).reverse().find((id) => !gone.has(id));
    mutateDoc((d) => deleteShot(d, shotId));
    setCurrent(neighbour);
    if (!neighbour) setList(true);
  };
  const insertShot = (seqId: ID, at: number) => open(mutateDoc((d) => addShot(d, seqId, { index: at })));
  const insertSequence = (index: number) =>
    open(
      mutateDoc((d) => {
        const sid = addSequence(d, index);
        return d.sequences[sid].shotIds[0];
      }),
    );
  const move = (id: ID, seqId: ID, at: number) => void dropShot(id, seqId, at, true);

  if (list || !shot || !shotId) {
    return (
      <div ref={setRoot} className={[s.vars, s.root].join(' ')}>
        <Overview
          doc={doc}
          current={shotId}
          timing={timing}
          readOnly={readOnly}
          tools={tools}
          jumpSeq={arrival && !arrival.shotId ? arrival.seqId : null}
          onOpen={open}
          onClose={shot ? () => (setList(false), toTop(root)) : undefined}
          onAddShot={insertShot}
          onAddSequence={insertSequence}
          onMove={move}
        />
      </div>
    );
  }

  const i = order.indexOf(shotId);
  // Glisser le doigt vers la gauche / la droite : plan suivant / précédent (pas dans une feuille).
  const onTouchStart = (e: React.TouchEvent) => {
    swipe.x = e.touches[0].clientX;
    swipe.y = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (sheet || (e.target as HTMLElement).closest('input, textarea, select, [data-sheet]')) return;
    const dx = e.changedTouches[0].clientX - swipe.x;
    const dy = e.changedTouches[0].clientY - swipe.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) open(order[dx < 0 ? i + 1 : i - 1]);
  };
  const cols = activeColumns(tcLast(doc.project.settings.gridColumns));
  const close = () => setSheet(null);
  return (
    <div ref={setRoot} className={[s.vars, s.root].join(' ')} data-testid="mobile-cut" data-view={readOnly || undefined} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <PlanScreen
        key={shotId}
        doc={doc}
        shotId={shotId}
        order={order}
        timing={timing}
        readOnly={readOnly}
        onGo={open}
        onOverview={() => (setList(true), toTop(root))}
        onOpen={setSheet}
        onAdd={add}
        onDuplicate={duplicate}
        onDelete={remove}
      />
      {sheet?.kind === 'value' && <ValueSheet doc={doc} shotId={shotId} cols={cols} onClose={close} />}
      {sheet?.kind === 'movement' && <MovementSheet doc={doc} shotId={shotId} cols={cols} onClose={close} />}
      {sheet?.kind === 'action' && <ActionSheet doc={doc} shotId={shotId} onClose={close} />}
      {sheet?.kind === 'sequence' && <SequenceSheet doc={doc} shotId={shotId} onClose={close} />}
      {sheet?.kind === 'sound' && <SoundSheet doc={doc} shotId={shotId} onClose={close} />}
      {sheet?.kind === 'text' && <TextSheet doc={doc} shotId={shotId} col={sheet.col} label={sheet.label} onClose={close} />}
    </div>
  );
}
