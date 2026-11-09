import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  addBreakdownItems,
  breakdownCategories,
  breakdownLabel,
  breakdownOf,
  derivedBreakdown,
  isCustomCategory,
  removeBreakdownItem,
  type BreakdownCategory,
} from '../../domain/breakdown';
import { parseDialogue } from '../../domain/fountain';
import { createSequenceForScene } from '../../domain/scriptToShot';
import { marksIn } from '../../domain/tagging';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import { useUi } from '../../store/uiStore';
import { ask } from '../../ui/dialogStore';
import { TabExport } from '../export/TabExport';
import { breakdownCsv } from '../../domain/exports';
import { breakdownDocument } from '../../domain/documents';
import { paragraphsOf, SceneText, type Paragraph } from './SceneText';
import { BreakdownReports } from './BreakdownReports';
import { breakdownIndex, type BreakdownEntry } from '../../domain/breakdownReport';
import { entriesOf, entryLabel, entryName, entryNumbers, type Entry } from './entries';
import { useRevisionMarks } from '../versions/useRevisionMarks';
import s from './BreakdownPage.module.css';

/** Texte d'une séquence sans passage dans le scénario : ses actions et ses répliques du découpage. */
function sequenceParagraphs(doc: ProjectDoc, seqId: ID): Paragraph[] {
  const out: Paragraph[] = [];
  for (const bId of doc.sequences[seqId]?.actionBlockIds ?? []) {
    const b = doc.blocks[bId];
    if (!b) continue;
    if (b.text?.trim()) out.push({ key: `${bId}-a`, type: 'action', text: b.text });
    if (b.dialogue?.trim())
      parseDialogue(b.dialogue).forEach((r, i) => {
        if (r.speaker) out.push({ key: `${bId}-c${i}`, type: 'character', text: r.speaker.toLocaleUpperCase('fr') });
        out.push({ key: `${bId}-d${i}`, type: 'dialogue', text: r.line });
      });
  }
  return out;
}

/** Séquence du plan sélectionné dans le découpage, s'il y en a un. */
function selectedSequence(doc: ProjectDoc): ID | undefined {
  const row = useUi.getState().selection?.focus.row;
  if (row === undefined) return undefined;
  let k = row;
  for (const id of doc.project.sequenceIds) {
    const n = doc.sequences[id]?.shotIds.length ?? 0;
    if (k < n) return id;
    k -= n;
  }
  return undefined;
}

/** Paragraphes d'une scène : son passage du scénario, sinon les actions et répliques du découpage. */
function paragraphsFor(doc: ProjectDoc, entry: Entry): Paragraph[] {
  if (entry.scene) return paragraphsOf((doc.scenario ?? '').slice(entry.scene.start, entry.scene.end));
  return entry.seqId ? sequenceParagraphs(doc, entry.seqId) : [];
}

/** Éléments repérés dans le texte et pas encore dépouillés (une fois chacun), pour « Tout ajouter ». */
function suggestionsFor(doc: ProjectDoc, entry: Entry, paragraphs: Paragraph[]): Map<string, { cat: BreakdownCategory; item: string }> {
  const out = new Map<string, { cat: BreakdownCategory; item: string }>();
  for (const p of paragraphs) for (const m of marksIn(doc, entry.seqId ?? '', p.text)) if (m.suggested) out.set(`${m.cat}|${m.item.toLocaleLowerCase('fr')}`, { cat: m.cat, item: m.item });
  return out;
}

type View = 'sequence' | 'full' | 'reports';
const VIEW_KEY = 'ds-breakdown-view';
const readView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'full' || v === 'reports' ? v : 'sequence';
  } catch {
    return 'sequence';
  }
};

/**
 * Dépouillement (§15.5) : le texte au centre, qu'on étiquette en le sélectionnant, la fiche à droite.
 * Par séquence : la fiche de la séquence. Scénario entier : la liste complète du film, où ressort ce
 * que demande la séquence lue. Rapports : chaque élément et ses séquences, chaque séquence et ses éléments.
 */
export function BreakdownPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const entries = useMemo(() => entriesOf(doc), [doc]);
  const numbers = useMemo(() => entryNumbers(doc, entries), [doc, entries]);
  const marks = useRevisionMarks(doc);
  const [view, setViewState] = useState<View>(readView);
  const [picked, setPicked] = useState<{ seqId?: ID; sceneStart?: number }>(() => ({ seqId: selectedSequence(doc) }));
  const [hot, setHot] = useState<string | null>(null);
  const flow = useRef<HTMLDivElement>(null);
  const goToLater = useRef<((e: Entry) => void) | null>(null);
  const entry = entries.find((e) => picked.seqId && e.seqId === picked.seqId) ?? entries.find((e) => picked.sceneStart !== undefined && e.scene?.start === picked.sceneStart) ?? entries[0];
  const pick = (e: Entry) => setPicked({ seqId: e.seqId, sceneStart: e.scene?.start });

  const textView = useRef<View>(view === 'reports' ? 'full' : view);
  const setView = (v: View) => {
    if (v !== 'reports') textView.current = v;
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* préférence non retenue */
    }
  };

  // Scénario entier : la séquence lue (la première dont le haut a passé le tiers de l'écran) devient la courante.
  const lock = useRef(0);
  useEffect(() => {
    if (view !== 'full') return;
    const onScroll = () => {
      if (Date.now() < lock.current || !flow.current) return;
      const line = window.innerHeight / 3;
      let current: string | undefined;
      for (const el of Array.from(flow.current.querySelectorAll<HTMLElement>('[data-entry]'))) {
        if (el.getBoundingClientRect().top <= line) current = el.dataset.entry;
        else break;
      }
      const e = entries.find((x) => x.key === current) ?? entries[0];
      if (e && e.key !== entry?.key) pick(e);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  });

  // En passant au scénario entier, on retrouve la séquence courante à sa place.
  useEffect(() => {
    if (view === 'full' && entry) goTo(entry, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (!entry) {
    return (
      <div className="page">
        <div className="card empty">
          <span className="hand">Rien à dépouiller</span>
          <p>Écrivez le scénario ou créez des séquences dans le découpage.</p>
        </div>
      </div>
    );
  }

  goToLater.current = (e: Entry) => goTo(e, false);
  function goTo(e: Entry, smooth = true) {
    pick(e);
    if (view !== 'full') return;
    const el = flow.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(e.key)}"]`);
    if (!el) return;
    lock.current = Date.now() + (smooth ? 900 : 200);
    el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Ajoute au dépouillement d'une scène ; une scène absente du découpage y devient une séquence. */
  const tagIn = (target: Entry, items: Array<{ cat: BreakdownCategory; item: string }>) => {
    const clean = items.map((i) => ({ ...i, item: i.item.trim() })).filter((i) => i.item);
    if (!clean.length) return;
    let created: ID | undefined;
    mutateDoc((d) => {
      let seqId = target.seqId && d.sequences[target.seqId] ? target.seqId : undefined;
      if (!seqId && target.scene) seqId = created = createSequenceForScene(d, d.scenario ?? '', target.scene);
      if (!seqId) return;
      const byCat = new Map<BreakdownCategory, string[]>();
      for (const { cat, item } of clean) byCat.set(cat, [...(byCat.get(cat) ?? []), item]);
      for (const [cat, list] of byCat) addBreakdownItems(d, seqId, cat, list);
    });
    if (created) setPicked({ seqId: created });
    else pick(target);
  };
  const untagIn = (target: Entry, cat: BreakdownCategory, item: string) => target.seqId && mutateDoc((d) => removeBreakdownItem(d, target.seqId!, cat, item));
  const title = doc.project.title || 'projet';

  return (
    <div className={['page page--wide', s.page].join(' ')}>
      <header className={s.toolbar}>
        <div className={s.lead}>
          <div className={s.seg} role="radiogroup" aria-label="Affichage du texte" data-view>
            {(
              [
                ['sequence', 'Par séquence'],
                ['full', 'Scénario entier'],
                ['reports', 'Rapports'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? s.segOn : ''} onClick={() => setView(v)} data-testid={`breakdown-view-${v}`}>
                {label}
              </button>
            ))}
          </div>
          <p className={s.count}>
            {entries.length} séquence{entries.length > 1 ? 's' : ''}
          </p>
        </div>
        <div className={s.tools}>
          <TabExport id="breakdown" orientation="portrait" doc={() => breakdownDocument(useProjectStore.getState().doc ?? doc)} fileBase={`${title}-depouillement`} file={{ label: 'CSV', name: `${title}-depouillement.csv`, content: () => breakdownCsv(useProjectStore.getState().doc ?? doc) }} />
        </div>
      </header>
      {view === 'reports' ? (
        <BreakdownReports
          doc={doc}
          entries={entries}
          onGo={(seqId) => {
            const e = entries.find((x) => x.seqId === seqId);
            if (!e) return;
            setView(textView.current);
            pick(e);
            requestAnimationFrame(() => goToLater.current?.(e));
          }}
        />
      ) : (
      <div className={s.layout}>
        <nav className={s.scenes} aria-label="Séquences" data-view>
          <ol>
            {entries.map((e) => {
              const n = e.seqId ? Object.values(breakdownOf(doc, e.seqId)).reduce((k, l) => k + (l?.length ?? 0), 0) : 0;
              const on = e.key === entry.key;
              return (
                <li key={e.key}>
                  <button type="button" className={on ? s.on : ''} aria-current={on || undefined} onClick={() => goTo(e)} data-testid="breakdown-scene">
                    <span className={s.num}>
                      {e.scene && marks?.get(e.scene.index) && <i className={s.rev} title={marks.get(e.scene.index) === 'new' ? 'Nouvelle dans cette version' : 'Modifiée dans cette version'}>*</i>}
                      {numbers.byKey.get(e.key) ?? '–'}
                    </span>
                    {entryName(doc, e) ? <span className={s.name}>{entryName(doc, e)}</span> : <span className={s.unnamed}>Sans en-tête</span>}
                    {n > 0 && <em>{n}</em>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className={s.center} aria-label={view === 'full' ? 'Texte du scénario' : 'Texte de la séquence'}>
          {view === 'full' ? (
            <div className={[s.sheet, s.sheetFull].join(' ')} ref={flow} data-testid="breakdown-full">
              {entries.map((e) => (
                <EntryText key={e.key} doc={doc} entry={e} n={numbers.byKey.get(e.key)} active={e.key === entry.key} full hot={hot} readOnly={readOnly} onTag={(items) => tagIn(e, items)} onUntag={(cat, item) => untagIn(e, cat, item)} onFocus={() => e.key !== entry.key && pick(e)} />
              ))}
            </div>
          ) : (
            <div className={s.sheet}>
              <EntryText doc={doc} entry={entry} n={numbers.byKey.get(entry.key)} active hot={hot} readOnly={readOnly} onTag={(items) => tagIn(entry, items)} onUntag={(cat, item) => untagIn(entry, cat, item)} />
            </div>
          )}
        </section>

        <aside className={s.sheetSide} aria-label="Fiche de dépouillement">
          {view === 'full' ? (
            <>
              <p className={s.sideHead}>{entryLabel(doc, entry, numbers.byKey.get(entry.key))}</p>
              {!readOnly && <AddAll suggestions={suggestionsFor(doc, entry, paragraphsFor(doc, entry))} onAdd={(items) => tagIn(entry, items)} />}
              <WholeSheet
                doc={doc}
                numberOf={(id) => numbers.bySeq.get(id)}
                labelOf={(id) => {
                  const e = entries.find((x) => x.seqId === id);
                  return e ? entryLabel(doc, e, numbers.byKey.get(e.key)) : '';
                }}
                current={entry.seqId}
                readOnly={readOnly}
                onAdd={(cat, item) => tagIn(entry, [{ cat, item }])}
                onRemove={(cat, item) => untagIn(entry, cat, item)}
                onHot={setHot}
                onGo={(seqId) => {
                  const e = entries.find((x) => x.seqId === seqId);
                  if (e) goTo(e);
                }}
              />
            </>
          ) : (
            /* Une fiche par scène : une saisie commencée ne passe pas à la scène suivante. */
            <BreakdownSheet key={entry.key} doc={doc} seqId={entry.seqId} readOnly={readOnly} onAdd={(cat, items) => tagIn(entry, items.map((item) => ({ cat, item })))} onRemove={(cat, item) => untagIn(entry, cat, item)} onHot={setHot} />
          )}
        </aside>
      </div>
      )}
    </div>
  );
}

/** « Ajouter les N suggestions soulignées » : tout ce que le texte laisse repérer, d'un clic. */
function AddAll({ suggestions, onAdd }: { suggestions: Map<string, { cat: BreakdownCategory; item: string }>; onAdd: (items: Array<{ cat: BreakdownCategory; item: string }>) => void }) {
  if (!suggestions.size) return null;
  return (
    <button type="button" className={s.addAll} onClick={() => onAdd([...suggestions.values()])} data-testid="breakdown-add-all">
      <Plus size={13} strokeWidth={1.5} /> Ajouter les {suggestions.size} suggestion{suggestions.size > 1 ? 's' : ''} soulignée{suggestions.size > 1 ? 's' : ''}
    </button>
  );
}

/** Le texte d'une scène, étiquetable ; en tête, son en-tête s'il n'est pas dans le texte, et ses suggestions. */
function EntryText({
  doc,
  entry,
  n,
  active,
  full,
  hot,
  readOnly,
  onTag,
  onUntag,
  onFocus,
}: {
  doc: ProjectDoc;
  entry: Entry;
  n?: number;
  active: boolean;
  full?: boolean;
  hot: string | null;
  readOnly: boolean;
  onTag: (items: Array<{ cat: BreakdownCategory; item: string }>) => void;
  onUntag: (cat: BreakdownCategory, item: string) => void;
  onFocus?: () => void;
}) {
  const paragraphs = useMemo(() => paragraphsFor(doc, entry), [doc, entry]);
  const suggestions = suggestionsFor(doc, entry, paragraphs);
  const seq = entry.seqId ? doc.sequences[entry.seqId] : undefined;
  const heading = entryLabel(doc, entry, n);
  return (
    <article className={[s.entry, full && active ? s.entryOn : ''].join(' ')} data-entry={entry.key} onMouseDownCapture={onFocus} onFocusCapture={onFocus} data-testid={full ? 'breakdown-entry' : undefined}>
      {/* Le texte du scénario porte déjà son en-tête ; une séquence sans texte écrit affiche le sien. */}
      {(!entry.scene || !entry.seqId) && (
        <header className={s.sceneHead}>
          {!entry.scene && <h2>{heading}</h2>}
          {!entry.seqId && <span className={s.absent}>pas encore au découpage</span>}
        </header>
      )}
      {seq?.summary && <p className={s.summary}>{seq.summary}</p>}
      {!readOnly && active && !full && <AddAll suggestions={suggestions} onAdd={onTag} />}
      {paragraphs.length > 0 && <SceneText doc={doc} seqId={entry.seqId ?? ''} paragraphs={paragraphs} hot={active ? hot : null} readOnly={readOnly} onTag={(cat, item) => onTag([{ cat, item }])} onUntag={onUntag} />}
    </article>
  );
}

/**
 * Scénario entier : la liste complète du film, catégorie par catégorie ; chaque élément porte ses
 * numéros de séquence (un clic y mène). Ce que demande la séquence lue ressort ; le reste s'y ajoute d'un clic.
 */
function WholeSheet({
  doc,
  numberOf,
  labelOf,
  current,
  readOnly,
  onAdd,
  onRemove,
  onHot,
  onGo,
}: {
  doc: ProjectDoc;
  numberOf: (seqId: ID) => number | undefined;
  labelOf: (seqId: ID) => string;
  current?: ID;
  readOnly: boolean;
  onAdd: (cat: BreakdownCategory, item: string) => void;
  onRemove: (cat: BreakdownCategory, item: string) => void;
  onHot: (item: string | null) => void;
  onGo: (seqId: ID) => void;
}) {
  const index = useMemo(() => breakdownIndex(doc), [doc]);
  const byCat = new Map<BreakdownCategory, BreakdownEntry[]>();
  for (const e of index) byCat.set(e.cat, [...(byCat.get(e.cat) ?? []), e]);
  return (
    <div className={s.cats} data-testid="breakdown-whole">
      {breakdownCategories(doc).map((cat) => {
        const list = byCat.get(cat) ?? [];
        const here = list.filter((e) => current && e.seqIds.includes(current)).length;
        return (
          <section key={cat} className={[s.cat, list.length ? '' : s.catEmpty].join(' ')} data-testid={`breakdown-${cat}`}>
            <h3>
              {breakdownLabel(cat)}
              {list.length > 0 && (
                <em title={`${here} dans cette séquence, ${list.length} dans le film`}>
                  {here} / {list.length}
                </em>
              )}
            </h3>
            {list.length > 0 && (
              <ul className={s.whole}>
                {list.map((e) => {
                  const on = !!current && e.seqIds.includes(current);
                  const mine = !!current && e.manualSeqIds.includes(current);
                  return (
                    <li key={e.item} className={[on ? s.here : '', e.manualSeqIds.length ? '' : s.fromCut].join(' ')} onMouseEnter={() => onHot(e.item)} onMouseLeave={() => onHot(null)} data-testid="whole-item">
                      <span className={s.wName}>{e.item}</span>
                      <span className={s.wSeqs} data-view>
                        {[...e.seqIds]
                          .sort((a, b) => (numberOf(a) ?? 0) - (numberOf(b) ?? 0))
                          .map((id) => (
                            <button key={id} type="button" className={id === current ? s.wNow : ''} onClick={() => onGo(id)} title={labelOf(id)}>
                              {numberOf(id)}
                            </button>
                          ))}
                      </span>
                      {!readOnly && current && (mine ? (
                        <button type="button" className={s.wAct} aria-label={`Retirer ${e.item} de cette séquence`} onClick={() => onRemove(cat, e.item)}>
                          <X size={11} />
                        </button>
                      ) : !on ? (
                        <button type="button" className={s.wAct} aria-label={`Ajouter ${e.item} à cette séquence`} onClick={() => onAdd(cat, e.item)}>
                          <Plus size={11} />
                        </button>
                      ) : (
                        <span className={s.wAct} />
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
            {!readOnly && <AddField label={breakdownLabel(cat)} onAdd={(v) => onAdd(cat, v)} />}
          </section>
        );
      })}
    </div>
  );
}

function AddField({ label, onAdd }: { label: string; onAdd: (v: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onAdd(draft);
        setDraft('');
      }}
    >
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter…" aria-label={`Ajouter (${label})`} />
    </form>
  );
}

function BreakdownSheet({
  doc,
  seqId,
  readOnly,
  onAdd,
  onRemove,
  onHot,
}: {
  doc: ProjectDoc;
  seqId?: ID;
  readOnly: boolean;
  onAdd: (cat: BreakdownCategory, items: string[]) => void;
  onRemove: (cat: BreakdownCategory, item: string) => void;
  onHot: (item: string | null) => void;
}) {
  const manual = seqId ? breakdownOf(doc, seqId) : {};
  const derived = seqId ? derivedBreakdown(doc, seqId) : {};
  const [newCat, setNewCat] = useState('');
  return (
    <div className={s.cats}>
      {breakdownCategories(doc).map((cat) => (
        <Category
          key={cat}
          cat={cat}
          derived={derived[cat] ?? []}
          manual={manual[cat] ?? []}
          readOnly={readOnly}
          onAdd={(v) => onAdd(cat, [v])}
          onRemove={(v) => onRemove(cat, v)}
          onHot={onHot}
          onRemoveCategory={
            isCustomCategory(cat) && !readOnly
              ? async () => {
                  const r = await ask({ title: `Supprimer la catégorie « ${breakdownLabel(cat)} » ?`, body: 'Elle disparaît de toutes les séquences (annulable avec ⌘Z).', confirmLabel: 'Supprimer', danger: true });
                  if (!r.ok) return;
                  mutateDoc((d) => {
                    d.breakdownExtra = (d.breakdownExtra ?? []).filter((l) => l !== breakdownLabel(cat));
                    for (const b of Object.values(d.breakdown ?? {})) delete b[cat];
                  });
                }
              : undefined
          }
        />
      ))}
      {!readOnly && (
        <form
          className={s.newCat}
          onSubmit={(e) => {
            e.preventDefault();
            const name = newCat.trim();
            if (!name) return;
            mutateDoc((d) => void (d.breakdownExtra = [...new Set([...(d.breakdownExtra ?? []), name])]));
            setNewCat('');
          }}
        >
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nouvelle catégorie…" aria-label="Nouvelle catégorie" data-testid="add-breakdown-category" />
        </form>
      )}
    </div>
  );
}

function Category({
  cat,
  derived,
  manual,
  readOnly,
  onAdd,
  onRemove,
  onHot,
  onRemoveCategory,
}: {
  cat: BreakdownCategory;
  derived: string[];
  manual: string[];
  readOnly: boolean;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  onHot: (v: string | null) => void;
  onRemoveCategory?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const fromCut = derived.filter((d) => !manual.some((m) => m.toLocaleLowerCase('fr') === d.toLocaleLowerCase('fr')));
  const count = manual.length + fromCut.length;
  return (
    <section className={[s.cat, count ? '' : s.catEmpty].join(' ')} data-testid={`breakdown-${cat}`}>
      <h3>
        {breakdownLabel(cat)}
        {count > 0 && <em>{count}</em>}
        {onRemoveCategory && (
          <button type="button" className={s.removeCat} aria-label={`Supprimer la catégorie ${breakdownLabel(cat)}`} onClick={onRemoveCategory}>
            <X size={12} />
          </button>
        )}
      </h3>
      {count > 0 && (
        <ul>
          {fromCut.map((d) => (
            <li key={`d-${d}`} className={s.derived} title="Déduit du découpage" onMouseEnter={() => onHot(d)} onMouseLeave={() => onHot(null)}>
              {d}
            </li>
          ))}
          {manual.map((m) => (
            <li key={m} onMouseEnter={() => onHot(m)} onMouseLeave={() => onHot(null)}>
              {m}
              {!readOnly && (
                <button type="button" aria-label={`Retirer ${m}`} onClick={() => onRemove(m)}>
                  <X size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onAdd(draft);
            setDraft('');
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter…" aria-label={`Ajouter (${breakdownLabel(cat)})`} />
        </form>
      )}
    </section>
  );
}
