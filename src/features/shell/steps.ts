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
  { n: 4, label: 'Découpage technique', route: 'grid', available: true },
  { n: 5, label: 'Storyboard', route: 'storyboard', available: true },
  { n: 6, label: 'Plan au sol', route: 'floorplan', available: true },
  { n: 7, label: 'Listes de matériel', route: 'equipment', available: true },
  { n: 8, label: 'Plan de travail', route: 'schedule', available: true },
  { n: 9, label: 'Feuille de service', route: 'callsheet', available: true },
];

/** Regroupement des étapes dans le menu : écrire, préparer, tourner. */
export const STEP_GROUPS: ReadonlyArray<{ label: string; steps: readonly number[] }> = [
  { label: 'Écriture', steps: [1, 2] },
  { label: 'Préparation', steps: [3, 4, 5, 6, 7] },
  { label: 'Tournage', steps: [8, 9] },
];
