import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  addBreakdownItems,
  breakdownCategories,
  breakdownLabel,
  breakdownOf,
  isCustomCategory,
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
import { TabExport } from '../export/TabExport';
import { breakdownCsv } from '../../domain/exports';
import { breakdownDocument } from '../../domain/documents';

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
        <TabExport doc={() => breakdownDocument(doc)} fileBase={`${doc.project.title || 'projet'}-depouillement`} file={{ label: 'CSV', name: `${doc.project.title || 'projet'}-depouillement.csv`, content: () => breakdownCsv(doc) }} />
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
                      <Plus size={12} /> {it} <em>{breakdownLabel(cat).toLowerCase()}</em>
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
            {breakdownCategories(doc).map((cat) => (
              <Category key={cat} cat={cat} seqId={seqId} derived={derived[cat] ?? []} manual={manual[cat] ?? []} />
            ))}
          </div>
          <button
            type="button"
            className={s.addCat}
            data-testid="add-breakdown-category"
            onClick={() => {
              const name = window.prompt('Nom de la nouvelle catégorie (pour toutes les séquences)')?.trim();
              if (name) mutateDoc((d) => void (d.breakdownExtra = [...new Set([...(d.breakdownExtra ?? []), name])]));
            }}
          >
            + Ajouter une catégorie
          </button>
        </div>
      </div>
    </div>
  );
}

function Category({ cat, seqId, derived, manual }: { cat: BreakdownCategory; seqId: ID; derived: string[]; manual: string[] }) {
  const [draft, setDraft] = useState('');
  return (
    <section className={['card', s.cat, s[`c_${cat}`]].join(' ')} data-testid={`breakdown-${cat}`}>
      <h2>
        {breakdownLabel(cat)}
        {isCustomCategory(cat) && (
          <button
            type="button"
            className={s.removeCat}
            aria-label={`Supprimer la catégorie ${breakdownLabel(cat)}`}
            onClick={() => {
              if (!window.confirm(`Supprimer la catégorie « ${breakdownLabel(cat)} » de toutes les séquences ? (annulable avec ⌘Z)`)) return;
              mutateDoc((d) => {
                d.breakdownExtra = (d.breakdownExtra ?? []).filter((l) => l !== breakdownLabel(cat));
                for (const b of Object.values(d.breakdown ?? {})) delete b[cat];
              });
            }}
          >
            <X size={12} />
          </button>
        )}
      </h2>
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
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter…" aria-label={`Ajouter (${breakdownLabel(cat)})`} />
      </form>
    </section>
  );
}
