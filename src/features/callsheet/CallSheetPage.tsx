import { useMemo, useRef, useState } from 'react';
import { useA4Pages } from '../../ui/useA4Pages';
import { navigate } from '../../app/router';
import { aggregateEquipment, equipmentCategories } from '../../domain/equipment';
import { formatFocal } from '../../domain/focal';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import {
  callSheetStrips,
  dayItinerary,
  dayStats,
  scheduleDays,
  firstSlot,
  shotSlotsText,
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
  useA4Pages(sheetRef, [doc, day?.n]);

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
  const shotIds = strips.flatMap((x) => x.shotIds);
  const equipment = aggregateEquipment(doc);
  const set = (patch: Parameters<typeof updateDay>[2]) => mutateDoc((d) => updateDay(d, day.n, patch));
  const cast = stats.characterIds
    .map((id) => doc.characters[id])
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

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
          <TabExport
            doc={() => callSheetDocument(doc, day.n)}
            fileBase={`${doc.project.title || 'projet'}-feuille-de-service-J${day.n}`}
            file={{
              label: 'CSV',
              name: `${doc.project.title || 'projet'}-feuille-de-service-J${day.n}.csv`,
              content: () => callSheetCsv(doc, day.n),
            }}
          />
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
          {itinerary.length > 0 && itinerary.every((stop) => !stop.start) && (
            <p className={[s.muted, 'no-print'].join(' ')} data-testid="timeline-hint">
              Aucun horaire pour l’instant : ouvrez l’
              <button type="button" className={s.link} onClick={() => navigate('schedule')}>
                emploi du temps du jour
              </button>{' '}
              dans le Plan de travail et glissez-y les plans.
            </p>
          )}
          {itinerary.length === 0 ? (
            <p className={s.muted}>Aucune séquence prévue ce jour.</p>
          ) : (
            <table className={s.table} data-testid="itinerary">
              <thead>
                <tr>
                  <th>Horaire</th>
                  <th>Lieu</th>
                  <th>Adresse</th>
                  <th>Séquence</th>
                </tr>
              </thead>
              <tbody>
                {itinerary.map((stop, i) => {
                  const decor = stop.decorId ? doc.decors[stop.decorId] : undefined;
                  return (
                    <tr key={i}>
                      <td className={s.code}>{stop.start ? `${stop.start} – ${stop.end}` : '—'}</td>
                      <td>
                        <strong>{decor?.name ?? 'Décor non renseigné'}</strong>{' '}
                        {decor?.intExt && <span className={s.muted}>{decor.intExt}</span>}
                      </td>
                      <td>
                        <input
                          className={s.address}
                          value={stop.address}
                          placeholder="Adresse du lieu ce jour-là"
                          aria-label={`Adresse pour ${sequenceHeading(doc, stop.seqIds[0])}`}
                          data-testid="stop-address"
                          onChange={(e) =>
                            set({ seqAddresses: { ...day.seqAddresses, [stop.seqIds[0]]: e.target.value } })
                          }
                        />
                      </td>
                      <td>{stop.seqIds.map((id) => sequenceHeading(doc, id)).join(' · ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className={s.block}>
          <h3>Convocations</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Rôle</th>
                <th>Comédien·ne</th>
                <th>Type</th>
                <th>Convocation</th>
              </tr>
            </thead>
            <tbody>
              {cast.length === 0 && (
                <tr>
                  <td colSpan={4} className={s.muted}>
                    Aucun personnage reconnu dans les plans du jour.
                  </td>
                </tr>
              )}
              {cast.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.actor || '—'}</td>
                  <td>{c.kind}</td>
                  <td>
                    <input
                      type="time"
                      value={day.calls?.[c.id] ?? ''}
                      onChange={(e) => set({ calls: { ...(day.calls ?? {}), [c.id]: e.target.value } })}
                      aria-label={`Convocation de ${c.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={s.block}>
          <h3>
            Plans du jour{' '}
            <span className={s.count}>
              {shotIds.length} plans · {formatTc(stats.screenSec)} d’écran
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
