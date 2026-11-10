import { useCallback, useEffect, useRef, useState } from 'react';
import { parseEstimate, sequenceProgress, setSequenceEstimate } from '../../domain/registry';
import { formatTc } from '../../domain/timecode';
import { formatGap, type Timing } from '../../domain/timing';
import type { ID, ProjectDoc } from '../../domain/types';
import { registerFlush } from '../../store/persistence';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import s from './SeqMeta.module.css';

/**
 * Durée estimée d'une séquence, modifiable sur place, puis en gris l'écart avec la durée calculée et
 * l'avancement du tournage (dès qu'un plan est tourné). Sous INT / EXT et l'effet, dans la grille et
 * sur téléphone.
 */
export function SeqTiming({ doc, seqId, timing, readOnly, className }: { doc: ProjectDoc; seqId: ID; timing: Timing; readOnly?: boolean; className?: string }) {
  const seq = doc.sequences[seqId];
  if (!seq) return null;
  const gap = timing.sequences.get(seqId)?.gap;
  const p = sequenceProgress(doc, seqId);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  if (readOnly && seq.estimatedSec === undefined && !p.done) return null;
  return (
    <span className={[s.meta, s.timing, className ?? ''].join(' ')} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onKeyDown={stop} data-testid="seq-timing">
      {readOnly ? (
        seq.estimatedSec !== undefined && <span>estimée {formatTc(seq.estimatedSec)}</span>
      ) : (
        <EstimateInput seqId={seqId} value={seq.estimatedSec !== undefined ? formatTc(seq.estimatedSec) : ''} />
      )}
      {gap && (
        <span title="Écart entre durée calculée et durée estimée" data-testid="seq-gap">
          écart {formatGap(gap)}
        </span>
      )}
      {p.done > 0 && (
        <span title={`${p.done} plan${p.done > 1 ? 's' : ''} tourné${p.done > 1 ? 's' : ''} sur ${p.total}`} data-testid="seq-progress">
          {p.done}/{p.total} tourné{p.done > 1 ? 's' : ''}
        </span>
      )}
    </span>
  );
}

const PLACEHOLDER = 'Durée ?';

/**
 * Saisie de la durée estimée (« 1:30 », « 90s ») : appliquée en quittant le champ, avec Entrée, ou
 * avant un enregistrement ; Échap rend la valeur d'avant. Ce qui n'est pas une durée est refusé.
 */
function EstimateInput({ seqId, value }: { seqId: ID; value: string }) {
  const [draft, setDraftState] = useState(value);
  const [bad, setBad] = useState(false);
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;
  const setDraft = (v: string) => {
    draftRef.current = v;
    setDraftState(v);
    setBad(false);
  };
  useEffect(() => {
    draftRef.current = value;
    setDraftState(value);
    setBad(false);
  }, [value]);
  const commit = useCallback(() => {
    const v = draftRef.current;
    if (v === valueRef.current) return;
    if (parseEstimate(v) === null) {
      setBad(true);
      return;
    }
    valueRef.current = v;
    mutateDoc((d) => void setSequenceEstimate(d, seqId, v));
  }, [seqId]);
  useEffect(() => {
    // Le projet ouvert au montage : une saisie ne doit jamais aller dans un autre projet.
    const project = useProjectStore.getState().doc?.project.id;
    const off = registerFlush(commit);
    return () => {
      off();
      if (useProjectStore.getState().doc?.project.id === project) commit();
    };
  }, [commit]);
  return (
    <label className={s.est}>
      {(value || draft) && <span>estimée</span>}
      <input
        value={draft}
        placeholder={PLACEHOLDER}
        aria-label="Durée estimée"
        aria-invalid={bad || undefined}
        title={bad ? 'Durée non reconnue : 1:30, 90s, 1m30' : undefined}
        style={{ width: `calc(${Math.max(draft.length, draft ? 3 : PLACEHOLDER.length)}ch + 0.6em)` }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          commit();
          // Saisie refusée : la valeur d'avant revient en quittant le champ.
          if (parseEstimate(draftRef.current) === null) setDraft(valueRef.current);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'Escape') return;
          e.preventDefault();
          if (e.key === 'Escape') setDraft(valueRef.current);
          // Dans la grille, le clavier y revient (comme après la saisie d'une cellule).
          const el = e.currentTarget;
          const grid = el.closest<HTMLElement>('[data-testid="grid"]');
          requestAnimationFrame(() => (grid ? grid.focus({ preventScroll: true }) : el.blur()));
        }}
        data-seq-estimate={seqId}
      />
    </label>
  );
}
