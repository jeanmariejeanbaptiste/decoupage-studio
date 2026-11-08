import { useMemo, useState } from 'react';
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
import { matchSequence, parseDialogue, scenesOf, type Scene } from '../../domain/fountain';
import { sequenceHeading } from '../../domain/numbering';
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
import s from './BreakdownPage.module.css';

/** Une scène à dépouiller : scène du scénario, séquence du découpage, ou les deux. */
interface Entry {
  key: string;
  seqId?: ID;
  scene?: Scene;
}

/** Scènes dans l'ordre du scénario (avec leur séquence), puis les séquences sans passage écrit. */
function entriesOf(doc: ProjectDoc): Entry[] {
  const scenes = scenesOf(doc.scenario ?? '');
  const used = new Set<ID>();
  const out: Entry[] = [];
  for (const sc of scenes) {
    const id = matchSequence(doc, sc);
    const seqId = id && !used.has(id) ? id : undefined;
    if (seqId) used.add(seqId);
    out.push({ key: seqId ?? `scene-${sc.start}`, seqId, scene: sc });
  }
  for (const id of doc.project.sequenceIds) if (!used.has(id)) out.push({ key: id, seqId: id });
  return out;
}

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

/** Dépouillement scène par scène (§15.5) : le texte à gauche du dépouillement, qu'on étiquette en le sélectionnant. */
export function BreakdownPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const entries = useMemo(() => entriesOf(doc), [doc]);
  const [picked, setPicked] = useState<{ seqId?: ID; sceneStart?: number }>(() => ({ seqId: selectedSequence(doc) }));
  const [hot, setHot] = useState<string | null>(null);
  const entry = entries.find((e) => picked.seqId && e.seqId === picked.seqId) ?? entries.find((e) => picked.sceneStart !== undefined && e.scene?.start === picked.sceneStart) ?? entries[0];

  const paragraphs = useMemo(() => {
    if (!entry) return [];
    if (entry.scene) return paragraphsOf((doc.scenario ?? '').slice(entry.scene.start, entry.scene.end));
    return entry.seqId ? sequenceParagraphs(doc, entry.seqId) : [];
  }, [entry, doc]);

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

  /** Ajoute au dépouillement de la scène ; une scène absente du découpage y devient une séquence. */
  const tag = (cat: BreakdownCategory, items: string[]) => {
    const clean = items.map((i) => i.trim()).filter(Boolean);
    if (!clean.length) return;
    let created: ID | undefined;
    mutateDoc((d) => {
      let seqId = entry.seqId && d.sequences[entry.seqId] ? entry.seqId : undefined;
      if (!seqId && entry.scene) seqId = created = createSequenceForScene(d, d.scenario ?? '', entry.scene);
      if (seqId) addBreakdownItems(d, seqId, cat, clean);
    });
    if (created) setPicked({ seqId: created });
  };
  const untag = (cat: BreakdownCategory, item: string) => entry.seqId && mutateDoc((d) => removeBreakdownItem(d, entry.seqId!, cat, item));

  // Suggestions repérées dans le texte (une fois chacune), pour « Tout ajouter ».
  const suggestions = new Map<string, { cat: BreakdownCategory; item: string }>();
  if (entry.seqId || entry.scene) {
    const seqForMarks = entry.seqId ?? '';
    for (const p of paragraphs) for (const m of marksIn(doc, seqForMarks, p.text)) if (m.suggested) suggestions.set(`${m.cat}|${m.item.toLocaleLowerCase('fr')}`, { cat: m.cat, item: m.item });
  }
  const seq = entry.seqId ? doc.sequences[entry.seqId] : undefined;
  const heading = entry.seqId ? sequenceHeading(doc, entry.seqId) : entry.scene?.heading.toLocaleUpperCase('fr');
  const title = doc.project.title || 'projet';

  return (
    <div className={['page page--wide', s.page].join(' ')}>
      <header className={s.toolbar}>
        <p className={s.count}>
          {entries.length} scène{entries.length > 1 ? 's' : ''}
        </p>
        <TabExport id="breakdown" orientation="portrait" doc={() => breakdownDocument(useProjectStore.getState().doc ?? doc)} fileBase={`${title}-depouillement`} file={{ label: 'CSV', name: `${title}-depouillement.csv`, content: () => breakdownCsv(useProjectStore.getState().doc ?? doc) }} />
      </header>
      <div className={s.layout}>
        <nav className={s.scenes} aria-label="Scènes">
          <ol>
            {entries.map((e) => {
              const n = e.seqId ? Object.values(breakdownOf(doc, e.seqId)).reduce((k, l) => k + (l?.length ?? 0), 0) : 0;
              const on = e.key === entry.key;
              return (
                <li key={e.key}>
                  <button type="button" className={on ? s.on : ''} aria-current={on || undefined} onClick={() => setPicked({ seqId: e.seqId, sceneStart: e.scene?.start })} data-testid="breakdown-scene">
                    <span className={s.num}>{e.seqId ? doc.project.sequenceIds.indexOf(e.seqId) + 1 : '–'}</span>
                    <span className={s.name}>{e.seqId ? sequenceHeading(doc, e.seqId).replace(/^\d+,\s*/, '') : e.scene?.location.toLocaleUpperCase('fr')}</span>
                    {n > 0 && <em>{n}</em>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className={s.center} aria-label="Texte de la scène">
          <div className={s.sheet}>
            {/* Le texte du scénario porte déjà son en-tête ; une séquence sans texte écrit affiche le sien. */}
            {(!entry.scene || !entry.seqId) && (
              <header className={s.sceneHead}>
                {!entry.scene && <h2>{heading}</h2>}
                {!entry.seqId && <span className={s.absent}>pas encore au découpage</span>}
              </header>
            )}
            {seq?.summary && <p className={s.summary}>{seq.summary}</p>}
            {!readOnly && suggestions.size > 0 && (
              <button
                type="button"
                className={s.addAll}
                onClick={() => {
                  const byCat = new Map<BreakdownCategory, string[]>();
                  for (const { cat, item } of suggestions.values()) byCat.set(cat, [...(byCat.get(cat) ?? []), item]);
                  let created: ID | undefined;
                  mutateDoc((d) => {
                    let seqId = entry.seqId && d.sequences[entry.seqId] ? entry.seqId : undefined;
                    if (!seqId && entry.scene) seqId = created = createSequenceForScene(d, d.scenario ?? '', entry.scene);
                    if (seqId) for (const [cat, items] of byCat) addBreakdownItems(d, seqId, cat, items);
                  });
                  if (created) setPicked({ seqId: created });
                }}
                data-testid="breakdown-add-all"
              >
                <Plus size={13} strokeWidth={1.5} /> Ajouter les {suggestions.size} suggestion{suggestions.size > 1 ? 's' : ''} soulignée{suggestions.size > 1 ? 's' : ''}
              </button>
            )}
            <SceneText doc={doc} seqId={entry.seqId ?? ''} paragraphs={paragraphs} hot={hot} readOnly={readOnly} onTag={(cat, item) => tag(cat, [item])} onUntag={untag} />
          </div>
        </section>

        <aside className={s.sheetSide} aria-label="Fiche de dépouillement">
          <BreakdownSheet doc={doc} seqId={entry.seqId} readOnly={readOnly} onAdd={tag} onRemove={untag} onHot={setHot} />
        </aside>
      </div>
    </div>
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
