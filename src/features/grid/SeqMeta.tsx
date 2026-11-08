import { useEffect, useState } from 'react';
import type { Effect, ID, IntExt, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import s from './SeqMeta.module.css';

/** Largeur au plus juste d'une liste : `field-sizing` (Chrome) sinon calculée (Safari, Firefox). */
const sizing = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
const fit = (label: string): React.CSSProperties | undefined => (sizing ? undefined : { width: `calc(${label.length}ch + 0.6em)` });

const INT_EXT: IntExt[] = ['INT', 'EXT', 'INT/EXT'];
const EFFECTS: Effect[] = ['JOUR', 'NUIT', 'AUBE', 'CRÉPUSCULE'];

/**
 * INT / EXT et effet (jour, nuit…) d'une séquence, modifiables sur place : deux petits menus qui se
 * lisent comme du texte. Utilisé dans la grille et dans la vue téléphone.
 */
export function SeqMeta({ doc, seqId, readOnly, className }: { doc: ProjectDoc; seqId: ID; readOnly?: boolean; className?: string }) {
  const seq = doc.sequences[seqId];
  if (!seq) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span className={[s.meta, className ?? ''].join(' ')} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onKeyDown={stop}>
      <select
        value={seq.intExt ?? ''}
        disabled={readOnly}
        style={fit(seq.intExt ?? 'INT/EXT ?')}
        aria-label="Intérieur ou extérieur"
        onChange={(e) => mutateDoc((d) => void (d.sequences[seqId].intExt = (e.target.value || undefined) as IntExt | undefined))}
        data-testid="seq-intext"
      >
        <option value="">INT/EXT ?</option>
        {INT_EXT.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <span aria-hidden="true">·</span>
      <select
        value={seq.effect ?? ''}
        disabled={readOnly}
        style={fit(seq.effect ?? 'Effet ?')}
        aria-label="Effet"
        onChange={(e) => mutateDoc((d) => void (d.sequences[seqId].effect = (e.target.value || undefined) as Effect | undefined))}
        data-testid="seq-effect"
      >
        <option value="">Effet ?</option>
        {EFFECTS.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      {doc.project.format === 'institutionnel' && (
        <>
          <span aria-hidden="true">·</span>
          <SlotInput value={seq.slot ?? ''} readOnly={readOnly} onCommit={(v) => mutateDoc((d) => void (d.sequences[seqId].slot = v.trim() || undefined))} />
        </>
      )}
    </span>
  );
}

/** Créneau de tournage (B-roll institutionnel), saisi librement : « 10:30–11:00 ». */
function SlotInput({ value, readOnly, onCommit }: { value: string; readOnly?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={s.slot}
      value={draft}
      readOnly={readOnly}
      placeholder="Horaire ?"
      aria-label="Créneau de tournage"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      data-testid="seq-slot"
    />
  );
}
