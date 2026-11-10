import { useMemo, useRef, useState } from 'react';
import { useA4Pages } from '../../ui/useA4Pages';
import { navigate } from '../../app/router';
import { aggregateEquipment, equipmentCategories } from '../../domain/equipment';
import { formatFocal } from '../../domain/focal';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import {
  bannerLabel,
  callSheetAgenda,
  callSheetStrips,
  clockTime,
  dayItinerary,
  dayKeyTimes,
  dayStats,
  scheduleDays,
  firstSlot,
  plural,
  setDayMeal,
  shotSlotsText,
  showTime,
  updateDay,
} from '../../domain/schedule';
import { formatTc } from '../../domain/timecode';
import { computeTiming } from '../../domain/timing';
import { renderTokens } from '../../domain/tokens';
import type { ProjectDoc } from '../../domain/types';
import { isZoom } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import s from './CallSheetPage.module.css';
import { TabExport } from '../export/TabExport';
import { callSheetCsv } from '../../domain/exports';
import { callSheetDocument } from '../../domain/documents';
import { characterNumbers } from '../../domain/registry';
import { decorLocation } from '../../domain/locations';
import { exportBase } from '../../domain/serialize';
import { dayPlaces, mapPlaces } from '../../domain/geo';
import { Map as MapIcon } from 'lucide-react';
import { DayMap } from '../map/PlacesMap';
import { dayMapImage } from '../map/staticMap';
import { useMapVisible } from '../map/visibility';

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Feuille de service d'un jour de tournage (§15.4). */
export function CallSheetPage({ doc }: { doc: ProjectDoc }) {
  const days = scheduleDays(doc);
  const [n, setN] = useState<number | undefined>(days[0]?.n);
  const day = days.find((d) => d.n === n) ?? days[0];
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const sheetRef = useRef<HTMLElement>(null);
  const places = useMemo(() => mapPlaces(doc), [doc]);
  const [mapOn, toggleMap] = useMapVisible();
  // La carte du jour, montrée ou masquée, déplace la suite de la feuille : pagination refaite.
  useA4Pages(sheetRef, [doc, day?.n, mapOn]);

  if (!day) {
    return (
      <div className="page">
        <div className="card empty">
          <span className="hand">Aucun jour de tournage</span>
          <p>Bâtissez d’abord le plan de travail pour générer les feuilles de service.</p>
          <Button variant="primary" onClick={() => navigate('schedule')}>
            Ouvrir le plan de travail
          </Button>
        </div>
      </div>
    );
  }

  const strips = callSheetStrips(doc, day.n);
  const stats = dayStats(doc, timing, day.n, strips);
  const itinerary = dayItinerary(doc, day.n);
  const agenda = callSheetAgenda(doc, day.n);
  const shotIds = strips.flatMap((x) => x.shotIds);
  const equipment = aggregateEquipment(doc);
  const set = (patch: Parameters<typeof updateDay>[2]) => mutateDoc((d) => updateDay(d, day.n, patch));
  const nums = characterNumbers(doc);
  const keys = dayKeyTimes(doc, day.n);
  const wrapInput = (
    <input
      type="time"
      className={keys.wrapComputed ? s.computed : undefined}
      value={clockTime(keys.wrap)}
      onChange={(e) => set({ wrap: e.target.value || undefined })}
      aria-label="Fin prévue"
    />
  );
  const hasPlaces = dayPlaces(places, doc, day.n).length > 0;
  const cast = stats.characterIds
    .map((id) => doc.characters[id])
    .filter(Boolean)
    .sort((a, b) => (nums.get(a.id) ?? 99) - (nums.get(b.id) ?? 99));

  return (
    <div className="page">
      <header className="page-head no-print">
        <div className={s.toolbar}>
          <label className={s.pick}>
            <span>Jour</span>
            <select
              value={day.n}
              onChange={(e) => setN(Number(e.target.value))}
              aria-label="Jour de tournage"
            >
              {days.map((d) => (
                <option key={d.n} value={d.n}>
                  Jour {d.n}
                  {d.date ? ` — ${d.date}` : ''}
                </option>
              ))}
            </select>
          </label>
          <TabExport id="callsheet" orientation="portrait"
            doc={async () => callSheetDocument(doc, day.n, { map: mapOn && hasPlaces ? await dayMapImage(doc, day.n) : undefined })}
            fileBase={`${exportBase(doc)}-feuille-de-service-J${day.n}`}
            file={{
              label: 'CSV',
              name: `${exportBase(doc)}-feuille-de-service-J${day.n}.csv`,
              content: () => callSheetCsv(doc, day.n),
            }}
          />
          {hasPlaces && (
            <Button variant={mapOn ? 'primary' : 'outline'} icon={<MapIcon size={15} strokeWidth={1.25} />} aria-pressed={mapOn} onClick={toggleMap} data-view data-testid="map-toggle">
              Carte
            </Button>
          )}
        </div>
      </header>

      <article ref={sheetRef} className={['a4-sheet', 'a4-paged', s.sheet].join(' ')} data-testid="callsheet">
        <header className={s.head}>
          <div>
            <p className={s.kicker}>Feuille de service</p>
            <h2 className={s.title}>{doc.project.title}</h2>
            <p className={s.meta}>
              {doc.project.version}
              {doc.project.director ? ` · Réalisation : ${doc.project.director}` : ''}
              {doc.project.dop ? ` · Image : ${doc.project.dop}` : ''}
            </p>
          </div>
          <div className={s.dayBox}>
            <span className={s.dayN}>Jour {day.n}</span>
            <span>{day.date ? dateFmt.format(new Date(`${day.date}T12:00`)) : <em>date à préciser</em>}</span>
            <label className={s.call}>
              Rendez-vous
              <input
                type="time"
                value={day.callTime ?? ''}
                onChange={(e) => set({ callTime: e.target.value || undefined })}
                aria-label="Heure de rendez-vous"
              />
            </label>
          </div>
        </header>

        <section className={s.block}>
          <h3>Lieux et horaires</h3>
          {itinerary.length > 0 && agenda.every((it) => !it.start) && (
            <p className={[s.muted, 'no-print'].join(' ')} data-testid="timeline-hint">
              Aucun horaire ·{' '}
              <button type="button" className={s.link} onClick={() => navigate('schedule')}>
                emploi du temps
              </button>
            </p>
          )}
          {itinerary.length === 0 ? (
            <p className={s.muted}>Aucune séquence prévue ce jour.</p>
          ) : (
            <table className={s.table} data-testid="itinerary">
              <thead>
                <tr>
                  <th>Horaire</th>
                  <th>Décor</th>
                  <th>Lieu de tournage</th>
                  <th>Séquence</th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((it) => {
                  if (it.type === 'banner') {
                    return (
                      <tr key={it.banner.id} className={s.bannerRow} data-testid="itinerary-banner">
                        <td className={s.code}>{it.start ? `${showTime(it.start)} – ${showTime(it.end)}` : '—'}</td>
                        <td colSpan={3}>
                          <strong>{bannerLabel(it.banner)}</strong>
                          {it.banner.label ? ` · ${it.banner.label}` : ''} <span className={s.muted}>{it.banner.minutes} min</span>
                        </td>
                      </tr>
                    );
                  }
                  const stop = itinerary.find((x) => x.seqIds[0] === it.strip.seqId);
                  if (!stop) return null;
                  const decor = stop.decorId ? doc.decors[stop.decorId] : undefined;
                  const loc = decorLocation(decor);
                  return (
                    <tr key={it.strip.seqId}>
                      <td className={[s.code, stop.computed ? s.computed : ''].join(' ')}>{stop.start ? `${showTime(stop.start)} – ${showTime(stop.end)}` : '—'}</td>
                      <td>
                        <strong>{decor?.name ?? 'Décor non renseigné'}</strong>{' '}
                        {decor?.intExt && <span className={s.muted}>{decor.intExt}</span>}
                      </td>
                      <td>
                        {loc.name && <strong className={s.locName}>{loc.name}</strong>}
                        <input
                          className={s.address}
                          value={stop.address}
                          placeholder="Adresse du lieu ce jour-là"
                          aria-label={`Adresse pour ${sequenceHeading(doc, stop.seqIds[0])}`}
                          data-testid="stop-address"
                          onChange={(e) => {
                            // Champ vidé : l'adresse du décor reprend sa place.
                            const next = { ...day.seqAddresses, [stop.seqIds[0]]: e.target.value };
                            if (!e.target.value) delete next[stop.seqIds[0]];
                            set({ seqAddresses: next });
                          }}
                        />
                        {loc.access && <span className={s.locLine}>Accès : {loc.access}</span>}
                        {loc.contact && <span className={s.locLine}>Contact : {loc.contact}</span>}
                      </td>
                      <td>{stop.seqIds.map((id) => sequenceHeading(doc, id)).join(' · ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {mapOn && hasPlaces && <DayMap doc={doc} places={places} day={day.n} />}
        </section>

        <section className={s.block} data-testid="callsheet-keys">
          <h3>Repères du jour</h3>
          <div className={s.keys}>
            <label className={s.key}>
              <span>Prêt à tourner</span>
              <input type="time" value={day.pat ?? ''} onChange={(e) => set({ pat: e.target.value || undefined })} aria-label="Prêt à tourner" />
            </label>
            <div className={s.key} role="group" aria-label="Repas" data-testid="callsheet-meal">
              <span>Repas</span>
              <div className={s.range}>
                <input
                  type="time"
                  className={keys.meal?.computed.start ? s.computed : undefined}
                  value={clockTime(keys.meal?.start)}
                  onChange={(e) => mutateDoc((d) => setDayMeal(d, day.n, { start: e.target.value || undefined }))}
                  aria-label="Début du repas"
                />
                <span>à</span>
                <input
                  type="time"
                  className={keys.meal?.computed.end ? s.computed : undefined}
                  value={clockTime(keys.meal?.end)}
                  onChange={(e) => mutateDoc((d) => setDayMeal(d, day.n, { end: e.target.value || undefined }))}
                  aria-label="Fin du repas"
                />
              </div>
            </div>
            {keys.restart ? (
              <div className={s.key} role="group" aria-label="Reprise" data-testid="callsheet-restart">
                <span>Reprise</span>
                <div className={s.range}>
                  <output className={s.rangeFixed} aria-label="Début de la reprise">
                    {showTime(keys.restart.start)}
                  </output>
                  <span>à</span>
                  {wrapInput}
                </div>
              </div>
            ) : (
              <label className={s.key}>
                <span>Fin prévue</span>
                {wrapInput}
              </label>
            )}
            {(
              [
                ['sunrise', 'Lever du soleil'],
                ['sunset', 'Coucher du soleil'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={s.key}>
                <span>{label}</span>
                <input type="time" value={day[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} aria-label={label} />
              </label>
            ))}
            <label className={s.key}>
              <span>Météo</span>
              <input value={day.weather ?? ''} placeholder="Ensoleillé, 14 °C" onChange={(e) => set({ weather: e.target.value || undefined })} aria-label="Météo" />
            </label>
            <label className={[s.key, s.keyWide].join(' ')}>
              <span>Hôpital le plus proche</span>
              <input value={day.hospital ?? ''} placeholder="Nom, adresse, téléphone des urgences" onChange={(e) => set({ hospital: e.target.value || undefined })} aria-label="Hôpital le plus proche" />
            </label>
          </div>
        </section>

        <section className={s.block}>
          <h3>Comédiens</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th>N°</th>
                <th>Rôle</th>
                <th>Interprète</th>
                <th>Départ</th>
                <th>Convocation</th>
                <th>HMC</th>
                <th>Costume</th>
                <th>Sur le plateau</th>
              </tr>
            </thead>
            <tbody>
              {cast.length === 0 && (
                <tr>
                  <td colSpan={8} className={s.muted}>
                    Aucun personnage reconnu dans les plans du jour.
                  </td>
                </tr>
              )}
              {cast.map((c) => {
                const x = day.callDetails?.[c.id] ?? {};
                const detail = (k: 'pickup' | 'makeup' | 'costume' | 'onSet', label: string) => (
                  <td>
                    <input
                      type="time"
                      value={x[k] ?? ''}
                      onChange={(e) => set({ callDetails: { ...(day.callDetails ?? {}), [c.id]: { ...x, [k]: e.target.value || undefined } } })}
                      aria-label={`${label} de ${c.name}`}
                    />
                  </td>
                );
                return (
                  <tr key={c.id}>
                    <td className={s.num}>{nums.get(c.id)}</td>
                    <td>{c.name}</td>
                    <td>{c.actor || '—'}</td>
                    {detail('pickup', 'Départ')}
                    <td>
                      <input
                        type="time"
                        value={day.calls?.[c.id] ?? ''}
                        onChange={(e) => set({ calls: { ...(day.calls ?? {}), [c.id]: e.target.value } })}
                        aria-label={`Convocation de ${c.name}`}
                      />
                    </td>
                    {detail('makeup', 'HMC')}
                    {detail('costume', 'Costume')}
                    {detail('onSet', 'Sur le plateau')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className={s.block}>
          <h3>
            Plans du jour{' '}
            <span className={s.count}>
              {plural(shotIds.length, 'plan')} · {formatTc(stats.screenSec)} d’écran
            </span>
          </h3>
          <table className={s.table} data-testid="callsheet-shots">
            <colgroup>
              {[12, 6, 13, 11, 10, 12, 11, 8, 17].map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Horaire</th>
                <th>Plan</th>
                <th>Séquence</th>
                <th>Sujet</th>
                <th>Valeur</th>
                <th>Angle</th>
                <th>Mouvement</th>
                <th>Focale</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rows = strips.flatMap((st) =>
                  st.shotIds.map((id) => ({ id, seqId: st.seqId, slot: firstSlot(doc, day.n, id) })),
                );
                const placed = rows
                  .filter((r) => r.slot)
                  .sort((a, b) => a.slot!.start.localeCompare(b.slot!.start));
                const rest = rows.filter((r) => !r.slot);
                const line = ({ id, seqId, slot }: (typeof rows)[number]) => {
                  const sh = doc.shots[id];
                  return (
                    <tr key={id}>
                      <td className={s.time}>{slot ? shotSlotsText(doc, day.n, id) : ''}</td>
                      <td className={s.code}>{shotCode(doc, id)}</td>
                      <td>{sequenceHeading(doc, seqId)}</td>
                      <td>{sh.subject}</td>
                      <td>{sh.value}</td>
                      <td>{renderTokens(sh.angle)}</td>
                      <td>{renderTokens(sh.movement, sh.movementSep)}</td>
                      <td>{formatFocal(sh.focal, isZoom(sh.movement))}</td>
                      <td>{doc.blocks[sh.actionBlockId]?.text}</td>
                    </tr>
                  );
                };
                return (
                  <>
                    {placed.map(line)}
                    {rest.map(line)}
                  </>
                );
              })()}
            </tbody>
          </table>
        </section>

        <section className={s.block}>
          <h3>Matériel requis</h3>
          <div className={s.equip}>
            {equipmentCategories(doc).map((c) => {
              const lines = equipment[c].filter(
                (l) => l.manual || l.shotIds.some((id) => shotIds.includes(id)),
              );
              return (
                <div key={c}>
                  <Hand>{c}</Hand>
                  <ul>
                    {lines.length === 0 && <li className={s.muted}>—</li>}
                    {lines.map((l) => (
                      <li key={l.key}>{l.label}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section className={s.block}>
          <h3>Notes</h3>
          <textarea
            className={s.notes}
            rows={3}
            value={day.notes ?? ''}
            onChange={(e) => set({ notes: e.target.value || undefined })}
            placeholder="Cantine, parking, consignes de sécurité, météo…"
            aria-label="Notes de la feuille de service"
          />
        </section>
      </article>
    </div>
  );
}
