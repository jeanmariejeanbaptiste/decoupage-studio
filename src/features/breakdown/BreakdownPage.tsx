import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  addBreakdownItems,
  BREAKDOWN_CATEGORIES,
  BREAKDOWN_LABELS,
  breakdownOf,
  breakdownSuggestions,
  derivedBreakdown,
  removeBreakdownItem,
  type BreakdownCategory,
} from '../../domain/breakdown';
import { sequenceHeading } from '../../domain/numbering';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import s from './BreakdownPage.module.css';

/** Dépouillement par séquence (§15.5). */
export function BreakdownPage({ doc }: { doc: ProjectDoc }) {
  const [picked, setPicked] = useState<ID | undefined>(doc.project.sequenceIds[0]);
  const seqId = picked && doc.sequences[picked] ? picked : doc.project.sequenceIds[0];
  if (!seqId) {
    return (
      <div className="page">
        <p className="page-kicker">Étape 3 · Dépouillement</p>
        <h1 className="page-title">Dépouillement</h1>
        <div className="card empty">
          <span className="hand">Aucune séquence</span>
          <p>Écrivez le scénario ou créez des séquences dans le découpage.</p>
        </div>
      </div>
    );
  }
  const manual = breakdownOf(doc, seqId);
  const derived = derivedBreakdown(doc, seqId);
  const suggestions = breakdownSuggestions(doc, seqId);
  const nSug = Object.values(suggestions).reduce((n, l) => n + (l?.length ?? 0), 0);
  const seq = doc.sequences[seqId];

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div>
          <p className="page-kicker">Étape 3 · Dépouillement</p>
          <h1 className="page-title">{sequenceHeading(doc, seqId)}</h1>
        </div>
      </header>
      <div className={s.layout}>
        <nav className={['card', s.seqs].join(' ')} aria-label="Séquences">
          {doc.project.sequenceIds.map((id) => {
            const n = Object.values(breakdownOf(doc, id)).reduce((k, l) => k + (l?.length ?? 0), 0);
            return (
              <button key={id} type="button" className={id === seqId ? s.on : ''} aria-current={id === seqId ? 'true' : undefined} onClick={() => setPicked(id)}>
                <span>{sequenceHeading(doc, id)}</span>
                <em>{n || ''}</em>
              </button>
            );
          })}
        </nav>
        <div>
          {seq.summary && <p className={s.summary}>{seq.summary}</p>}
          {nSug > 0 && (
            <section className={s.suggest} data-testid="breakdown-suggestions">
              <Hand>détecté dans les actions</Hand>
              <div className={s.sugList}>
                {(Object.entries(suggestions) as Array<[BreakdownCategory, string[]]>).flatMap(([cat, items]) =>
                  items.map((it) => (
                    <button key={`${cat}-${it}`} type="button" className={s.sug} onClick={() => mutateDoc((d) => addBreakdownItems(d, seqId, cat, [it]))}>
                      <Plus size={12} /> {it} <em>{BREAKDOWN_LABELS[cat].toLowerCase()}</em>
                    </button>
                  )),
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  mutateDoc((d) => {
                    for (const [cat, items] of Object.entries(suggestions) as Array<[BreakdownCategory, string[]]>) addBreakdownItems(d, seqId, cat, items);
                  })
                }
              >
                Tout ajouter
              </Button>
            </section>
          )}
          <div className={s.grid}>
            {BREAKDOWN_CATEGORIES.map((cat) => (
              <Category key={cat} cat={cat} seqId={seqId} derived={derived[cat] ?? []} manual={manual[cat] ?? []} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Category({ cat, seqId, derived, manual }: { cat: BreakdownCategory; seqId: ID; derived: string[]; manual: string[] }) {
  const [draft, setDraft] = useState('');
  return (
    <section className={['card', s.cat, s[`c_${cat}`]].join(' ')} data-testid={`breakdown-${cat}`}>
      <h2>{BREAKDOWN_LABELS[cat]}</h2>
      <ul>
        {derived.map((d) => (
          <li key={`d-${d}`} className={s.derived} title="Déduit du découpage">
            {d}
          </li>
        ))}
        {manual.map((m) => (
          <li key={m}>
            {m}
            <button type="button" aria-label={`Retirer ${m}`} onClick={() => mutateDoc((d) => removeBreakdownItem(d, seqId, cat, m))}>
              <X size={11} />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          mutateDoc((d) => addBreakdownItems(d, seqId, cat, [draft]));
          setDraft('');
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter…" aria-label={`Ajouter (${BREAKDOWN_LABELS[cat]})`} />
      </form>
    </section>
  );
}
