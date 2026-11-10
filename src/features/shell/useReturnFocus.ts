import { useEffect, useState } from 'react';

/**
 * Origine d'une fenêtre fermée parce qu'une autre la remplace (l'aide, puis ⌘K) : la suivante la
 * reprend, sans quoi elle reviendrait au bouton disparu de la première.
 */
let handedOver: HTMLElement | null = null;

/**
 * Fenêtre passagère (palette, aide) : à sa fermeture, le focus revient à l'élément qui l'avait avant
 * (la grille garde ainsi son clavier). Mettre `active` à false quand une commande emmène ailleurs.
 */
export function useReturnFocus() {
  // Lu au premier rendu, avant que la fenêtre ne prenne le focus.
  const [origin] = useState(() => ({ current: typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null) }));
  // Objet stable (pas une référence DOM) : `restore.active = false` est lu à la fermeture.
  const [restore] = useState(() => ({ active: true }));
  useEffect(() => {
    // Ouverte à la place d'une autre fenêtre : son origine fait foi.
    if (handedOver && !origin.current?.isConnected) origin.current = handedOver;
    handedOver = null;
    return () => {
      const el = origin.current;
      if (!restore.active || !el || el === document.body || !el.isConnected) return;
      // Une autre fenêtre a pris le focus : elle reprendra cette origine.
      const now = document.activeElement;
      if (now && now !== document.body && now.isConnected) {
        handedOver = el;
        return;
      }
      el.focus({ preventScroll: true });
    };
  }, [origin, restore]);
  return restore;
}
