import { decorLocation } from './locations';
import { dayItinerary, scheduleDays } from './schedule';
import { fold } from './text';
import type { ProjectDoc } from './types';

/**
 * Carte des lieux de tournage : adresses saisies (lieu de tournage des décors, adresses du jour dans
 * le plan de travail, hôpital le plus proche), géocodées par Nominatim. Les coordonnées sont gardées
 * dans le projet avec l'adresse géocodée : une adresse n'est recherchée qu'une fois.
 */

/** Résultat du géocodage d'une adresse (introuvable : `missing`). */
export interface GeocodeEntry {
  address: string;
  lat?: number;
  lon?: number;
  missing?: true;
}

export type PlaceKind = 'lieu' | 'hopital';

export interface MapPlace {
  /** Clé de l'adresse (voir `geoKey`), aussi clé du géocodage. */
  key: string;
  /** Adresse telle que saisie (nettoyée du téléphone pour l'hôpital). */
  address: string;
  kind: PlaceKind;
  /** Décors (ou nom du lieu, de l'hôpital) à cette adresse. */
  names: string[];
  /** Jours de tournage où le lieu sert, croissants ; vide = adresse d'un décor non planifié. */
  days: number[];
}

/** Clé d'une adresse : casse, accents, espaces, virgules et point final sans effet. */
export function geoKey(address: string): string {
  return fold(address)
    .replace(/[,;]/g, ' ')
    .replace(/[\s.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Adresse tirée d'un champ libre (« Nom, adresse, téléphone ») : numéros de téléphone retirés. */
export function cleanAddress(text: string): string {
  return text
    .replace(/(?<!\p{L})t[ée]l(?:[ée]phone)?\.?\s*:?\s*(?=[+(\d])/giu, '')
    .replace(/\+?\(?\d[\d\s.()/-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '' : m))
    .replace(/\s*[,;·–—-]\s*(?=[,;·–—-]|$)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;·–—-]+|[\s,;·–—-]+$/g, '')
    .trim();
}

const segments = (address: string) => address.split(',').map((x) => x.trim()).filter(Boolean);

/** Nom d'établissement en tête d'une adresse (« Hôpital X, 2 rue Y ») : un premier segment sans chiffre. */
export function leadingName(address: string): string | undefined {
  const parts = segments(address);
  return parts.length > 1 && /^\D+$/.test(parts[0]) ? parts[0] : undefined;
}

/**
 * Requêtes à essayer pour une adresse, dans l'ordre : l'adresse entière, puis, pour un hôpital saisi
 * avec son nom en tête et suivi d'une adresse numérotée (« Hôpital X, 2 rue Y, Paris »), l'adresse
 * sans ce nom. Jamais la ville seule : un hôpital sans nom dont la rue est introuvable reste introuvable.
 */
export function geocodeQueries(place: Pick<MapPlace, 'address' | 'kind'>): string[] {
  const out = [place.address];
  const parts = segments(place.address);
  if (place.kind === 'hopital' && parts.length > 2 && leadingName(place.address) && /\d/.test(parts[1])) out.push(parts.slice(1).join(', '));
  return out;
}

/** Lieux à montrer sur la carte : un par adresse, avec ses décors et ses jours. */
export function mapPlaces(doc: ProjectDoc): MapPlace[] {
  const byKey = new Map<string, MapPlace>();
  const add = (address: string, kind: PlaceKind, name: string | undefined, day?: number) => {
    const text = address.trim();
    const key = text ? geoKey(text) : '';
    if (!key) return;
    // Même adresse pour un décor et l'hôpital : deux repères distincts.
    const id = kind === 'hopital' ? `h:${key}` : key;
    const p = byKey.get(id) ?? { key, address: text, kind, names: [], days: [] };
    if (name && !p.names.includes(name)) p.names.push(name);
    if (day !== undefined && !p.days.includes(day)) p.days.push(day);
    byKey.set(id, p);
  };
  for (const d of scheduleDays(doc)) {
    for (const stop of dayItinerary(doc, d.n)) {
      const decor = stop.decorId ? doc.decors[stop.decorId] : undefined;
      add(stop.address, 'lieu', decorLocation(decor).name ?? decor?.name, d.n);
    }
    if (d.hospital?.trim()) {
      const address = cleanAddress(d.hospital);
      add(address, 'hopital', leadingName(address) ?? 'Hôpital', d.n);
    }
  }
  // Décors dont le lieu de tournage est connu mais qui ne sont pas encore planifiés.
  for (const decor of Object.values(doc.decors)) {
    const loc = decorLocation(decor);
    if (loc.address) add(loc.address, 'lieu', loc.name ?? decor.name);
  }
  const first = (p: MapPlace) => (p.days.length ? Math.min(...p.days) : Infinity);
  return [...byKey.values()]
    .map((p) => ({ ...p, days: [...p.days].sort((a, b) => a - b) }))
    .sort((a, b) => first(a) - first(b) || Number(a.kind === 'hopital') - Number(b.kind === 'hopital'));
}

/** Lieux d'un jour, dans l'ordre de la journée (hôpital en dernier). */
export function dayPlaces(places: readonly MapPlace[], doc: ProjectDoc, day: number): MapPlace[] {
  const order = dayItinerary(doc, day).map((s) => geoKey(s.address));
  const rank = (p: MapPlace) => (p.kind === 'hopital' ? Infinity : order.indexOf(p.key));
  return places.filter((p) => p.days.includes(day)).sort((a, b) => rank(a) - rank(b));
}

/** Libellé d'un repère : jours (« 1·3 »), le jour choisi, ou « H » pour l'hôpital. */
export function markerLabel(place: MapPlace, day?: number): string {
  if (place.kind === 'hopital') return 'H';
  if (day !== undefined && place.days.includes(day)) return String(day);
  const d = place.days;
  if (d.length <= 3) return d.join('·');
  return `${d[0]}·…·${d[d.length - 1]}`;
}

/** Coordonnées connues d'un lieu (projet d'abord, puis résultats de la session). */
export function placeCoords(entry: GeocodeEntry | undefined): { lat: number; lon: number } | undefined {
  return entry && !entry.missing && Number.isFinite(entry.lat) && Number.isFinite(entry.lon) ? { lat: entry.lat!, lon: entry.lon! } : undefined;
}

/** Adresse de recherche Nominatim (un seul résultat). */
export const nominatimUrl = (query: string) => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;

/** Première réponse de Nominatim, ou `null` si l'adresse est introuvable ou la réponse illisible. */
export function parseNominatim(json: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(json) || !json.length) return null;
  const r = json[0] as { lat?: unknown; lon?: unknown };
  const lat = Number(r?.lat);
  const lon = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Lien d'itinéraire OpenStreetMap vers un lieu (recherche de l'adresse tant qu'il n'est pas géocodé). */
export function routeUrl(address: string, entry?: GeocodeEntry): string {
  const at = placeCoords(entry);
  if (!at) return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}`;
  const ll = `${round(at.lat)},${round(at.lon)}`;
  return `https://www.openstreetmap.org/directions?route=${encodeURIComponent(`;${ll}`)}#map=16/${round(at.lat)}/${round(at.lon)}`;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Clés de toutes les adresses saisies dans le projet, qu'elles servent ou non dans la version courante
 * (une séquence absente de cette version garde son adresse du jour) : leur géocodage est conservé.
 */
export function addressKeys(doc: ProjectDoc): Set<string> {
  const out = new Set<string>();
  const add = (text: string | undefined) => {
    const k = text?.trim() ? geoKey(text) : '';
    if (k) out.add(k);
  };
  for (const d of doc.schedule?.days ?? []) {
    for (const a of Object.values(d.seqAddresses ?? {})) add(a);
    for (const a of Object.values(d.addresses ?? {})) add(a);
    if (d.hospital?.trim()) add(cleanAddress(d.hospital));
  }
  for (const decor of Object.values(doc.decors)) add(decorLocation(decor).address);
  return out;
}

/** Géocodage connu d'une adresse dans le projet. */
export const storedGeocode = (doc: ProjectDoc, address: string): GeocodeEntry | undefined => doc.geocodes?.[geoKey(cleanAddress(address))] ?? doc.geocodes?.[geoKey(address)];

/**
 * Garde un résultat dans le projet, s'il porte encore sur une adresse du projet ; les résultats
 * d'adresses disparues sont retirés au passage (ils seraient recherchés de nouveau au besoin).
 */
export function setGeocode(doc: ProjectDoc, key: string, entry: GeocodeEntry): void {
  const keys = addressKeys(doc);
  if (!keys.has(key)) return;
  const clean: GeocodeEntry = entry.missing ? { address: entry.address, missing: true } : { address: entry.address, lat: round(entry.lat!), lon: round(entry.lon!) };
  const cur = doc.geocodes ?? {};
  const stale = Object.keys(cur).filter((k) => !keys.has(k));
  if (!stale.length && cur[key] && JSON.stringify(cur[key]) === JSON.stringify(clean)) return;
  const store = (doc.geocodes ??= {});
  for (const k of stale) delete store[k];
  store[key] = clean;
}

/** Titre d'un lieu : ses décors (ou le nom de l'hôpital), à défaut sa nature. */
export const placeTitle = (p: MapPlace) => p.names.join(', ') || (p.kind === 'hopital' ? 'Hôpital' : 'Lieu de tournage');

/** Repères d'une journée, numérotés dans l'ordre de la journée ; l'hôpital garde « H ». */
export function dayLabels(today: readonly MapPlace[]): Map<MapPlace, string> {
  const out = new Map<MapPlace, string>();
  let i = 0;
  for (const p of today) out.set(p, p.kind === 'hopital' ? 'H' : String(++i));
  return out;
}

/** Tuile OpenStreetMap à poser sur une image : position de son coin haut gauche dans l'image. */
export interface FrameTile {
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

export interface StaticFrame {
  zoom: number;
  tiles: FrameTile[];
  /** Position d'un point dans l'image, en pixels. */
  at: (lat: number, lon: number) => { x: number; y: number };
}

export const TILE_SIZE = 256;

/** Projection de Mercator (celle des tuiles), en pixels du monde au zoom donné. */
export function mercator(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}

/**
 * Cadrage d'une carte statique (export de la feuille de service) : le zoom entier le plus fort qui
 * fait tenir tous les points dans l'image, marge comprise (15 au plus, comme à l'écran), et les tuiles
 * qui la couvrent.
 */
export function staticMapFrame(points: ReadonlyArray<{ lat: number; lon: number }>, width: number, height: number, { padding = 28, maxZoom = 15, minZoom = 2 } = {}): StaticFrame | undefined {
  if (!points.length) return undefined;
  const spread = (z: number) => {
    const px = points.map((p) => mercator(p.lat, p.lon, z));
    const xs = px.map((p) => p.x);
    const ys = px.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  let zoom = maxZoom;
  for (; zoom > minZoom; zoom--) {
    const b = spread(zoom);
    if (b.x1 - b.x0 <= width - 2 * padding && b.y1 - b.y0 <= height - 2 * padding) break;
  }
  const b = spread(zoom);
  const ox = (b.x0 + b.x1) / 2 - width / 2;
  const oy = (b.y0 + b.y1) / 2 - height / 2;
  const n = 2 ** zoom;
  const tiles: FrameTile[] = [];
  for (let ty = Math.floor(oy / TILE_SIZE); ty <= Math.floor((oy + height - 1) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(ox / TILE_SIZE); tx <= Math.floor((ox + width - 1) / TILE_SIZE); tx++) {
      tiles.push({ z: zoom, x: ((tx % n) + n) % n, y: ty, left: tx * TILE_SIZE - ox, top: ty * TILE_SIZE - oy });
    }
  }
  return {
    zoom,
    tiles,
    at: (lat, lon) => {
      const p = mercator(lat, lon, zoom);
      return { x: p.x - ox, y: p.y - oy };
    },
  };
}
