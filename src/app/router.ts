import { useSyncExternalStore } from 'react';

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
  | 'export'
  | 'registry'
  | 'checks'
  | 'settings'
  | 'print';

const ROUTES: readonly Route[] = [
  'home', 'intention', 'scenario', 'breakdown', 'grid', 'storyboard', 'floorplan', 'equipment',
  'schedule', 'callsheet', 'export', 'registry', 'checks', 'settings', 'print',
];

export interface Location { route: Route; params: URLSearchParams }

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const route = (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'home';
  return { route, params: new URLSearchParams(query) };
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
  return parseHash(hash);
}
