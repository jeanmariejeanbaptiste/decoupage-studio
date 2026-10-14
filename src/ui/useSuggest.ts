import { useMemo, useState, type KeyboardEvent } from 'react';
import type { Suggestion } from './SuggestList';

/**
 * Navigation clavier d'une liste de suggestions : ↑/↓ choisissent, Échap ferme.
 * Aucune suggestion n'est active par défaut : le texte libre reste toujours accepté.
 */
export function useSuggest(query: string, source: ((q: string) => Suggestion[]) | undefined) {
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActive(-1);
    setClosed(false);
  }
  const items = useMemo(() => (source && query.trim() ? source(query) : []), [source, query]);
  const open = !closed && items.length > 0;

  /** Renvoie `true` si la touche a été consommée par la liste. */
  function onKey(e: KeyboardEvent): boolean {
    if (!open) return false;
    if (e.key === 'ArrowDown') {
      setActive((a) => (a + 1) % items.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
      return true;
    }
    if (e.key === 'Escape') {
      setClosed(true);
      return true;
    }
    return false;
  }

  return {
    items: open ? items : [],
    active,
    setActive,
    picked: open && active >= 0 ? items[active] : undefined,
    close: () => setClosed(true),
    onKey,
  };
}
