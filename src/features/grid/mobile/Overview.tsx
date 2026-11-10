import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { parseFountain } from '../../../domain/fountain';
import { focalLabel, shotCodeAt } from '../../../domain/phoneCut';
import { sequenceNumber, shotCode } from '../../../domain/numbering';
import { sequenceExcerpt } from '../../../domain/scriptToShot';
import { formatTc } from '../../../domain/timecode';
import type { Timing } from '../../../domain/timing';
import type { ID, ProjectDoc } from '../../../domain/types';
import { useRowDrag } from './useRowDrag';
import s from './Overview.module.css';

/** Six points : la poignée qui soulève une rangée. */
const Grip = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    {[5, 12, 19].map((y) => (
      <Fragment key={y}>
        <circle cx="9" cy={y} r="1" />
        <circle cx="15" cy={y} r="1" />
      </Fragment>
    ))}
  </svg>
);

/**
 * Vue d'ensemble : toutes les séquences et leurs plans, une ligne chacun. Toucher un plan l'ouvre ;
 * toucher l'espace entre deux rangées y propose « + Plan » (et « + Séquence » au bout d'une
 * séquence) ; l'appui long sur la poignée soulève un plan pour le poser ailleurs, même dans une autre
 * séquence. Une séquence sans plan montre son texte et son « + ».
 */
export function Overview({
  doc,
  current,
  timing,
  readOnly,
  tools,
  jumpSeq,
  onOpen,
  onClose,
  onAddShot,
  onAddSequence,
  onMove,
}: {
  doc: ProjectDoc;
  current?: ID;
  timing: Timing;
  readOnly: boolean;
  tools?: ReactNode;
  jumpSeq?: ID | null;
  onOpen: (id: ID) => void;
  onClose?: () => void;
  onAddShot: (seqId: ID, at: number) => void;
  onAddSequence: (index: number) => void;
  onMove: (id: ID, seqId: ID, at: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { drag, grip } = useRowDrag(root, onMove);
  const [slot, setSlot] = useState<string | null>(null);
  const ids = doc.project.sequenceIds;
  const nShots = ids.reduce((n, id) => n + (doc.sequences[id]?.shotIds.length ?? 0), 0);
  // Aperçu du texte des séquences sans plan (scénario lu une fois).
  const excerpts = useMemo(() => {
    const empty = ids.filter((id) => !doc.sequences[id]?.shotIds.length);
    const elements = empty.length ? parseFountain(doc.scenario ?? '') : [];
    return new Map(empty.map((id) => [id, sequenceExcerpt(doc, id, elements, 160)]));
  }, [doc, ids]);

  // Arrivée sur une séquence (sans plan, depuis une vérification) ou sur le plan en cours.
  useEffect(() => {
    const el = jumpSeq ? root.current?.querySelector(`[data-mobile-seq="${CSS.escape(jumpSeq)}"]`) : current ? root.current?.querySelector(`[data-row="${CSS.escape(current)}"]`) : null;
    el?.scrollIntoView({ block: jumpSeq ? 'start' : 'center' });
    // À l'ouverture seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Espace entre deux rangées : touché, il s'ouvre sur « + Plan » et, en fin de séquence, « + Séquence ». */
  const gap = (seqId: ID, at: number, end: boolean, plan = true) => {
    if (readOnly || drag) return null;
    const key = `${seqId}:${at}:${end ? 'e' : ''}`;
    const seqIndex = ids.indexOf(seqId) + 1;
    if (slot === key)
      return (
        <div className={s.slot} key={key}>
          {plan && (
            <button type="button" className={s.pill} onClick={() => (setSlot(null), onAddShot(seqId, at))} data-testid="mobile-insert-shot">
              <Plus size={16} strokeWidth={1.5} />
              Plan<b>{shotCodeAt(doc, seqId, at)}</b>
            </button>
          )}
          {end && (
            <button type="button" className={s.pill} onClick={() => (setSlot(null), onAddSequence(seqIndex))} data-testid="mobile-insert-seq">
              <Plus size={16} strokeWidth={1.5} />
              Séquence
            </button>
          )}
        </div>
      );
    return (
      <div className={s.gap} key={key}>
        <button type="button" aria-label="Insérer ici" onClick={() => setSlot(key)} data-gap={key} />
      </div>
    );
  };

  const row = (id: ID, seqId: ID, k: number, state?: 'lifted' | 'hidden' | 'hole', top?: number) => {
    const sh = doc.shots[id];
    const focal = focalLabel(sh.focal);
    const lifted = state === 'lifted';
    return (
      <div
        key={lifted ? 'lifted' : id}
        className={[s.lrow, id === current ? s.on : '', lifted ? s.lifted : '', state === 'hidden' ? s.hidden : '', state === 'hole' ? s.asHole : ''].join(' ')}
        style={lifted ? { top } : undefined}
        data-drop-shot={state ? undefined : id}
        data-row={lifted ? undefined : id}
      >
        <button type="button" className={s.main} onClick={() => onOpen(id)} data-testid="mobile-list-shot" disabled={!!drag}>
          <span className={s.n}>{shotCode(doc, id)}</span>
          <span className={s.t}>
            {sh.subject || sh.value ? (
              <>
                {sh.subject}
                {sh.subject && sh.value && <i> — </i>}
                {sh.value}
              </>
            ) : (
              <i>—</i>
            )}
            {focal && <span>{focal}</span>}
          </span>
        </button>
        {!readOnly && (
          <span className={s.g} {...(state ? {} : grip(id, seqId, k))} aria-label={`Déplacer le plan ${shotCode(doc, id)}`} role="button" data-testid="mobile-grip">
            <Grip />
          </span>
        )}
      </div>
    );
  };

  const total = timing.totalSec;
  return (
    <div ref={root} className={[s.overview, drag ? s.dragging : ''].join(' ')} data-testid="mobile-overview-list" onClick={(e) => slot && !(e.target as HTMLElement).closest('[data-gap], [data-testid^="mobile-insert"]') && setSlot(null)}>
      <header className={s.ohead} data-view={readOnly || undefined}>
        <div>
          <h1>{doc.project.title || 'Vue d’ensemble'}</h1>
          <p>
            {ids.length} séquence{ids.length > 1 ? 's' : ''} · {nShots} plan{nShots > 1 ? 's' : ''}
            {total > 0 && ` · ${formatTc(Math.round(total))}`}
          </p>
        </div>
        {onClose && (
          <button type="button" className={s.btn} onClick={onClose} aria-label="Fermer la vue d’ensemble" data-testid="mobile-overview-close">
            <X size={22} strokeWidth={1.4} />
          </button>
        )}
      </header>
      {ids.length === 0 && !readOnly && (
        <button type="button" className={s.first} onClick={() => onAddSequence(0)} data-testid="mobile-first-seq">
          <Plus size={18} strokeWidth={1.4} /> Première séquence
        </button>
      )}
      <div className={s.list} data-view={readOnly || undefined}>
        {ids.map((seqId) => {
          const seq = doc.sequences[seqId];
          const shots = (seq?.shotIds ?? []).filter((id) => id !== drag?.id);
          const meta = [seq?.intExt, seq?.effect].filter(Boolean).join(' · ');
          // Tant que la rangée n'a pas quitté sa place, elle fait elle-même le creux (le doigt garde sa cible).
          const home = !!drag && drag.seqId === drag.from.seqId && drag.at === drag.from.at;
          const hole = drag && drag.seqId === seqId && !home ? drag.at : -1;
          return (
            <section key={seqId} data-mobile-seq={seqId}>
              <h2 className={[s.lseq, drag && drag.seqId === seqId ? s.target : ''].join(' ')} data-drop-seq={seqId}>
                <b>{sequenceNumber(doc, seqId)}</b>
                {seq?.label.trim() && (
                  <>
                    <span className={s.d}>·</span>
                    <span className={s.label}>{seq.label}</span>
                  </>
                )}
                {meta && <em>{meta}</em>}
              </h2>
              {shots.length > 0 && gap(seqId, 0, false)}
              {(seq?.shotIds ?? []).map((id) => {
                // La rangée soulevée reste dans la page, au même nœud (même structure) : le doigt qui la
                // tient garde sa cible. Tant qu'elle n'a pas quitté sa place, elle fait le creux.
                const lifted = id === drag?.id;
                const k = shots.indexOf(id);
                return (
                  <Fragment key={id}>
                    {!lifted && hole === k && <div className={s.hole} />}
                    {lifted ? row(id, seqId, -1, home ? 'hole' : 'hidden') : row(id, seqId, k)}
                    {!lifted && gap(seqId, k + 1, k === shots.length - 1)}
                  </Fragment>
                );
              })}
              {hole === shots.length && <div className={s.hole} />}
              {/* Séquence sans plan : son texte, et le « + » à la place du numéro. */}
              {!shots.length && hole < 0 && (
                <button
                  type="button"
                  className={s.lempty}
                  disabled={readOnly}
                  onClick={() => onAddShot(seqId, 0)}
                  aria-label={`Ajouter un plan à la séquence ${sequenceNumber(doc, seqId)}`}
                  data-testid="mobile-add-first-shot"
                  data-empty-seq={seqId}
                >
                  <span className={s.n}>{!readOnly && <Plus size={18} strokeWidth={1.4} />}</span>
                  {excerpts.get(seqId) && <span className={s.p}>{excerpts.get(seqId)}</span>}
                </button>
              )}
              {!shots.length && !drag && gap(seqId, 0, true, false)}
            </section>
          );
        })}
      </div>
      {drag && row(drag.id, drag.seqId, 0, 'lifted', drag.top)}
      {tools && <div className={s.tools}>{tools}</div>}
    </div>
  );
}
