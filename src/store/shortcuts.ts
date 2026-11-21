import { create } from 'zustand';
import { DEFAULT_SHORTCUTS, formatCombo, matchesCombo, resolveShortcuts, type KeyLike, type ShortcutId, type ShortcutMap } from '../domain/shortcuts';

/** Raccourcis de l'utilisateur : propres à ce navigateur, communs à tous les projets. */
const KEY = 'ds-shortcuts';

function load(): ShortcutMap {
  try {
    return resolveShortcuts(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function persist(map: ShortcutMap) {
  const diff = Object.fromEntries(Object.entries(map).filter(([k, v]) => DEFAULT_SHORTCUTS[k as ShortcutId] !== v));
  try {
    if (Object.keys(diff).length) localStorage.setItem(KEY, JSON.stringify(diff));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : valable pour la session */
  }
}

export const useShortcuts = create<{ map: ShortcutMap }>(() => ({ map: load() }));

export function setShortcut(id: ShortcutId, combo: string) {
  const map = { ...useShortcuts.getState().map, [id]: combo };
  useShortcuts.setState({ map });
  persist(map);
}

export function resetShortcuts(id?: ShortcutId) {
  const map = id ? { ...useShortcuts.getState().map, [id]: DEFAULT_SHORTCUTS[id] } : { ...DEFAULT_SHORTCUTS };
  useShortcuts.setState({ map });
  persist(map);
}

/** Raccourcis réglés dans un autre onglet : repris ici (sans quoi le prochain réglage d'ici les effacerait). */
export function startShortcutSync(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) useShortcuts.setState({ map: load() });
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** L'évènement correspond-il au raccourci (tel que l'utilisateur l'a réglé) ? */
export const isShortcut = (e: KeyLike, id: ShortcutId) => matchesCombo(e, useShortcuts.getState().map[id]);

/** Libellé du raccourci, réactif. */
export const useShortcutLabel = (id: ShortcutId) => useShortcuts((s) => formatCombo(s.map[id]));
export const shortcutLabel = (id: ShortcutId) => formatCombo(useShortcuts.getState().map[id]);
