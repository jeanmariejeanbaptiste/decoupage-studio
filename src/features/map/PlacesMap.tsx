import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Route } from 'lucide-react';
import { dayLabels, dayPlaces, markerLabel, placeCoords, placeTitle, routeUrl, type MapPlace } from '../../domain/geo';
import type { ProjectDoc } from '../../domain/types';
import { useGeocodes, type PlaceState } from '../../store/geocoder';
import type { MapPoint } from './LeafletMap';
import s from './PlacesMap.module.css';

// Leaflet n'est chargé qu'à la première carte affichée ; hors ligne, sans module en cache, la carte attend.
let leafletReady = false;
const loadLeaflet = () =>
  import('./LeafletMap').then((m) => {
    leafletReady = true;
    return m;
  });
let LeafletMap = lazy(loadLeaflet);

/** Échec du chargement (hors ligne) : la liste reste, la carte sera retentée au retour en ligne. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    LeafletMap = lazy(loadLeaflet);
  }
  render() {
    return this.state.failed ? <div className={s.loading} /> : this.props.children;
  }
}

const placeId = (p: MapPlace) => `${p.kind}:${p.key}`;
/** Adresse affichée : sans le nom déjà donné en titre (« Hôpital X, 2 rue Y » → « 2 rue Y »). */
const placeAddress = (p: MapPlace) => {
  const name = p.names[0];
  return name && p.address.startsWith(`${name},`) ? p.address.slice(name.length + 1).trim() : p.address;
};

const STATE_TEXT: Partial<Record<PlaceState, string>> = {
  missing: 'introuvable',
  pending: 'recherche…',
  offline: 'hors ligne',
  error: 'service indisponible',
};

function Pin({ label, tone, hospital }: { label: string; tone: MapPoint['tone']; hospital?: boolean }) {
  return <span className={[s.pin, s[tone], hospital ? s.h : ''].filter(Boolean).join(' ')}>{label}</span>;
}

function MapView({ points, fit, focus, tiles, onPick, className }: { points: MapPoint[]; fit: string; focus?: string; tiles: boolean; onPick?: (id: string) => void; className: string }) {
  return (
    <div className={className}>
      {!tiles && !leafletReady ? (
        <div className={s.loading} />
      ) : (
        <MapBoundary key={String(tiles)}>
          <Suspense fallback={<div className={s.loading} />}>
            <LeafletMap points={points} fit={fit} focus={focus} tiles={tiles} onPick={onPick} />
          </Suspense>
        </MapBoundary>
      )}
    </div>
  );
}

/** Ligne d'un lieu : repère, décor, adresse, état du géocodage, lien d'itinéraire. */
function PlaceRow({ place, label, tone, state, route, active, onClick }: { place: MapPlace; label: string; tone: MapPoint['tone']; state: PlaceState; route: string; active: boolean; onClick: () => void }) {
  const note = STATE_TEXT[state];
  return (
    <li className={[s.row, active ? s.active : '', state === 'missing' ? s.missing : ''].join(' ')} data-testid="map-place" data-state={state}>
      <button type="button" className={s.rowMain} onClick={onClick} disabled={state !== 'ok'}>
        <Pin label={label} tone={tone} hospital={place.kind === 'hopital'} />
        <span className={s.rowText}>
          <span className={s.rowTitle}>{placeTitle(place)}</span>
          <span className={s.rowAddr}>
            {placeAddress(place)}
            {note && <em className={s.state}> · {note}</em>}
          </span>
        </span>
      </button>
      <a className={s.route} href={route} target="_blank" rel="noreferrer" aria-label={`Itinéraire : ${placeTitle(place)}`} title="Itinéraire">
        <Route size={14} strokeWidth={1.25} />
      </a>
    </li>
  );
}

/** Carte du plan de travail : tous les lieux, repères numérotés par jour ; un jour choisi met ses lieux en avant. */
export function ScheduleMap({ doc, places, days }: { doc: ProjectDoc; places: MapPlace[]; days: number[] }) {
  const geo = useGeocodes(doc, places, true);
  const [picked, setPicked] = useState<number | undefined>();
  const [focus, setFocus] = useState<string>();
  // Jours qui ont au moins un lieu ; le choix disparu (jour supprimé) revient à « Tous ».
  const withPlaces = days.filter((n) => places.some((p) => p.days.includes(n)));
  const day = picked !== undefined && withPlaces.includes(picked) ? picked : undefined;
  const tone = (p: MapPlace): MapPoint['tone'] => (day === undefined ? (p.days.length ? 'normal' : 'free') : p.days.includes(day) ? 'on' : 'off');
  const points = useMemo(
    () =>
      places.flatMap((p): MapPoint[] => {
        const at = placeCoords(geo.entry(p));
        return at ? [{ id: placeId(p), ...at, label: markerLabel(p, day), title: placeTitle(p), address: placeAddress(p), tone: tone(p), hospital: p.kind === 'hopital' }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [places, geo, day],
  );
  const listed = day === undefined ? places : dayPlaces(places, doc, day);
  const fit = `${day ?? 'tous'}|${points.map((p) => p.id).join(',')}`;
  const choose = (n: number | undefined) => {
    setPicked(n);
    setFocus(undefined);
  };
  return (
    <section className={s.panel} aria-label="Carte des lieux de tournage" data-view data-testid="schedule-map">
      {withPlaces.length > 1 && (
        <div className={s.days} role="group" aria-label="Jour">
          <button type="button" aria-pressed={day === undefined} className={day === undefined ? s.on : ''} onClick={() => choose(undefined)}>
            Tous
          </button>
          {withPlaces.map((n) => (
            <button key={n} type="button" aria-pressed={day === n} className={day === n ? s.on : ''} onClick={() => choose(n)} data-testid={`map-day-${n}`}>
              J{n}
            </button>
          ))}
        </div>
      )}
      <div className={s.body}>
        <MapView className={s.map} points={points} fit={fit} focus={focus} tiles={geo.online} onPick={setFocus} />
        <ol className={s.list}>
          {listed.map((p) => (
            <PlaceRow key={placeId(p)} place={p} label={markerLabel(p, day)} tone={tone(p)} state={geo.state(p)} route={routeUrl(p.address, geo.entry(p))} active={focus === placeId(p)} onClick={() => setFocus(placeId(p))} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Carte réduite de la feuille de service : les lieux du jour, dans l'ordre de la journée. */
export function DayMap({ doc, places, day }: { doc: ProjectDoc; places: MapPlace[]; day: number }) {
  const today = useMemo(() => dayPlaces(places, doc, day), [places, doc, day]);
  const geo = useGeocodes(doc, today, true);
  const [focus, setFocus] = useState<string>();
  // Repères numérotés dans l'ordre de la journée ; l'hôpital garde « H » (comme dans l'export).
  const labels = dayLabels(today);
  const points = today.flatMap((p): MapPoint[] => {
    const at = placeCoords(geo.entry(p));
    return at ? [{ id: placeId(p), ...at, label: labels.get(p)!, title: placeTitle(p), address: placeAddress(p), tone: 'normal', hospital: p.kind === 'hopital' }] : [];
  });
  if (!today.length) return null;
  return (
    <div className={[s.dayMap, 'no-print'].join(' ')} data-view data-a4-unit data-testid="day-map">
      <MapView className={s.dayMapMap} points={points} fit={`${day}|${points.map((p) => p.id).join(',')}`} focus={focus} tiles={geo.online} onPick={setFocus} />
      <ol className={s.legend}>
        {today.map((p) => (
          <PlaceRow key={placeId(p)} place={p} label={labels.get(p)!} tone="normal" state={geo.state(p)} route={routeUrl(p.address, geo.entry(p))} active={focus === placeId(p)} onClick={() => setFocus(placeId(p))} />
        ))}
      </ol>
    </div>
  );
}
