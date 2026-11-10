import { create } from 'zustand';
import type { ID } from '../../domain/types';

/** Passage du scénario versé dans la cellule (positions dans le texte source). */
export interface PickedRange {
  start: number;
  end: number;
}

/**
 * Cellule Action en cours de saisie, prête à recevoir le texte choisi dans le lecteur du scénario
 * (panneau latéral du découpage). Seule une cellule ouverte en saisie s'inscrit : une simple
 * sélection de cellule ne capte rien.
 */
export interface CaptureTarget {
  shotId: ID;
  /** Verse le passage à l'emplacement du curseur et rend la main à la saisie. */
  insert: (text: string, range: PickedRange) => void;
  /** Rend la main à la saisie sans rien verser (clic dans le lecteur sans sélection). */
  refocus: () => void;
}

interface CaptureState {
  target: CaptureTarget | null;
  /**
   * Bouton enfoncé dans le lecteur : la saisie perd le focus le temps de la sélection, sans être
   * validée ni fermée.
   */
  holding: boolean;
  /** Lecteur du scénario ouvert à côté de la grille (panneau latéral, mode Lire). */
  reader: boolean;
}

export const useScriptCapture = create<CaptureState>(() => ({ target: null, holding: false, reader: false }));
