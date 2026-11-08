import { useReadOnly } from '../../store/share';
import { LinkModeToggle, addPassageAsShot } from './ScriptReader';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FilePlus2, FileText, FileUp } from 'lucide-react';
import { importScenes, matchSequence, parseDialogue, relinkAnchors, scenesOf } from '../../domain/fountain';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import { BLOCK_LABELS, blockLabel, scriptStats, type BlockType } from '../../domain/screenplay';
import { blockTypeKey } from '../../domain/shortcuts';
import type { ID, ProjectDoc } from '../../domain/types';
import { pickFile, registerFlush } from '../../store/persistence';
import { mutateDoc, undo, useProjectStore } from '../../store/projectStore';
import { ask } from '../../ui/dialogStore';
import { readScenarioFile } from './readScenarioFile';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { useIsMobile } from '../../ui/useIsMobile';
import { ScriptExportButton } from './ScriptExportButton';
import { goToShot } from '../registry/RegistryPage';
import { PAGE, ScriptEditor, useScriptUi, type ScriptEditorApi } from './ScriptEditor';
import { CharactersPanel, DecorsPanel, ResearchPanel } from './ResearchPanels';
import s from './ScenarioPage.module.css';

type Tab = 'scenes' | 'characters' | 'decors' | 'research' | 'shots' | 'stats';
const TABS: ReadonlyArray<[Tab, string]> = [
  ['scenes', 'Séquences'],
  ['characters', 'Personnages'],
  ['decors', 'Décors'],
  ['research', 'Recherche'],
  ['shots', 'Plans'],
  ['stats', 'Statistiques'],
];

const savedTab = (): Tab => {
  try {
    const t = localStorage.getItem('ds-scenario-tab');
    return TABS.some(([k]) => k === t) ? (t as Tab) : 'scenes';
  } catch {
    return 'scenes';
  }
};

/** Scénario : écrit sur des pages A4, comme dans un logiciel d'écriture, et relié au découpage. */
export function ScenarioPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const phone = useIsMobile();
  const [view, setView] = useState<'script' | 'cut'>('script');
  const [tab, setTabState] = useState<Tab>(savedTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem('ds-scenario-tab', t);
    } catch {
      /* choix valable pour la session */
    }
  };
  const [hover, setHover] = useState<ID | null>(null);
  const [caretAnchor, setCaretAnchor] = useState<ID | null>(null);
  const api = useRef<ScriptEditorApi | null>(null);
  const hadSelection = useRef(true);
  const activeType = useScriptUi((u) => u.activeType);
  const selection = useScriptUi((u) => u.selection);
  const toast = useUi((u) => u.toast);

  // Passages déjà liés au découpage : surlignés dans le texte.
  const anchors = useMemo(
    () =>
      Object.values(doc.blocks)
        .filter((b) => b.scenarioAnchor && b.scenarioAnchor.end > b.scenarioAnchor.start)
        .map((b) => ({ id: b.id, start: b.scenarioAnchor!.start, end: b.scenarioAnchor!.end })),
    [doc.blocks],
  );

  // Saisie en attente appliquée avant un enregistrement ou un export.
  useEffect(() => registerFlush(() => api.current?.flush()), []);

  // La page A4 se réduit pour tenir dans la largeur disponible.
  const center = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = center.current;
    if (!el || phone) return;
    const fit = () => setZoom(Math.max(0.55, Math.min(1, (el.clientWidth - 8) / (PAGE.w + 60))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone, view]);

  /** Crée un plan avec le passage sélectionné : dans la séquence de sa scène (mode lié) ou au choix. */
  const createShot = (at: { x: number; y: number }) => {
    const sel = useScriptUi.getState().selection;
    if (!sel) {
      toast({ message: 'Sélectionnez d’abord un passage du scénario.', tone: 'warn' });
      return;
    }
    api.current?.flush();
    addPassageAsShot(sel.start, sel.end, at);
  };

  const importFile = async () => {
    const f = await pickFile('.fountain,.fdx,.txt,.spmd,.md,.markdown,.pdf,.docx,.doc,text/plain,application/pdf', false);
    if (!f) return;
    api.current?.flush();
    if ((useProjectStore.getState().doc?.scenario ?? '').trim()) {
      const r = await ask({ title: 'Remplacer le scénario actuel ?', body: `Le texte de « ${f.name} » remplacera le scénario en cours (annulable).`, confirmLabel: 'Remplacer' });
      if (!r.ok) return;
    }
    try {
      const content = await readScenarioFile(f);
      // Remplacement complet : les passages liés aux plans sont retrouvés par leur texte, ou détachés.
      let dropped = 0;
      mutateDoc((d) => {
        dropped = relinkAnchors(d, d.scenario ?? '', content);
        d.scenario = content;
      });
      const n = scenesOf(content).length;
      const links = dropped ? ` ${dropped} passage${dropped > 1 ? 's' : ''} lié${dropped > 1 ? 's' : ''} introuvable${dropped > 1 ? 's' : ''}, détaché${dropped > 1 ? 's' : ''}.` : '';
      toast({ message: `Scénario importé : ${n} séquence${n > 1 ? 's' : ''}. Le découpage n’est pas modifié.${links}`, actionLabel: 'Annuler', action: undo });
    } catch (e) {
      toast({ message: (e as Error).message || 'Ce fichier n’a pas pu être lu.', tone: 'warn' });
    }
  };

  const title = doc.project.title || 'scenario';
  const current = () => useProjectStore.getState().doc ?? doc;

  const sideBlocks = useScriptUi((u) => u.blocks);
  // Aller à une séquence depuis un panneau (sommaire, personnages, décors).
  const goTo = (id: string) => {
    if (view !== 'script') {
      setView('script');
      setTimeout(() => api.current?.scrollTo(id), 60);
    } else api.current?.scrollTo(id);
  };
  return (
    <div className={['page page--wide', s.page].join(' ')}>
      <header className={s.toolbar}>
        <div className={s.tools}>
          {!readOnly && view === 'script' && (
            <>
              <TypePicker type={activeType} onPick={(t) => api.current?.setType(t)} />
              <Button icon={<FileText size={15} strokeWidth={1.25} />} onMouseDown={(e) => e.preventDefault()} onClick={() => api.current?.editTitle()} data-testid="edit-title-page">
                Page de garde
              </Button>
              <Button
                icon={<FilePlus2 size={15} strokeWidth={1.25} />}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  createShot({ x: r.left, y: r.bottom + 4 });
                }}
                disabled={!selection}
                title="Créer un plan avec le passage sélectionné (aussi au clic droit)"
                data-testid="create-shot-from-selection"
              >
                Créer un plan
              </Button>
            </>
          )}
          <div className={s.seg} role="radiogroup" aria-label="Affichage du scénario">
            {(
              [
                ['script', 'Scénario', 'Le texte, page par page'],
                ['cut', 'Découpage', 'Le découpage technique mis en forme comme un scénario (lecture seule)'],
              ] as const
            ).map(([v, label, hint]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className={view === v ? s.on : ''}
                title={hint}
                data-view
                onClick={() => {
                  api.current?.flush();
                  setView(v);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={s.tools}>
          {view === 'script' && !phone && <Chrono />}
          {!readOnly && (
            <Button variant="outline" icon={<FileUp size={15} strokeWidth={1.25} />} onClick={importFile} title="Final Draft, Fountain, PDF, Word, Markdown ou texte">
              Importer
            </Button>
          )}
          <ScriptExportButton doc={doc} current={current} title={title} />
        </div>
      </header>

      <div className={s.layout}>
        <div className={s.center} ref={center}>
          {view === 'cut' ? (
            <div className={['a4-sheet', s.cutSheet].join(' ')}>
              <CutView doc={doc} />
            </div>
          ) : (
            <div
              className={s.zoom}
              style={phone ? undefined : { zoom }}
              // Safari sélectionne le mot sous un clic droit : seule une sélection faite avant compte.
              onPointerDownCapture={(e) => {
                if (e.button === 2) hadSelection.current = !!useScriptUi.getState().selection;
              }}
              onContextMenu={(e) => {
                // Clic droit sur une sélection : le passage devient un plan.
                if (readOnly || !useScriptUi.getState().selection || !hadSelection.current) return;
                e.preventDefault();
                createShot({ x: e.clientX, y: e.clientY });
              }}
            >
              <ScriptEditor
                key={doc.project.id}
                doc={doc}
                readOnly={readOnly}
                anchors={anchors}
                hot={hover ?? caretAnchor}
                onCaretAnchor={setCaretAnchor}
                apiRef={api}
                paged={!phone}
              />
            </div>
          )}
        </div>

        <aside className={s.side} aria-label="Navigation du scénario">
          <div className={s.tabs} role="tablist">
            {TABS.map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? s.tabOn : ''} onClick={() => setTab(t)} data-testid={`scenario-tab-${t}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'scenes' && <Outline onPick={goTo} />}
          {tab === 'characters' && <CharactersPanel doc={doc} blocks={sideBlocks} readOnly={readOnly} onGo={goTo} />}
          {tab === 'decors' && <DecorsPanel doc={doc} blocks={sideBlocks} readOnly={readOnly} onGo={goTo} />}
          {tab === 'research' && <ResearchPanel doc={doc} readOnly={readOnly} />}
          {tab === 'shots' && <ShotsPanel doc={doc} readOnly={readOnly} hot={hover ?? caretAnchor} onHover={setHover} onFlush={() => api.current?.flush()} />}
          {tab === 'stats' && <Stats />}
        </aside>
      </div>
    </div>
  );
}

/** Type du paragraphe courant ; le menu garde le curseur dans le texte. */
function TypePicker({ type, onPick }: { type: BlockType | null; onPick: (t: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div className={s.picker} ref={ref}>
      <button
        type="button"
        className={s.pickerBtn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Type du paragraphe (Tab pour en changer)"
        data-testid="block-type"
      >
        {type ? blockLabel(type) : 'Paragraphe'}
        <ChevronDown size={14} strokeWidth={1.4} aria-hidden="true" />
      </button>
      {open && (
        <ul className={s.pickerMenu} role="listbox" aria-label="Type du paragraphe">
          {BLOCK_LABELS.map(([t, label], i) => (
            <li
              key={t}
              role="option"
              aria-selected={t === type}
              className={t === type ? s.pickOn : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(t);
                setOpen(false);
              }}
            >
              <span>{label}</span>
              <kbd>{blockTypeKey(i + 1)}</kbd>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Sommaire : une ligne par séquence, avec sa page ; un clic y mène. */
function Outline({ onPick }: { onPick: (id: string) => void }) {
  const outline = useScriptUi((u) => u.outline);
  const active = useScriptUi((u) => u.activeHeading);
  const pages = useScriptUi((u) => u.pages);
  if (!outline.length) return <p className={s.muted}>Aucune séquence pour l’instant.</p>;
  return (
    <>
      <p className={s.count}>
        {outline.length} séquence{outline.length > 1 ? 's' : ''} · {pages} page{pages > 1 ? 's' : ''}
      </p>
      <ol className={s.outline} data-testid="scenario-outline">
        {outline.map((o) => (
          <li key={o.id}>
            <button type="button" className={o.id === active ? s.current : ''} aria-current={o.id === active || undefined} onClick={() => onPick(o.id)}>
              <span className={s.n}>{o.n}</span>
              <span className={s.h}>{o.text || 'Sans titre'}</span>
              <span className={s.p}>{o.page}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Plans du découpage, séquence par séquence, reliés à leurs passages. */
function ShotsPanel({ doc, readOnly, hot, onHover, onFlush }: { doc: ProjectDoc; readOnly: boolean; hot: ID | null; onHover: (id: ID | null) => void; onFlush: () => void }) {
  const toast = useUi((u) => u.toast);
  const scenes = useMemo(() => scenesOf(doc.scenario ?? ''), [doc.scenario]);
  const missing = scenes.filter((sc) => !matchSequence(doc, sc)).length;
  return (
    <div className={s.shots}>
      {!readOnly && (
        <div className={s.shotsHead}>
          <LinkModeToggle doc={doc} />
          {missing > 0 && (
            <button
              type="button"
              className={s.quiet}
              data-testid="import-scenes"
              title="Ajoute à la fin du découpage les séquences du scénario qui n’y figurent pas encore (rien n’est modifié ni réordonné)"
              onClick={() => {
                onFlush();
                const src = useProjectStore.getState().doc?.scenario ?? '';
                const r = mutateDoc((d) => importScenes(d, src));
                if (r) toast({ message: `${r.sequences} séquence${r.sequences > 1 ? 's' : ''} et ${r.characters} personnage${r.characters > 1 ? 's' : ''} ajouté${r.sequences + r.characters > 1 ? 's' : ''} au découpage.`, actionLabel: 'Annuler', action: undo });
              }}
            >
              + Ajouter au découpage {missing > 1 ? `les ${missing} séquences absentes` : 'la séquence absente'}
            </button>
          )}
        </div>
      )}
      {doc.project.sequenceIds.length === 0 && <p className={s.muted}>Le découpage est vide : sélectionnez un passage puis « Créer un plan ».</p>}
      {doc.project.sequenceIds.map((seqId) => {
        const seq = doc.sequences[seqId];
        return (
          <section key={seqId} className={s.scene}>
            <h3>
              {sequenceHeading(doc, seqId)}
              <span>{[seq?.intExt, seq?.effect].filter(Boolean).join(' · ')}</span>
            </h3>
            <ul>
              {(seq?.shotIds ?? []).map((id) => {
                const shot = doc.shots[id];
                const block = doc.blocks[shot.actionBlockId];
                const linked = !!block?.scenarioAnchor;
                return (
                  <li
                    key={id}
                    className={[linked ? s.linked : '', hot && shot.actionBlockId === hot ? s.hot : ''].join(' ')}
                    onMouseEnter={() => linked && onHover(shot.actionBlockId)}
                    onMouseLeave={() => onHover(null)}
                    data-testid="scenario-shot"
                  >
                    <button type="button" onClick={() => goToShot(doc, id)}>
                      {shotCode(doc, id)}
                    </button>
                    <span className={s.what}>
                      {[shot.subject, shot.value].filter(Boolean).join(' · ') || '—'}
                      <em>{block?.text || block?.dialogue}</em>
                    </span>
                  </li>
                );
              })}
              {seq && seq.shotIds.length === 0 && <li className={s.muted}>Aucun plan.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** Chronomètre : durée estimée à la position du curseur, puis au total (1 page ≈ 1 minute). */
function Chrono() {
  const chrono = useScriptUi((u) => u.chrono);
  return (
    <span className={s.chrono} title="Durée estimée, à raison d’une page par minute : position du curseur / total" data-testid="scenario-chrono">
      <span>{chrono.at !== null ? mmss(chrono.at) : '–'}</span> / <b>{mmss(chrono.total)}</b>
    </span>
  );
}

/** Statistiques : pages, durée estimée, séquences, mots, répliques par personnage. */
function Stats() {
  const blocks = useScriptUi((u) => u.blocks);
  const pages = useScriptUi((u) => u.pages);
  const st = useMemo(() => scriptStats(blocks), [blocks]);
  const nf = (n: number) => n.toLocaleString('fr-FR');
  const ie = (['INT', 'EXT', 'INT/EXT'] as const).filter((k) => st.intExt[k]).map((k) => `${k} ${st.intExt[k]}`);
  const eff = Object.entries(st.effects)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k.toLocaleLowerCase('fr')} ${v}`);
  return (
    <div className={s.stats} data-testid="scenario-stats">
      <dl>
        <div>
          <dt>Pages</dt>
          <dd>
            {pages} <small>≈ {pages} min à l’écran</small>
          </dd>
        </div>
        <div>
          <dt>Séquences</dt>
          <dd>
            {st.scenes} {ie.length > 0 && <small>{ie.join(' · ')}</small>}
            {eff.length > 0 && <small>{eff.join(' · ')}</small>}
          </dd>
        </div>
        <div>
          <dt>Mots</dt>
          <dd>
            {nf(st.words)} <small>dont {nf(st.dialogueWords)} dialogués</small>
          </dd>
        </div>
      </dl>
      {st.characters.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Personnage</th>
              <th>Répliques</th>
              <th>Mots</th>
              <th>Séq.</th>
            </tr>
          </thead>
          <tbody>
            {st.characters.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.replies}</td>
                <td>{nf(c.words)}</td>
                <td>{c.scenes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Le découpage mis en forme comme un scénario : lecture seule, toujours à jour. */
function CutView({ doc }: { doc: ProjectDoc }) {
  return (
    <div className={s.cut} data-testid="scenario-cut">
      {doc.project.sequenceIds.map((seqId) => {
        const seq = doc.sequences[seqId];
        return (
          <section key={seqId}>
            <h3>
              {doc.project.sequenceIds.indexOf(seqId) + 1}. {[seq?.intExt, seq?.label, seq?.effect].filter(Boolean).join(' – ')}
            </h3>
            {(seq?.actionBlockIds ?? []).map((bId) => {
              const b = doc.blocks[bId];
              const shots = (seq?.shotIds ?? []).filter((id) => doc.shots[id]?.actionBlockId === bId);
              if (!b) return null;
              return (
                <div key={bId} className={s.cutBlock}>
                  <span className={s.cutShots}>{shots.map((id) => (seq?.shotIds.indexOf(id) ?? 0) + 1).join(', ')}</span>
                  {b.text && <p>{b.text}</p>}
                  {b.dialogue &&
                    parseDialogue(b.dialogue).map((r, k) => (
                      <div key={k} className={s.cutReplica}>
                        {r.speaker && <p className={s.cutSpeaker}>{r.speaker.toUpperCase()}</p>}
                        <p className={s.cutDialogue}>{r.line}</p>
                      </div>
                    ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
