import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { geocodeQueries, nominatimUrl, parseNominatim, setGeocode, type GeocodeEntry, type MapPlace } from '../domain/geo';
import type { ProjectDoc } from '../domain/types';
import { canMutate, mutateQuiet, useProjectStore } from './projectStore';

/**
 * Géocodage des adresses par Nominatim (OpenStreetMap) : une requête par seconde au plus, seulement
 * pour les cartes affichées, jamais hors ligne. Le résultat est gardé dans le projet (hors historique
 * d'annulation) ; un invité en lecture seule le garde le temps de la session.
 */

export type PlaceState = 'ok' | 'missing' | 'pending' | 'offline' | 'error';

const MIN_GAP = 1000;
const SETTLE = 800;
/** Réponse attendue au plus tant ; au-delà, le service est tenu pour indisponible. */
const TIMEOUT = 12_000;
/** Service indisponible : nouvel essai de l'adresse après ce délai (ou au retour en ligne). */
const RETRY = 60_000;
/** Trop de requêtes (429) : plus rien n'est demandé avant ce délai. */
const BACKOFF = 30_000;
const session = new Map<string, GeocodeEntry>();
const failed = new Set<string>();
/** Adresses demandées par les cartes affichées (clé → lieu), par carte. */
const owners = new Map<symbol, Map<string, MapPlace>>();
let busy = false;
let last = 0;
let version = 0;
const listeners = new Set<() => void>();

const notify = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function known(doc: ProjectDoc | null | undefined, key: string): GeocodeEntry | undefined {
  return doc?.geocodes?.[key] ?? session.get(key);
}

function nextWanted(doc: ProjectDoc | null): MapPlace | undefined {
  for (const m of owners.values()) for (const [key, p] of m) if (!known(doc, key) && !failed.has(key)) return p;
  return undefined;
}

const stillWanted = (key: string) => [...owners.values()].some((m) => m.has(key));

/** Recherche interrompue pendant l'attente (carte masquée, hors ligne) : rien n'est demandé. */
const STOPPED = Symbol('interrompu');

async function lookup(query: string, stillOk: () => boolean): Promise<{ lat: number; lon: number } | null | typeof STOPPED> {
  const wait = last + MIN_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  // L'attente peut durer (jusqu'à 30 s après un refus 429) : tout est revérifié avant d'envoyer.
  if (!stillOk()) return STOPPED;
  last = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(nominatimUrl(query), { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    // Service saturé : on espace franchement les requêtes suivantes.
    if (res.status === 429) last = Date.now() + BACKOFF;
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return parseNominatim(await res.json());
  } finally {
    clearTimeout(timer);
    last = Math.max(last, Date.now());
  }
}

/** Échec d'une adresse : signalé, puis retenté plus tard (jamais en boucle). */
function fail(key: string): void {
  failed.add(key);
  notify();
  setTimeout(() => {
    if (!failed.delete(key)) return;
    notify();
    void pump();
  }, RETRY);
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      if (!online()) break;
      const place = nextWanted(useProjectStore.getState().doc);
      if (!place) break;
      let entry: GeocodeEntry | undefined;
      try {
        const queries = geocodeQueries(place);
        const stillOk = () => stillWanted(place.key) && online();
        for (let i = 0; i < queries.length; i++) {
          if (!stillOk()) break;
          const hit = await lookup(queries[i], stillOk);
          if (hit === STOPPED) break;
          if (hit) entry = { address: place.address, ...hit };
          else if (i === queries.length - 1) entry = { address: place.address, missing: true };
          if (entry) break;
        }
      } catch {
        // Réseau ou service indisponible : rien n'est gardé, nouvel essai plus tard ou au retour en ligne.
        fail(place.key);
        continue;
      }
      // Recherche interrompue (carte masquée, hors ligne) : rien n'est conclu.
      if (!entry) continue;
      const found = entry;
      session.set(place.key, entry);
      if (canMutate()) mutateQuiet((d) => setGeocode(d, place.key, found));
      notify();
    }
  } finally {
    busy = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    failed.clear();
    notify();
    void pump();
  });
  window.addEventListener('offline', notify);
}

/** Une carte affichée demande ses lieux : les adresses inconnues sont recherchées ; rend la fonction de retrait. */
export function watchPlaces(places: readonly MapPlace[]): () => void {
  const id = Symbol('carte');
  owners.set(id, new Map(places.map((p) => [p.key, p])));
  void pump();
  return () => void owners.delete(id);
}

/**
 * Coordonnées des lieux d'une carte affichée ; lance la recherche des adresses inconnues tant que
 * `enabled` (carte visible). Rend l'état de chaque lieu et son géocodage connu.
 */
export function useGeocodes(doc: ProjectDoc, places: readonly MapPlace[], enabled: boolean) {
  const v = useSyncExternalStore(subscribe, () => version);
  const sig = places.map((p) => `${p.kind}:${p.key}`).join('|');
  useEffect(() => {
    if (!enabled) return;
    // Adresse en cours de frappe : rien n'est cherché avant une courte pause.
    let stop: (() => void) | undefined;
    const t = setTimeout(() => (stop = watchPlaces(places)), SETTLE);
    return () => {
      clearTimeout(t);
      stop?.();
    };
    // Les lieux sont repris par leur signature : un nouveau rendu sans changement d'adresse ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig]);
  return useMemo(() => {
    const isOnline = online();
    const entry = (p: MapPlace) => known(doc, p.key);
    const state = (p: MapPlace): PlaceState => {
      const e = entry(p);
      if (e) return e.missing ? 'missing' : 'ok';
      if (!isOnline) return 'offline';
      return failed.has(p.key) ? 'error' : 'pending';
    };
    return { entry, state, online: isOnline };
    // `v` : nouveaux résultats de la session, ou passage en ligne / hors ligne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.geocodes, v]);
}
