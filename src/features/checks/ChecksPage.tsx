import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { checkRows, sequenceName, type CheckRow, type CheckTarget } from '../../domain/checkTarget';
import { CHECK_LABELS, CHECK_NOTES, groupChecks, runChecks } from '../../domain/lint';
import { computeTiming } from '../../domain/timing';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { openCheck } from './openCheck';
import s from './ChecksPage.module.css';

/** Où mène une ligne, dit une fois pour toutes aux lecteurs d'écran (le contenu visible fait le nom). */
const DESTINATIONS = {
  shot: 'Ouvre le plan dans le découpage',
  shots: 'Sélectionne ces plans dans le découpage',
  sequence: 'Ouvre la séquence dans le découpage',
  registry: 'Ouvre la durée estimée dans le registre',
  interview: 'Ouvre la caméra dans la fiche d’interview',
} as const;
type Destination = keyof typeof DESTINATIONS;

function destination(t: CheckTarget): Destination {
  if (t.page !== 'grid') return t.page;
  return !t.shotId ? 'sequence' : t.lastShotId ? 'shots' : 'shot';
}

/**
 * Vérifications (§9) : les avertissements de la scripte, regroupés par type de contrôle. Chaque ligne
 * mène à l'endroit exact (plan, série de plans, séquence, registre, fiche d'interview) ; « Ignorer »
 * reste à part, à droite.
 */
export function ChecksPage({ doc }: { doc: ProjectDoc }) {
  const issues = useMemo(() => runChecks(doc, computeTiming(doc)), [doc]);
  const groups = useMemo(() => groupChecks(issues).map((g) => ({ ...g, rows: checkRows(doc, g.issues) })), [doc, issues]);
  const used = useMemo(() => new Set(groups.flatMap((g) => g.rows.map((r) => destination(r.target)))), [groups]);
  const ignored = doc.ignoredChecks.length;

  // Après « Ignorer », le clavier passe à la ligne suivante (ou à la précédente, ou à « Rétablir »).
  const page = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const at = refocus.current;
    if (at === null || !page.current) return;
    refocus.current = null;
    const lines = page.current.querySelectorAll<HTMLElement>('[data-check-go]');
    (lines[Math.min(at, lines.length - 1)] ?? page.current.querySelector<HTMLElement>('[data-restore]'))?.focus();
  }, [groups]);
  const ignore = (row: CheckRow, el: HTMLElement) => {
    const lines = [...(page.current?.querySelectorAll('[data-check-go]') ?? [])];
    refocus.current = Math.max(0, lines.indexOf(el.parentElement!.querySelector('[data-check-go]')!));
    mutateDoc((d) => void d.ignoredChecks.push(...row.issues.map((i) => i.id)));
  };

  return (
    <div ref={page} className={['page', s.page].join(' ')}>
      {issues.length === 0 ? (
        <div className="card empty">
          <span className="hand">Tout est en ordre</span>
          <p>Aucun avertissement : le découpage est prêt à être distribué.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section
            key={g.code}
            className={['card', s.group].join(' ')}
            aria-labelledby={`check-${g.code}`}
            data-testid={`check-group-${g.code}`}
            // Repères alignés dans le groupe, sans couper « 7.12 – 7.13 ».
            style={{ '--place-w': `${Math.max(...g.rows.map((r) => r.place.length)) * 0.9}ch` } as CSSProperties}
          >
            <header className={s.groupHead}>
              <h2 id={`check-${g.code}`} className={s.h2}>
                {CHECK_LABELS[g.code]}
              </h2>
              <span className={s.count}>{g.rows.length}</span>
            </header>
            {CHECK_NOTES[g.code] && <p className={s.note}>{CHECK_NOTES[g.code]}</p>}
            <ul className={s.list}>
              {g.rows.map((row) => {
                const name = sequenceName(doc, row.issues[0].sequenceId);
                return (
                  <li key={row.key} className={s.item} data-testid="issue">
                    <button
                      type="button"
                      className={s.go}
                      data-view
                      data-check-go
                      data-testid="check-go"
                      onClick={() => openCheck(doc, row.target)}
                      aria-describedby={`check-dest-${destination(row.target)}`}
                    >
                      <span className={s.place}>{row.place}</span>
                      <span className={[s.seq, name ? '' : s.unnamed].join(' ')}>{name || '—'}</span>
                      {row.detail && <span className={s.detail}>{row.detail}</span>}
                      <ChevronRight className={s.chev} size={15} strokeWidth={1.25} aria-hidden="true" />
                    </button>
                    <button type="button" className={s.ignore} aria-label={`Ignorer ${row.place}`} onClick={(e) => ignore(row, e.currentTarget)}>
                      Ignorer
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {/* En bas : ignorer une ligne ne décale pas celles qui restent au-dessus. */}
      {ignored > 0 && (
        <footer className={s.foot}>
          <Button variant="outline" size="sm" data-restore onClick={() => mutateDoc((d) => void (d.ignoredChecks = []))}>
            Rétablir {ignored > 1 ? `les ${ignored} contrôles ignorés` : 'le contrôle ignoré'}
          </Button>
        </footer>
      )}
      <div hidden>
        {[...used].map((d) => (
          <span key={d} id={`check-dest-${d}`}>
            {DESTINATIONS[d]}
          </span>
        ))}
      </div>
    </div>
  );
}
