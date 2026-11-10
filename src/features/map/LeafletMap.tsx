import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';

/** Repère d'une carte : position, libellé court, infobulle (lieu et adresse), mise en avant. */
export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  label: string;
  title: string;
  address: string;
  /** `on` : lieu du jour choisi ; `off` : autres lieux, estompés ; `free` : décor non planifié. */
  tone: 'normal' | 'on' | 'off' | 'free';
  hospital?: boolean;
}

interface Props {
  points: readonly MapPoint[];
  /** Signature du cadrage : quand elle change, la carte se recadre sur les repères mis en avant. */
  fit: string;
  /** Repère à montrer (infobulle ouverte). */
  focus?: string;
  /** Tuiles OpenStreetMap (jamais hors ligne). */
  tiles: boolean;
  onPick?: (id: string) => void;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

function tip(p: MapPoint): HTMLElement {
  const el = document.createElement('div');
  const b = document.createElement('strong');
  b.textContent = p.title;
  const a = document.createElement('span');
  a.textContent = p.address;
  el.append(b, a);
  return el;
}

function icon(p: MapPoint): L.DivIcon {
  const w = p.label ? Math.max(22, 10 + p.label.length * 7) : 12;
  const h = p.label ? 22 : 12;
  const el = document.createElement('span');
  el.textContent = p.label;
  return L.divIcon({
    className: ['ds-pin', `ds-pin--${p.tone}`, p.hospital ? 'ds-pin--h' : ''].join(' '),
    html: el,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
    tooltipAnchor: [0, -h / 2],
  });
}

/** Carte Leaflet (chargée à la demande) : tuiles en niveaux de gris, repères numérotés. */
export default function LeafletMap({ points, fit, focus, tiles, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const pick = useRef(onPick);
  pick.current = onPick;
  // Repères recréés seulement s'ils changent (pas à chaque modification du projet) : l'infobulle ouverte reste.
  const sig = JSON.stringify(points);

  useEffect(() => {
    const m = L.map(el.current!, { center: [46.6, 2.4], zoom: 5, scrollWheelZoom: false, attributionControl: true, zoomSnap: 0.5 });
    m.attributionControl.setPrefix(false);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tiles || !map.current) return;
    const t = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map.current);
    return () => void t.remove();
  }, [tiles]);

  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    markers.current.clear();
    for (const p of points) {
      const mk = L.marker([p.lat, p.lon], { icon: icon(p), keyboard: true, riseOnHover: true, zIndexOffset: p.tone === 'on' ? 1000 : p.tone === 'off' || p.tone === 'free' ? -1000 : 0, alt: p.title });
      mk.bindTooltip(tip(p), { direction: 'top', className: 'ds-tip', offset: [0, -2] });
      mk.on('click', () => pick.current?.(p.id));
      mk.addTo(group);
      markers.current.set(p.id, mk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const on = points.filter((p) => p.tone === 'on');
    const set = on.length ? on : points;
    if (!set.length) return;
    m.invalidateSize();
    if (set.length === 1) m.setView([set[0].lat, set[0].lon], 15, { animate: false });
    else m.fitBounds(L.latLngBounds(set.map((p) => [p.lat, p.lon] as [number, number])), { padding: [36, 36], maxZoom: 15, animate: false });
    // Recadrage seulement quand la signature change (jour choisi, lieux géocodés).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  useEffect(() => {
    const mk = focus ? markers.current.get(focus) : undefined;
    if (!mk || !map.current) return;
    map.current.panTo(mk.getLatLng());
    mk.openTooltip();
  }, [focus, sig]);

  return <div ref={el} className="ds-map" data-testid="map" />;
}
