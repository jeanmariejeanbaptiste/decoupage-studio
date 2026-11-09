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
  | 'review';

const ROUTES: readonly Route[] = [
  'home', 'intention', 'scenario', 'breakdown', 'grid', 'storyboard', 'floorplan', 'equipment',
  'schedule', 'callsheet', 'calendar', 'production', 'export', 'registry', 'checks', 'settings', 'print', 'join', 'review',
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
