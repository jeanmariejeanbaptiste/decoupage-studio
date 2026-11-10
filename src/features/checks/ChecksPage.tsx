import { useMemo } from 'react';
import { CHECK_LABELS, groupIssues, runChecks, type Issue } from '../../domain/lint';
import { sequenceHeading, sequenceNumber } from '../../domain/numbering';
import { computeTiming } from '../../domain/timing';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { goToIssue } from '../grid/goTo';
import s from './ChecksPage.module.css';

/** Panneau « Vérifications » (§9) : tous les avertissements de la scripte, cliquables. */
export function ChecksPage({ doc }: { doc: ProjectDoc }) {
  const issues = useMemo(() => runChecks(doc, computeTiming(doc)), [doc]);
  // Les séquences sans plan (souvent nombreuses après l'import d'un scénario) : une seule entrée.
  const { rest, empty, count, warn } = groupIssues(issues);
  const bySeq = new Map<string, Issue[]>();
  for (const i of rest) bySeq.set(i.sequenceId, [...(bySeq.get(i.sequenceId) ?? []), i]);
  return (
    <div className="page">
      <header className="page-head">
        {doc.ignoredChecks.length > 0 && (
          <Button variant="outline" onClick={() => mutateDoc((d) => void (d.ignoredChecks = []))}>
            Rétablir les {doc.ignoredChecks.length} contrôle{doc.ignoredChecks.length > 1 ? 's' : ''} ignoré{doc.ignoredChecks.length > 1 ? 's' : ''}
          </Button>
        )}
      </header>
      {issues.length === 0 ? (
        <div className="card empty">
          <span className="hand">Tout est en ordre</span>
          <p>Aucun avertissement : le découpage est prêt à être distribué.</p>
        </div>
      ) : (
        <>
          <p className={s.summary}>
            {warn} avertissement{warn > 1 ? 's' : ''} · {count - warn} rappel{count - warn > 1 ? 's' : ''}
          </p>
          {doc.project.sequenceIds
            .filter((id) => bySeq.has(id))
            .map((seqId) => (
              <section key={seqId} className={['card', s.group].join(' ')}>
                <h2 className={s.h2}>{sequenceHeading(doc, seqId)}</h2>
                <ul className={s.list}>
                  {bySeq.get(seqId)!.map((i) => (
                    <li key={i.id} className={i.level === 'info' ? s.info : s.warn} data-testid="issue">
                      <button type="button" className={s.where} data-view onClick={() => goToIssue(doc, i)}>
                        {i.where}
                      </button>
                      <span className={s.label}>{CHECK_LABELS[i.code]}</span>
                      <span className={s.msg}>{i.message}</span>
                      <button type="button" className={s.ignore} onClick={() => mutateDoc((d) => void d.ignoredChecks.push(i.id))}>
                        ignorer ici
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {empty.length > 0 && (
            <section className={['card', s.group].join(' ')} data-testid="empty-sequences-check">
              <h2 className={s.h2}>
                {empty.length} séquence{empty.length > 1 ? 's' : ''} sans plan
              </h2>
              <ul className={s.list}>
                <li className={[s.warn, s.grouped].join(' ')} data-testid="issue">
                  <span className={s.seqLinks}>
                    {empty.map((i) => (
                      <button key={i.id} type="button" className={s.where} data-view title={sequenceHeading(doc, i.sequenceId)} aria-label={`Séquence ${sequenceHeading(doc, i.sequenceId)}`} onClick={() => goToIssue(doc, i)}>
                        {sequenceNumber(doc, i.sequenceId)}
                      </button>
                    ))}
                  </span>
                  <button type="button" className={s.ignore} onClick={() => mutateDoc((d) => void d.ignoredChecks.push(...empty.map((i) => i.id)))}>
                    ignorer
                  </button>
                </li>
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
