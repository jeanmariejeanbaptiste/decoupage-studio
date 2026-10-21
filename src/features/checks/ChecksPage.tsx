import { useMemo } from 'react';
import { CHECK_LABELS, runChecks, type Issue } from '../../domain/lint';
import { sequenceHeading } from '../../domain/numbering';
import { computeTiming } from '../../domain/timing';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { goToShot } from '../registry/RegistryPage';
import s from './ChecksPage.module.css';

/** Panneau « Vérifications » (§9) : tous les avertissements de la scripte, cliquables. */
export function ChecksPage({ doc }: { doc: ProjectDoc }) {
  const issues = useMemo(() => runChecks(doc, computeTiming(doc)), [doc]);
  const bySeq = new Map<string, Issue[]>();
  for (const i of issues) bySeq.set(i.sequenceId, [...(bySeq.get(i.sequenceId) ?? []), i]);
  const warn = issues.filter((i) => i.level === 'warn').length;
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
            {warn} avertissement{warn > 1 ? 's' : ''} · {issues.length - warn} rappel{issues.length - warn > 1 ? 's' : ''}. Ces contrôles ne bloquent jamais la saisie.
          </p>
          {doc.project.sequenceIds
            .filter((id) => bySeq.has(id))
            .map((seqId) => (
              <section key={seqId} className={['card', s.group].join(' ')}>
                <h2 className={s.h2}>{sequenceHeading(doc, seqId)}</h2>
                <ul className={s.list}>
                  {bySeq.get(seqId)!.map((i) => (
                    <li key={i.id} className={i.level === 'info' ? s.info : s.warn} data-testid="issue">
                      <button type="button" className={s.where} onClick={() => goToShot(doc, i.shotId ?? doc.sequences[seqId]?.shotIds[0])}>
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
        </>
      )}
    </div>
  );
}
