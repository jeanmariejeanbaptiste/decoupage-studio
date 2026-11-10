import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { checkPlace, checkTarget } from '../../domain/checkTarget';
import { CHECK_LABELS, CHECK_NOTES, groupChecks, runChecks, type Issue } from '../../domain/lint';
import { computeTiming } from '../../domain/timing';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { openCheck } from './openCheck';
import s from './ChecksPage.module.css';

/** Où mène la ligne, pour les lecteurs d'écran et l'infobulle. */
function goLabel(doc: ProjectDoc, issue: Issue, place: string): string {
  const t = checkTarget(doc, issue);
  if (t.page === 'registry') return `Ouvrir la séquence ${place} dans le registre`;
  return t.shotId ? `Ouvrir le plan ${place} dans le découpage` : `Ouvrir la séquence ${place} dans le découpage`;
}

/**
 * Vérifications (§9) : les avertissements de la scripte, regroupés par type de contrôle. Chaque ligne
 * mène à l'endroit exact (plan, séquence, registre) ; « Ignorer » reste à part, à droite.
 */
export function ChecksPage({ doc }: { doc: ProjectDoc }) {
  const issues = useMemo(() => runChecks(doc, computeTiming(doc)), [doc]);
  const groups = useMemo(() => groupChecks(issues), [issues]);
  const ignored = doc.ignoredChecks.length;
  return (
    <div className={['page', s.page].join(' ')}>
      {issues.length === 0 ? (
        <div className="card empty">
          <span className="hand">Tout est en ordre</span>
          <p>Aucun avertissement : le découpage est prêt à être distribué.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.code} className={['card', s.group].join(' ')} aria-labelledby={`check-${g.code}`} data-testid={`check-group-${g.code}`}>
            <header className={s.groupHead}>
              <h2 id={`check-${g.code}`} className={s.h2}>
                {CHECK_LABELS[g.code]}
              </h2>
              <span className={s.count}>{g.issues.length}</span>
            </header>
            {CHECK_NOTES[g.code] && <p className={s.note}>{CHECK_NOTES[g.code]}</p>}
            <ul className={s.list}>
              {g.issues.map((i) => {
                const place = checkPlace(doc, i);
                const label = goLabel(doc, i, place);
                return (
                  <li key={i.id} className={s.item} data-testid="issue">
                    <button type="button" className={s.go} data-view onClick={() => openCheck(doc, i)} aria-label={label} title={label}>
                      <span className={s.place}>{place}</span>
                      <span className={s.seq}>{(doc.sequences[i.sequenceId]?.label ?? '').toUpperCase()}</span>
                      <span className={s.detail}>{i.detail}</span>
                      <ChevronRight className={s.chev} size={15} strokeWidth={1.25} aria-hidden="true" />
                    </button>
                    <button type="button" className={s.ignore} aria-label="Ignorer ici" onClick={() => mutateDoc((d) => void d.ignoredChecks.push(i.id))}>
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
          <Button variant="outline" size="sm" onClick={() => mutateDoc((d) => void (d.ignoredChecks = []))}>
            Rétablir {ignored > 1 ? `les ${ignored} contrôles ignorés` : 'le contrôle ignoré'}
          </Button>
        </footer>
      )}
    </div>
  );
}
