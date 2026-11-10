import { PREP_STEPS } from '../features/shell/steps';
import type { Route } from './router';

const APP_NAME = 'Découpage Studio';
const PAGE_TITLE: Partial<Record<Route, string>> = {
  ...Object.fromEntries(PREP_STEPS.map((p) => [p.route, p.label])),
  storyboard: 'Storyboard',
  production: 'Calendrier',
  registry: 'Registre',
  checks: 'Vérifications',
  export: 'Exporter',
  settings: 'Paramètres',
  review: 'Relecture',
  // Nom proposé pour « Enregistrer en PDF » depuis l'aperçu d'impression.
  print: 'Découpage',
};

/** Titre de l'onglet : le projet et sa page ; le nom de l'application seul à l'accueil. */
export function documentTitle(route: Route, projectTitle: string | undefined): string {
  const page = PAGE_TITLE[route];
  if (route === 'home' || !projectTitle?.trim() || !page) return APP_NAME;
  return `${projectTitle.trim()} — ${page}`;
}
