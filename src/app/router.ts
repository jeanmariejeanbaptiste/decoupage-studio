import { useMemo, useSyncExternalStore } from 'react';

export type Route =
  | 'home'
  | 'intention'
  | 'scenario'
  | 'breakdown'
  | 'grid'
  | 'storyboard'
  | 'floorplan'
  | 'equipment'
  | 'schedule'
  | 'callsheet'
  | 'calendar'
  | 'production'
  | 'export'
  | 'registry'
  | 'checks'
  | 'settings'
  | 'print'
  | 'join'
  | 'review'
  | 'view';

const ROUTES: readonly Route[] = [
  'home', 'intention', 'scenario', 'breakdown', 'grid', 'storyboard', 'floorplan', 'equipment',
  'schedule', 'callsheet', 'calendar', 'production', 'export', 'registry', 'checks', 'settings', 'print', 'join', 'review', 'view',
];

export interface Location { route: Route; params: URLSearchParams }

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  // Lien de relecture : #/review/<fichier>[~<clé>]
  if (path.startsWith('review/')) {
    params.set('file', path.slice('review/'.length));
    return { route: 'review', params };
  }
  // Lien autonome : #/view/<projet compressé>
  if (path.startsWith('view/')) {
    params.set('data', path.slice('view/'.length));
    return { route: 'view', params };
  }
  const route = (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'home';
  return { route, params };
}

export function navigate(route: Route, params?: Record<string, string>): void {
  const q = params ? `?${new URLSearchParams(params).toString()}` : '';
  window.location.hash = `#/${route}${q}`;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useLocation(): Location {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  // Même adresse, même objet : les effets qui dépendent des paramètres ne se relancent pas à chaque rendu.
  return useMemo(() => parseHash(hash), [hash]);
}

/** Sous-pages du Scénario, dans l'ordre du travail. */
export type ScenarioView = 'outline' | 'script' | 'cut' | 'stats';
export const SCENARIO_VIEWS: readonly ScenarioView[] = ['outline', 'script', 'cut', 'stats'];
export const isScenarioView = (v: string | null | undefined): v is ScenarioView => (SCENARIO_VIEWS as readonly string[]).includes(v ?? '');

/**
 * Lecture de `#/scenario?view=<v>[&seq=N][&report=<r>]`. `?seq=N` sans `view` mène au texte
 * (liens d'avant les sous-pages, comparaison des versions).
 */
export function scenarioLocation(params: URLSearchParams): { view?: ScenarioView; seq?: number; report?: string } {
  const v = params.get('view');
  const n = Math.floor(Number(params.get('seq')));
  const seq = n > 0 ? n : undefined;
  const view = isScenarioView(v) ? v : seq ? 'script' : undefined;
  return { view, seq, report: params.get('report') ?? undefined };
}

/** Adresse d'une sous-page du Scénario. */
export function scenarioHref(view: ScenarioView, extra: { seq?: number; report?: string } = {}): string {
  const q = new URLSearchParams({ view });
  if (extra.seq) q.set('seq', String(extra.seq));
  if (extra.report) q.set('report', extra.report);
  return `#/scenario?${q.toString()}`;
}
