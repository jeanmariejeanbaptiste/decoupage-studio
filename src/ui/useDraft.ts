import { useCallback, useEffect, useRef, useState } from 'react';
import { registerFlush } from '../store/persistence';

/**
 * Texte saisi localement puis appliqué au projet : après une pause, en quittant le champ ou la page,
 * et avant tout enregistrement (⌘S, export, changement de projet). Une modification venue d'ailleurs
 * (annuler, autre participant, autre page) est reprise dès qu'on n'est pas en train d'écrire.
 */
export function useDraft(external: string, commit: (v: string) => void, delay = 500): [string, (v: string) => void, () => void] {
  const [draft, setDraftState] = useState(external);
  const committed = useRef(external);
  const latest = useRef(external);
  const dirty = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (external === committed.current) return;
    committed.current = external;
    if (!dirty.current) {
      latest.current = external;
      setDraftState(external);
    }
  }, [external]);

  const flush = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    if (latest.current === committed.current) return;
    committed.current = latest.current;
    commitRef.current(latest.current);
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(flush, delay);
    return () => clearTimeout(t);
  }, [draft, delay, flush]);

  useEffect(() => {
    const off = registerFlush(flush);
    return () => {
      off();
      flush();
    };
  }, [flush]);

  const setDraft = useCallback((v: string) => {
    dirty.current = true;
    latest.current = v;
    setDraftState(v);
  }, []);

  return [draft, setDraft, flush];
}
