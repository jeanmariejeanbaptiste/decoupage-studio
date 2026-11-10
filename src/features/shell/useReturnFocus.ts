import { useEffect, useRef, useState } from 'react';

/**
 * Fenêtre passagère (palette, aide) : à sa fermeture, le focus revient à l'élément qui l'avait avant
 * (la grille garde ainsi son clavier). Mettre `current` à false quand une commande emmène ailleurs.
 */
export function useReturnFocus() {
  // Lu au premier rendu, avant que la fenêtre ne prenne le focus.
  const [origin] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  const restore = useRef(true);
  useEffect(
    () => () => {
      if (!restore.current || !origin || origin === document.body || !origin.isConnected) return;
      // Seulement si personne n'a pris le focus entre-temps.
      const now = document.activeElement;
      if (now && now !== document.body && now.isConnected) return;
      origin.focus({ preventScroll: true });
    },
    [origin],
  );
  return restore;
}
