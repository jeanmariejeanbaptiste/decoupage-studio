import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, X } from 'lucide-react';
import { sequenceHeading } from '../../domain/numbering';
import { SORT_KEYS, sortedDoc, type SortCriterion, type SortKey, type SortOptions } from '../../domain/sortView';
import type { ProjectDoc } from '../../domain/types';
import { useUi } from '../../store/uiStore';
import { ExportTable } from '../export/ExportTable';
import { StoryboardPreview } from '../storyboard/StoryboardPage';
import { CutExport } from './CutExport';
import s from './SortView.module.css';

const LABEL = Object.fromEntries(SORT_KEYS) as Record<SortKey, string>;
/** Sens de chaque critère, dit en clair. */
const DIRECTION: Record<SortKey, [string, string]> = {
  day: ['J1 d’abord', 'dernier jour d’abord'],
  decor: ['A → Z', 'Z → A'],
  intExt: ['intérieurs d’abord', 'extérieurs d’abord'],
  value: ['du plus large', 'du plus serré'],
  subject: ['A → Z', 'Z → A'],
  dialogue: ['parlés d’abord', 'muets d’abord'],
  movement: ['fixes d’abord', 'en mouvement d’abord'],
  focal: ['courte d’abord', 'longue d’abord'],
  angle: ['face d’abord', 'dos d’abord'],
};

const KEY = (pid: string) => `ds-sort:${pid}`;
function load(pid: string): SortOptions {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(pid)) ?? 'null') as SortOptions | null;
    if (v && Array.isArray(v.criteria)) return v;
  } catch {
    /* réglage par défaut */
  }
  return { criteria: [{ key: 'value' }], scope: 'film' };
}

/**
 * Découpage trié pour le tournage : les plans rangés par valeur, sujet, dialogue, mouvement… sur
 * tout le film ou séquence par séquence. Les numéros restent ceux du découpage (le clap ne change
 * pas) ; aperçu et exports, tableau ou storyboard, sont ceux de l'outil.
 */
export function SortView({ doc }: { doc: ProjectDoc }) {
  const pid = doc.project.id;
  const [o, setO] = useState<SortOptions>(() => load(pid));
  const [view, setView] = useState<'table' | 'storyboard'>('table');
  const update = (next: SortOptions) => {
    setO(next);
    try {
      localStorage.setItem(KEY(pid), JSON.stringify(next));
    } catch {
      /* réglage pour la session */
    }
  };
  const virtual = useMemo(() => sortedDoc(doc, o), [doc, o]);
  const used = new Set(o.criteria.map((c) => c.key));
  const free = SORT_KEYS.filter(([k]) => !used.has(k));
  const seqs = doc.project.sequenceIds.filter((id) => doc.sequences[id]?.shotIds.length);
  const chosen = o.seqIds?.length ? seqs.filter((id) => o.seqIds!.includes(id)) : seqs;
  const setCrit = (i: number, c: SortCriterion | null) => {
    const list = [...o.criteria];
    if (c) list[i] = c;
    else list.splice(i, 1);
    update({ ...o, criteria: list });
  };
  const toggleSeq = (id: string, on: boolean) => {
    const base = o.seqIds?.length ? o.seqIds : seqs;
    const next = on ? [...base, id] : base.filter((x) => x !== id);
    if (!next.length) return;
    update({ ...o, seqIds: next.length === seqs.length ? undefined : seqs.filter((x) => next.includes(x)) });
  };

  return (
    <div className="page page--wide" data-testid="sort-view">
      <header className={['page-head', s.head].join(' ')}>
        <div className={s.bar}>
          <button type="button" className={s.back} onClick={() => useUi.getState().set({ sortView: false })} data-testid="sort-close">
            <ArrowLeft size={15} strokeWidth={1.5} /> Découpage
          </button>
          <div className={s.seg} role="radiogroup" aria-label="Affichage du tri">
            <button type="button" role="radio" aria-checked={view === 'table'} className={view === 'table' ? s.on : ''} onClick={() => setView('table')}>
              Tableau
            </button>
            <button type="button" role="radio" aria-checked={view === 'storyboard'} className={view === 'storyboard' ? s.on : ''} onClick={() => setView('storyboard')} data-testid="sort-storyboard">
              Storyboard
            </button>
          </div>
          <span className={s.spacer} />
          <CutExport doc={virtual} defaultContent={view === 'storyboard' ? 'storyboard' : 'grid'} key={view} />
        </div>
        <div className={s.controls}>
          <div className={s.group} aria-label="Trier par" role="group">
            <span className={s.k}>Trier par</span>
            {o.criteria.map((c, i) => (
              <span key={c.key} className={s.chip} data-testid="sort-criterion">
                <b>{LABEL[c.key]}</b>
                <button type="button" onClick={() => setCrit(i, { ...c, desc: !c.desc })} title="Inverser" aria-label={`Inverser le tri par ${LABEL[c.key]}`}>
                  {c.desc ? <ArrowUp size={12} strokeWidth={1.5} /> : <ArrowDown size={12} strokeWidth={1.5} />}
                  {DIRECTION[c.key][c.desc ? 1 : 0]}
                </button>
                <button type="button" onClick={() => setCrit(i, null)} aria-label={`Retirer ${LABEL[c.key]}`}>
                  <X size={12} strokeWidth={1.5} />
                </button>
              </span>
            ))}
            {free.length > 0 && (
              <label className={s.add}>
                <Plus size={12} strokeWidth={1.5} />
                <select value="" onChange={(e) => e.target.value && update({ ...o, criteria: [...o.criteria, { key: e.target.value as SortKey }] })} aria-label="Ajouter un critère" data-testid="sort-add">
                  <option value="">{o.criteria.length ? 'puis…' : 'critère'}</option>
                  {free.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className={s.group}>
            <div className={s.seg} role="radiogroup" aria-label="Portée du tri">
              <button type="button" role="radio" aria-checked={o.scope === 'film'} className={o.scope === 'film' ? s.on : ''} onClick={() => update({ ...o, scope: 'film' })}>
                Tout le film
              </button>
              <button type="button" role="radio" aria-checked={o.scope === 'sequence'} className={o.scope === 'sequence' ? s.on : ''} onClick={() => update({ ...o, scope: 'sequence' })} data-testid="sort-by-sequence">
                Par séquence
              </button>
            </div>
            {seqs.length > 1 && (
              <details className={s.pick} data-testid="sort-sequences">
                <summary>
                  Séquences <b>{chosen.length === seqs.length ? 'toutes' : `${chosen.length} / ${seqs.length}`}</b>
                </summary>
                <div className={s.pickList}>
                  {seqs.map((id) => (
                    <label key={id}>
                      <input type="checkbox" checked={chosen.includes(id)} onChange={(e) => toggleSeq(id, e.target.checked)} />
                      {sequenceHeading(doc, id)}
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </header>
      {view === 'table' ? (
        <div className={[s.preview, 'paper-light'].join(' ')}>
          <ExportTable key={JSON.stringify(o)} doc={virtual} theme="papier" paper="A4" orientation={doc.project.settings.exportPrefs?.grid?.orientation ?? 'landscape'} safety={0} />
        </div>
      ) : (
        <StoryboardPreview doc={virtual} />
      )}
    </div>
  );
}
