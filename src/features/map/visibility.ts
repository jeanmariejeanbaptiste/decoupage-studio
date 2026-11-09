import { useSyncExternalStore } from 'react';

/** Carte des lieux affichée ou masquée : un seul réglage, retenu dans le navigateur. */
const KEY = 'ds-map';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

let visible = read();

export function setMapVisible(v: boolean): void {
  visible = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
  for (const l of listeners) l();
}

export function useMapVisible(): [boolean, () => void] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => visible,
  );
  return [v, () => setMapVisible(!v)];
}
