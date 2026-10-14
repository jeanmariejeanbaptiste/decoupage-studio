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
  { n: 2, label: 'Scénario', route: 'scenario', available: false },
  { n: 3, label: 'Dépouillement', route: 'breakdown', available: false },
  { n: 4, label: 'Découpage technique', route: 'grid', available: true },
  { n: 5, label: 'Storyboard', route: 'storyboard', available: false },
  { n: 6, label: 'Plan au sol', route: 'floorplan', available: false },
  { n: 7, label: 'Listes de matériel', route: 'equipment', available: true },
  { n: 8, label: 'Plan de travail', route: 'schedule', available: false },
  { n: 9, label: 'Feuille de service', route: 'callsheet', available: false },
  { n: 10, label: 'Exporter', route: 'export', available: true },
];
