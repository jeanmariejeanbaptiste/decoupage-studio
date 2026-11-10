import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import {
  addBreakdownItems,
  addedCharacters,
  breakdownCategories,
  breakdownLabel,
  addCustomCategory,
  breakdownOf,
  categoryNamed,
  derivedBreakdown,
  isCharacterCategory,
  isCustomCategory,
  moveBreakdownItem,
  removeBreakdownItem,
  renameBreakdownItem,
  renameCustomCategory,
  type BreakdownCategory,
} from '../../domain/breakdown';
import { sequenceCharacterIds } from '../../domain/characters';
import { fold } from '../../domain/text';
import { parseDialogue } from '../../domain/fountain';
import { createSequenceForScene } from '../../domain/scriptToShot';
import type { ID, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import { useUi } from '../../store/uiStore';
import { ask } from '../../ui/dialogStore';
import { TabExport } from '../export/TabExport';
import { breakdownCsv } from '../../domain/exports';
import { breakdownDocument } from '../../domain/documents';
import { paragraphMarks, paragraphsOf, SceneText, type Paragraph } from './SceneText';
import { BreakdownReports } from './BreakdownReports';
import { breakdownIndex, itemCountBySequence, type BreakdownEntry } from '../../domain/breakdownReport';
import { entriesOf, entryLabel, entryName, entryNumbers, type Entry } from './entries';
import { useRevisionMarks } from '../versions/useRevisionMarks';
import s from './BreakdownPage.module.css';
import { exportBase } from '../../domain/serialize';

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
  for (const ms of paragraphMarks(doc, entry.seqId ?? '', paragraphs)) for (const m of ms) if (m.suggested) out.set(`${m.cat}|${fold(m.item)}`, { cat: m.cat, item: m.item });
  return out;
}

/** Ce qu'une catégorie propose à la saisie : les éléments du film (ou les fiches du registre), hors ceux de la séquence. */
function choicesFor(doc: ProjectDoc, index: readonly BreakdownEntry[], cat: BreakdownCategory, seqId?: ID): string[] {
  if (isCharacterCategory(cat)) {
    const here = new Set(seqId ? sequenceCharacterIds(doc, seqId) : []);
    const extra = (k?: string) => k === 'figurant' || k === 'silhouette';
    return Object.values(doc.characters)
      .filter((c) => !here.has(c.id) && extra(c.kind) === (cat === 'figurants'))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }
  return index.filter((e) => e.cat === cat && !(seqId && e.seqIds.includes(seqId))).map((e) => e.item);
}

/** Une liste collée (lignes ou cellules de tableur) : un élément par ligne ; sinon, collage ordinaire. */
function pastedList(e: ClipboardEvent<HTMLInputElement>): string[] | null {
  const text = e.clipboardData.getData('text/plain');
  if (!/[\n\t]/.test(text.trim())) return null;
  const items = text.split(/[\r\n\t]+/).map((x) => x.trim()).filter(Boolean);
  if (!items.length) return null;
  e.preventDefault();
  return items;
}

/** Saisie en place d'un nom : Entrée valide, Échap (ou quitter le champ) annule. */
function InlineRename({ value, label, onCommit, onDone }: { value: string; label: string; onCommit: (v: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className={s.rename}
      value={draft}
      autoFocus
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
          onDone();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      data-testid="breakdown-rename"
    />
  );
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
  const index = useMemo(() => breakdownIndex(doc), [doc]);
  const counts = useMemo(() => itemCountBySequence(index), [index]);
  const marks = useRevisionMarks(doc);
  const [view, setViewState] = useState<View>(readView);
  const [picked, setPicked] = useState<{ seqId?: ID; sceneStart?: number }>(() => ({ seqId: selectedSequence(doc) }));
  const [hot, setHot] = useState<string | null>(null);
  const flow = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
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
  // Une mesure par image au plus, sans réabonner l'écouteur à chaque rendu.
  const lock = useRef(0);
  const currentKey = useRef<string | undefined>(undefined);
  currentKey.current = entry?.key;
  useEffect(() => {
    if (view !== 'full') return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Date.now() < lock.current || !flow.current) return;
      const line = window.innerHeight / 3;
      let current: string | undefined;
      for (const el of Array.from(flow.current.querySelectorAll<HTMLElement>('[data-entry]'))) {
        if (el.getBoundingClientRect().top <= line) current = el.dataset.entry;
        else break;
      }
      const e = entries.find((x) => x.key === current) ?? entries[0];
      if (e && e.key !== currentKey.current) setPicked({ seqId: e.seqId, sceneStart: e.scene?.start });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, [view, entries]);

  // La liste des séquences garde la courante en vue (sans faire défiler la page).
  useEffect(() => {
    const box = nav.current;
    const on = box?.querySelector<HTMLElement>('[aria-current]');
    if (!box || !on) return;
    for (const el of [box, box.querySelector('ol')]) {
      if (!el) continue;
      const outer = el.getBoundingClientRect();
      const r = on.getBoundingClientRect();
      if (el.scrollHeight > el.clientHeight + 1) {
        if (r.top < outer.top) el.scrollTop -= outer.top - r.top + 8;
        else if (r.bottom > outer.bottom) el.scrollTop += r.bottom - outer.bottom + 8;
      }
      if (el.scrollWidth > el.clientWidth + 1) {
        if (r.left < outer.left) el.scrollLeft -= outer.left - r.left + 8;
        else if (r.right > outer.right) el.scrollLeft += r.right - outer.right + 8;
      }
    }
  }, [entry?.key, view]);

  // « Ajouter les N suggestions » de la liste du film : seulement pour la séquence courante.
  const sideSuggestions = useMemo(() => (entry && view === 'full' && !readOnly ? suggestionsFor(doc, entry, paragraphsFor(doc, entry)) : null), [doc, entry, view, readOnly]);

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
    // La scène reste repérée par sa place : une annulation qui retire la séquence n'y change rien.
    if (created) setPicked({ seqId: created, sceneStart: target.scene?.start });
    else pick(target);
  };
  const untagIn = (target: Entry, cat: BreakdownCategory, item: string) => target.seqId && mutateDoc((d) => removeBreakdownItem(d, target.seqId!, cat, item));
  const moveIn = (target: Entry, from: BreakdownCategory, to: BreakdownCategory, item: string) => target.seqId && mutateDoc((d) => moveBreakdownItem(d, target.seqId!, from, to, item));

  const views = [
    ['sequence', 'Par séquence'],
    ['full', 'Scénario entier'],
    ['reports', 'Rapports'],
  ] as const;
  // Groupe radio : les flèches changent d'affichage.
  const onViewKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = views.findIndex(([v]) => v === view);
    const next = views[(i + dir + views.length) % views.length][0];
    const group = e.currentTarget;
    setView(next);
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-testid="breakdown-view-${next}"]`)?.focus());
  };
  // Liste des séquences : ↑ et ↓ (Début, Fin) passent à la voisine.
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = entries.findIndex((x) => x.key === entry.key);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : -1;
    if (to < 0 || to >= entries.length || (e.key.startsWith('Arrow') && to === i)) return;
    e.preventDefault();
    goTo(entries[to]);
    e.currentTarget.querySelectorAll<HTMLElement>('[data-testid="breakdown-scene"]')[to]?.focus({ preventScroll: true });
  };
  const title = exportBase(doc);

  return (
    <div className={['page page--wide', s.page].join(' ')}>
      <header className={s.toolbar}>
        <div className={s.lead}>
          <div className={s.seg} role="radiogroup" aria-label="Affichage du texte" data-view onKeyDown={onViewKey}>
            {views.map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} tabIndex={view === v ? 0 : -1} className={view === v ? s.segOn : ''} onClick={() => setView(v)} data-testid={`breakdown-view-${v}`}>
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
        <nav ref={nav} className={s.scenes} aria-label="Séquences" data-view onKeyDown={onNavKey}>
          <ol>
            {entries.map((e) => {
              const n = e.seqId ? (counts.get(e.seqId) ?? 0) : 0;
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
                <EntryText key={e.key} doc={doc} entry={e} n={numbers.byKey.get(e.key)} active={e.key === entry.key} full hot={hot} readOnly={readOnly} onTag={(items) => tagIn(e, items)} onUntag={(cat, item) => untagIn(e, cat, item)} onMove={(from, to, item) => moveIn(e, from, to, item)} onFocus={() => e.key !== entry.key && pick(e)} />
              ))}
            </div>
          ) : (
            <div className={s.sheet}>
              <EntryText doc={doc} entry={entry} n={numbers.byKey.get(entry.key)} active hot={hot} readOnly={readOnly} onTag={(items) => tagIn(entry, items)} onUntag={(cat, item) => untagIn(entry, cat, item)} onMove={(from, to, item) => moveIn(entry, from, to, item)} />
            </div>
          )}
        </section>

        <aside className={s.sheetSide} aria-label="Fiche de dépouillement">
          {view === 'full' ? (
            <>
              <p className={s.sideHead}>{entryLabel(doc, entry, numbers.byKey.get(entry.key))}</p>
              {sideSuggestions && <AddAll suggestions={sideSuggestions} onAdd={(items) => tagIn(entry, items)} />}
              <WholeSheet
                doc={doc}
                index={index}
                numberOf={(id) => numbers.bySeq.get(id)}
                labelOf={(id) => {
                  const e = entries.find((x) => x.seqId === id);
                  return e ? entryLabel(doc, e, numbers.byKey.get(e.key)) : '';
                }}
                current={entry.seqId}
                readOnly={readOnly}
                onAdd={(cat, items) => tagIn(entry, items.map((item) => ({ cat, item })))}
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
            <BreakdownSheet key={entry.key} doc={doc} index={index} seqId={entry.seqId} readOnly={readOnly} onAdd={(cat, items) => tagIn(entry, items.map((item) => ({ cat, item })))} onRemove={(cat, item) => untagIn(entry, cat, item)} onHot={setHot} />
          )}
        </aside>
      </div>
      )}
    </div>
  );
}

/** « Ajouter la suggestion soulignée » ou « les N suggestions soulignées » : tout ce que le texte laisse repérer, d'un clic. */
function AddAll({ suggestions, onAdd }: { suggestions: Map<string, { cat: BreakdownCategory; item: string }>; onAdd: (items: Array<{ cat: BreakdownCategory; item: string }>) => void }) {
  if (!suggestions.size) return null;
  return (
    <button type="button" className={s.addAll} onClick={() => onAdd([...suggestions.values()])} data-testid="breakdown-add-all">
      <Plus size={13} strokeWidth={1.5} /> {suggestions.size > 1 ? `Ajouter les ${suggestions.size} suggestions soulignées` : 'Ajouter la suggestion soulignée'}
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
  onMove,
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
  onMove: (from: BreakdownCategory, to: BreakdownCategory, item: string) => void;
  onFocus?: () => void;
}) {
  const paragraphs = useMemo(() => paragraphsFor(doc, entry), [doc, entry]);
  // Seule la fiche d'une séquence propose « Tout ajouter » en tête du texte (la liste du film a le sien).
  const suggestions = useMemo(() => (!readOnly && active && !full ? suggestionsFor(doc, entry, paragraphs) : null), [doc, entry, paragraphs, readOnly, active, full]);
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
      {suggestions && <AddAll suggestions={suggestions} onAdd={onTag} />}
      {paragraphs.length > 0 && <SceneText doc={doc} seqId={entry.seqId ?? ''} paragraphs={paragraphs} hot={active ? hot : null} readOnly={readOnly} onTag={(cat, item) => onTag([{ cat, item }])} onUntag={onUntag} onMove={onMove} />}
    </article>
  );
}

/**
 * Scénario entier : la liste complète du film, catégorie par catégorie ; chaque élément porte ses
 * numéros de séquence (un clic y mène). Ce que demande la séquence lue ressort ; le reste s'y ajoute d'un clic.
 */
function WholeSheet({
  doc,
  index,
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
  index: readonly BreakdownEntry[];
  numberOf: (seqId: ID) => number | undefined;
  labelOf: (seqId: ID) => string;
  current?: ID;
  readOnly: boolean;
  onAdd: (cat: BreakdownCategory, items: string[]) => void;
  onRemove: (cat: BreakdownCategory, item: string) => void;
  onHot: (item: string | null) => void;
  onGo: (seqId: ID) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const byCat = new Map<BreakdownCategory, BreakdownEntry[]>();
  for (const e of index) byCat.set(e.cat, [...(byCat.get(e.cat) ?? []), e]);
  return (
    <div className={s.cats} data-testid="breakdown-whole">
      {breakdownCategories(doc).map((cat) => {
        const list = byCat.get(cat) ?? [];
        // Lecture seule : une catégorie vide n'a rien à montrer.
        if (readOnly && !list.length) return null;
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
                  // Renommable dans tout le film : saisi partout où il figure (ni personnage, ni matériel déduit).
                  const renamable = !readOnly && !isCharacterCategory(cat) && e.manualSeqIds.length === e.seqIds.length;
                  const key = `${cat}|${e.item}`;
                  return (
                    <li key={e.item} className={[on ? s.here : '', e.manualSeqIds.length ? '' : s.fromCut].join(' ')} onMouseEnter={() => onHot(e.item)} onMouseLeave={() => onHot(null)} data-testid="whole-item">
                      {renaming === key ? (
                        <InlineRename value={e.item} label={`Renommer ${e.item}`} onCommit={(v) => mutateDoc((d) => void renameBreakdownItem(d, cat, e.item, v))} onDone={() => setRenaming(null)} />
                      ) : (
                        <span className={s.wName} onDoubleClick={renamable ? () => setRenaming(key) : undefined}>
                          {e.item}
                        </span>
                      )}
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
                        <button type="button" className={s.wAct} aria-label={`Ajouter ${e.item} à cette séquence`} onClick={() => onAdd(cat, [e.item])}>
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
            {!readOnly && <AddField label={breakdownLabel(cat)} choices={choicesFor(doc, index, cat, current)} onAdd={(v) => onAdd(cat, v)} />}
          </section>
        );
      })}
    </div>
  );
}

function AddField({ label, choices, onAdd }: { label: string; choices: readonly string[]; onAdd: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onAdd([draft]);
        setDraft('');
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          const items = pastedList(e);
          if (items) onAdd(items);
        }}
        placeholder="Ajouter…"
        aria-label={`Ajouter (${label})`}
        list={choices.length ? listId : undefined}
      />
      {choices.length > 0 && (
        <datalist id={listId}>
          {choices.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      )}
    </form>
  );
}

function BreakdownSheet({
  doc,
  index,
  seqId,
  readOnly,
  onAdd,
  onRemove,
  onHot,
}: {
  doc: ProjectDoc;
  index: readonly BreakdownEntry[];
  seqId?: ID;
  readOnly: boolean;
  onAdd: (cat: BreakdownCategory, items: string[]) => void;
  onRemove: (cat: BreakdownCategory, item: string) => void;
  onHot: (item: string | null) => void;
}) {
  const manual = seqId ? breakdownOf(doc, seqId) : {};
  const derived = seqId ? derivedBreakdown(doc, seqId) : {};
  const added = seqId ? addedCharacters(doc, seqId) : {};
  const [newCat, setNewCat] = useState('');
  const box = useRef<HTMLDivElement>(null);
  return (
    <div className={s.cats} ref={box}>
      {breakdownCategories(doc).map((cat) => (
        <Category
          key={cat}
          cat={cat}
          derived={derived[cat] ?? []}
          removable={added[cat] ?? []}
          manual={manual[cat] ?? []}
          choices={readOnly ? [] : choicesFor(doc, index, cat, seqId)}
          readOnly={readOnly}
          onAdd={(v) => onAdd(cat, v)}
          onRemove={(v) => onRemove(cat, v)}
          onHot={onHot}
          onRename={isCustomCategory(cat) && !readOnly ? (to) => mutateDoc((d) => void renameCustomCategory(d, breakdownLabel(cat), to)) : undefined}
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
            setNewCat('');
            // Un nom déjà pris (« Son », « décor » pour « Décor ») mène à la catégorie existante.
            const same = categoryNamed(doc, name);
            if (same) box.current?.querySelector<HTMLInputElement>(`[data-testid="breakdown-${CSS.escape(same)}"] input`)?.focus();
            else mutateDoc((d) => void addCustomCategory(d, name));
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
  removable,
  manual,
  choices,
  readOnly,
  onAdd,
  onRemove,
  onHot,
  onRename,
  onRemoveCategory,
}: {
  cat: BreakdownCategory;
  derived: string[];
  /** Éléments déduits qu'on retire pourtant d'ici (personnages ajoutés à la séquence, pas à ses plans). */
  removable: string[];
  manual: string[];
  /** Propositions de saisie (éléments du film, fiches du registre). */
  choices: readonly string[];
  readOnly: boolean;
  onAdd: (v: string[]) => void;
  onRemove: (v: string) => void;
  onHot: (v: string | null) => void;
  onRename?: (to: string) => void;
  onRemoveCategory?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const fromCut = derived.filter((d) => !manual.some((m) => fold(m) === fold(d)));
  const count = manual.length + fromCut.length;
  // Lecture seule : une catégorie vide n'a rien à montrer.
  if (readOnly && !count) return null;
  return (
    <section className={[s.cat, count ? '' : s.catEmpty].join(' ')} data-testid={`breakdown-${cat}`}>
      <h3>
        {renaming && onRename ? (
          <InlineRename value={breakdownLabel(cat)} label={`Renommer la catégorie ${breakdownLabel(cat)}`} onCommit={onRename} onDone={() => setRenaming(false)} />
        ) : (
          <span onDoubleClick={onRename ? () => setRenaming(true) : undefined}>{breakdownLabel(cat)}</span>
        )}
        {count > 0 && <em>{count}</em>}
        {onRemoveCategory && (
          <button type="button" className={s.removeCat} aria-label={`Supprimer la catégorie ${breakdownLabel(cat)}`} onClick={onRemoveCategory}>
            <X size={12} />
          </button>
        )}
      </h3>
      {count > 0 && (
        <ul>
          {fromCut.map((d) =>
            removable.includes(d) ? (
              <li key={`d-${d}`} onMouseEnter={() => onHot(d)} onMouseLeave={() => onHot(null)}>
                {d}
                {!readOnly && (
                  <button type="button" aria-label={`Retirer ${d}`} onClick={() => onRemove(d)}>
                    <X size={11} />
                  </button>
                )}
              </li>
            ) : (
              <li key={`d-${d}`} className={s.derived} title="Déduit du découpage" onMouseEnter={() => onHot(d)} onMouseLeave={() => onHot(null)}>
                {d}
              </li>
            ),
          )}
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
      {!readOnly && <AddField label={breakdownLabel(cat)} choices={choices} onAdd={onAdd} />}
    </section>
  );
}
