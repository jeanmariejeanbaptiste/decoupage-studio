import type { Route } from '../../app/router';

export interface PrepStep {
  n: number;
  label: string;
  route: Route;
  available: boolean;
}

/** Étapes de préparation, dans l'ordre réel de la production (§11). */
export const PREP_STEPS: readonly PrepStep[] = [
  { n: 1, label: "Note d'intention", route: 'intention', available: true },
  { n: 2, label: 'Scénario', route: 'scenario', available: true },
  { n: 3, label: 'Dépouillement', route: 'breakdown', available: true },
  // Tableau et storyboard : deux vues d'une même page ; de même, le calendrier porte la frise de production.
  { n: 4, label: 'Découpage technique', route: 'grid', available: true },
  { n: 5, label: 'Plan au sol', route: 'floorplan', available: true },
  { n: 6, label: 'Listes de matériel', route: 'equipment', available: true },
  { n: 7, label: 'Plan de travail', route: 'schedule', available: true },
  { n: 8, label: 'Feuille de service', route: 'callsheet', available: true },
  { n: 9, label: 'Calendrier', route: 'calendar', available: true },
];

/** Regroupement des étapes dans le menu : écrire, préparer, tourner. */
export const STEP_GROUPS: ReadonlyArray<{ label: string; steps: readonly number[] }> = [
  { label: 'Écriture', steps: [1, 2] },
  { label: 'Préparation', steps: [3, 4, 5, 6] },
  { label: 'Tournage', steps: [9, 7, 8] },
];

/** Pages publiées pour une relecture en ligne (le reste de la préparation reste privé). */
export const REVIEWED: ReadonlySet<Route> = new Set<Route>(['scenario', 'grid', 'storyboard']);
