import { useCallback, useEffect, useRef, useState } from 'react';
import { registerFlush } from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';
import s from './Facts.module.css';

/**
 * Champ d'une fiche saisi d'un trait : appliqué en quittant le champ (une seule étape d'annulation),
 * avec Entrée, avant un enregistrement ou quand il disparaît ; Échap rend la valeur d'avant.
 */
export function CommitField({ label, value, onCommit, readOnly, placeholder }: { label: string; value: string; onCommit: (v: string) => void; readOnly?: boolean; placeholder?: string }) {
  const [draft, setDraftState] = useState(value);
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const setDraft = (v: string) => {
    draftRef.current = v;
    setDraftState(v);
  };
  useEffect(() => {
    draftRef.current = value;
    setDraftState(value);
  }, [value]);
  const commit = useCallback(() => {
    if (readOnly || draftRef.current === valueRef.current) return;
    valueRef.current = draftRef.current;
    commitRef.current(draftRef.current);
  }, [readOnly]);
  useEffect(() => {
    // Le projet ouvert au montage : une saisie ne va jamais dans un autre projet.
    const project = useProjectStore.getState().doc?.project.id;
    const off = registerFlush(commit);
    return () => {
      off();
      if (useProjectStore.getState().doc?.project.id === project) commit();
    };
  }, [commit]);
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input
        value={draft}
        readOnly={readOnly}
        placeholder={readOnly ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(valueRef.current);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
