import { create } from 'zustand';

/** État d'écran du Séquencier, partagé par la barre d'outils et la vue (jamais dans le projet). */
export type OutlineMode = 'list' | 'plots';

export type OutlineEditing =
  | { n: number; field: 'phrase' | 'heading' }
  /** Intertitre, par sa position dans le texte. */
  | { part: number; field: 'part' }
  | null;

interface OutlineUi {
  mode: OutlineMode;
  /** Intrigues décochées dans le filtre (toutes cochées par défaut ; une nouvelle l'est d'office). */
  hidden: string[];
  /** Ligne active (numéro de séquence). */
  active: number | null;
  editing: OutlineEditing;
  /** Ligne d'ajout ouverte sous la séquence N (⇧Entrée, « Insérer une séquence après »). */
  insertAfter: number | null;
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* choix valable pour la session */
  }
};

export const savedOutlineMode = (): OutlineMode => (read('ds-outline-view') === 'plots' ? 'plots' : 'list');

function savedHidden(): string[] {
  try {
    const v = JSON.parse(read('ds-outline-plots') ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const useOutlineUi = create<OutlineUi>(() => ({
  mode: savedOutlineMode(),
  hidden: savedHidden(),
  active: null,
  editing: null,
  insertAfter: null,
}));

export function setOutlineMode(mode: OutlineMode) {
  useOutlineUi.setState({ mode });
  write('ds-outline-view', mode);
}

export function togglePlot(key: string) {
  const hidden = useOutlineUi.getState().hidden;
  const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
  useOutlineUi.setState({ hidden: next });
  write('ds-outline-plots', JSON.stringify(next));
}

/** Intrigues cochées dans le filtre, parmi `keys` (pour l'export Par intrigue). */
export const checkedPlots = (keys: readonly string[]): string[] => keys.filter((k) => !useOutlineUi.getState().hidden.includes(k));

export const setActive = (active: number | null) => useOutlineUi.setState({ active });
export const setEditing = (editing: OutlineEditing) => useOutlineUi.setState({ editing });
export const setInsertAfter = (insertAfter: number | null) => useOutlineUi.setState({ insertAfter });
