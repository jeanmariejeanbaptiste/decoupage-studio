import { useCanComment, useReadOnly, useShare } from '../../store/share';
import { shownComments } from '../../domain/comments';
import { MarkLayer } from '../comments/MarkLayer';
import { clearFocus, openComment, useCommentsUi } from '../comments/commentsUi';
import { LinkModeToggle, addPassageAsShot } from './ScriptReader';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  PanelRightClose,
  PanelRightOpen,
  Bold,
  ChevronDown,
  Clapperboard,
  ListOrdered,
  MapPin,
  Users,
  FilePlus2,
  FileText,
  FileUp,
  Highlighter,
  Italic,
  MessageSquarePlus,
  Underline,
} from 'lucide-react';
import { HIGHLIGHTS, scriptOutline, type HighlightColor, type OutlineItem } from '../../domain/scriptLayout';
import { chronoOf, chronoTimeline, mmss, type ScriptChrono } from '../../domain/chronometry';
import { importScenes, matchSequence, parseDialogue, scenesOf } from '../../domain/fountain';
import { reviseScenario, revisionSummary, type RevisionReport } from '../../domain/revision';
import { createVersion, ensureVersions, nextVersionName } from '../../domain/versions';
import { VersionSwitcher } from '../versions/VersionSwitcher';
import { useRevisionMarks } from '../versions/useRevisionMarks';
import { sequenceHeading, shotCode, shotNumberLabel } from '../../domain/numbering';
import {
  BLOCK_LABELS,
  blockLabel,
  blocksFromSource,
  headingNumbers,
  type BlockType,
  type SBlock,
} from '../../domain/screenplay';
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
import { ScriptStatsReports } from './ScriptStatsReports';
import s from './ScenarioPage.module.css';

type Tab = 'scenes' | 'characters' | 'decors' | 'research' | 'shots';
type View = 'script' | 'cut' | 'stats';
/** Onglets du panneau : une icône chacun, le nom pour l'onglet ouvert (une seule ligne, toujours). */
const TABS: ReadonlyArray<[Tab, string, typeof ListOrdered]> = [
  ['scenes', 'Séquences', ListOrdered],
  ['characters', 'Personnages', Users],
  ['decors', 'Décors', MapPin],
  ['research', 'Recherche', BookOpen],
  ['shots', 'Plans', Clapperboard],
];

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* choix valable pour la session */
  }
};

const savedTab = (): Tab => {
  const t = stored('ds-scenario-tab');
  return TABS.some(([k]) => k === t) ? (t as Tab) : 'scenes';
};

/** Scénario : écrit sur des pages A4, comme dans un logiciel d'écriture, et relié au découpage. */
export function ScenarioPage({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const phone = useIsMobile();
  const [view, setView] = useState<View>('script');
  const [tabState, setTabState] = useState<Tab>(savedTab);
  // Panneau latéral : masquable pour écrire sans rien autour (⌘\), retenu d'une visite à l'autre.
  const [side, setSideState] = useState(() => stored('ds-scenario-side') !== '0');
  const setSide = (on: boolean) => {
    setSideState(on);
    store('ds-scenario-side', on ? '1' : '0');
  };
  // « Plans » n'a de sens qu'en vue Découpage : en vue Scénario, le panneau revient aux séquences.
  const tab: Tab = tabState === 'shots' && view !== 'cut' ? 'scenes' : tabState;
  const setTab = (t: Tab) => {
    setTabState(t);
    store('ds-scenario-tab', t);
  };
  const [hover, setHover] = useState<ID | null>(null);
  const [caretAnchor, setCaretAnchor] = useState<ID | null>(null);
  const api = useRef<ScriptEditorApi | null>(null);
  const hadSelection = useRef(true);
  const activeType = useScriptUi((u) => u.activeType);
  const selection = useScriptUi((u) => u.selection);
  const toast = useUi((u) => u.toast);

  // Relecture : passages commentés de la version courante (ouverts), et la bulle à ouvrir.
  // Commenter : un bouton pour les relecteurs invités ; l'auteur commente au clic droit sur une sélection.
  const canComment = useCanComment();
  const isGuest = useShare((st) => st.role === 'guest');
  // Passages commentés : ceux de la version, et ceux des versions précédentes retrouvés dans le texte.
  const shown = useMemo(
    () => shownComments(doc).filter((x) => x.anchor.kind === 'script' && !x.c.resolved),
    [doc],
  );
  const scriptComments = useMemo(
    () =>
      shown.map((x) => ({
        id: x.c.id,
        start: (x.anchor as { start: number }).start,
        end: (x.anchor as { end: number }).end,
      })),
    [shown],
  );
  const openScriptComment = (id: string, rect: DOMRect) => {
    const x = shown.find((y) => y.c.id === id);
    if (x) openComment(x.anchor, rect.left, rect.bottom);
  };
  const focus = useCommentsUi((u) => u.focus);
  useEffect(() => {
    if (focus?.kind !== 'script') return;
    const t = setTimeout(() => {
      const rect = api.current?.revealSource(focus.start, focus.end);
      clearFocus();
      if (rect) openComment(focus, rect.left, rect.bottom);
    }, 120);
    return () => clearTimeout(t);
  }, [focus]);
  const commentSelection = () => {
    const sel = useScriptUi.getState().selection;
    const src = useProjectStore.getState().doc?.scenario ?? '';
    if (!sel) return;
    const rect = api.current?.selectionRect();
    openComment(
      {
        kind: 'script',
        start: sel.start,
        end: sel.end,
        quote: src.slice(sel.start, sel.end).replace(/\s+/g, ' ').trim(),
      },
      rect?.left ?? 200,
      rect?.bottom ?? 200,
    );
  };

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
  // ⌘\ (Ctrl+\) : masquer ou rouvrir le panneau, sans quitter le texte.
  const sideRef = useRef(side);
  sideRef.current = side;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // « \ » se tape avec ⌥⇧/ sur un Mac AZERTY, AltGr+8 sous Windows : ⌥, ⇧ et AltGr sont admis ;
      // la touche physique « \ » d'un clavier QWERTY aussi, quelle que soit la disposition.
      if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        setSide(!sideRef.current);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // La page A4 se réduit pour tenir dans la largeur disponible.
  const center = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // Hauteur réelle de la pile de pages (avant mise à l'échelle), pour réserver la place réduite.
  const zoomInner = useRef<HTMLDivElement>(null);
  const [zoomH, setZoomH] = useState(0);
  useLayoutEffect(() => {
    const el = zoomInner.current;
    if (!el) return;
    const measure = () => setZoomH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, phone]);
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
    const f = await pickFile(
      '.fountain,.fdx,.txt,.spmd,.md,.markdown,.pdf,.docx,.doc,text/plain,application/pdf',
      false,
    );
    if (!f) return;
    api.current?.flush();
    const cur = useProjectStore.getState().doc;
    let asVersion = false;
    if ((cur?.scenario ?? '').trim()) {
      // Un nouveau texte arrive : par défaut, il devient la version suivante (rien n'est perdu).
      const now =
        cur!.versions?.find((v) => v.id === cur!.activeVersionId)?.name ?? cur!.project.version ?? 'V1';
      const next = nextVersionName(
        (cur!.versions?.length ? cur!.versions : [{ name: now }]).map((v) => v.name),
      );
      const r = await ask({
        title: `« ${f.name} » : nouvelle version ?`,
        body: `En ${next}, le découpage et la préparation de ${now} sont repris séquence par séquence ; ${now} reste consultable. « Remplacer » réécrit ${now}.`,
        confirmLabel: `Créer la ${next}`,
        altLabel: `Remplacer la ${now}`,
      });
      if (!r.ok && !r.alt) return;
      asVersion = r.ok;
    }
    try {
      const content = await readScenarioFile(f);
      // Chaque scène retrouve sa séquence (même renumérotée, retouchée ou déplacée) ; les passages liés suivent.
      let report: RevisionReport | null = null;
      mutateDoc((d) => {
        if (asVersion) {
          ensureVersions(d);
          createVersion(d);
        }
        report = reviseScenario(d, content);
      });
      const n = scenesOf(content).length;
      const r = report as RevisionReport | null;
      const head = asVersion
        ? `${useProjectStore.getState().doc?.project.version} : `
        : 'Scénario importé : ';
      toast({
        message:
          r && r.kept > 0 ? `${head}${revisionSummary(r)}.` : `${head}${n} séquence${n > 1 ? 's' : ''}.`,
        actionLabel: 'Annuler',
        action: undo,
      });
    } catch (e) {
      toast({ message: (e as Error).message || 'Ce fichier n’a pas pu être lu.', tone: 'warn' });
    }
  };

  const title = doc.project.title || 'scenario';
  const current = () => useProjectStore.getState().doc ?? doc;

  // Texte du panneau et des rapports : celui de l'éditeur quand il est ouvert ; sinon (Découpage,
  // Statistiques) le texte enregistré, qui suit les changements de version.
  const editorBlocks = useScriptUi((u) => u.blocks);
  const editorOutline = useScriptUi((u) => u.outline);
  const editorPages = useScriptUi((u) => u.pages);
  const savedBlocks = useMemo(
    () => (view === 'script' ? null : blocksFromSource(doc.scenario ?? '').blocks),
    [view, doc.scenario],
  );
  const sideBlocks = savedBlocks ?? editorBlocks;
  const savedOutline = useMemo(() => (savedBlocks ? scriptOutline(savedBlocks) : null), [savedBlocks]);
  const outline = savedOutline ?? { items: editorOutline, pages: editorPages };
  // Aller à une séquence depuis un panneau ou un rapport. Hors de l'éditeur, les blocs n'ont plus les mêmes
  // identifiants une fois le texte rouvert : la séquence est retrouvée par son numéro.
  const goTo = (id: string, from: readonly SBlock[] = sideBlocks) => {
    if (view === 'script') return api.current?.scrollTo(id);
    const n = headingNumbers(from).get(id);
    setView('script');
    const tryGo = (k: number) => {
      const o = useScriptUi.getState().outline.find((x) => x.n === n);
      if (o && api.current && document.querySelector(`[data-bid="${o.id}"]`)) api.current.scrollTo(o.id);
      else if (k < 30) setTimeout(() => tryGo(k + 1), 50);
    };
    if (n !== undefined) setTimeout(() => tryGo(0), 50);
  };
  // Statistiques : calculées sur le texte enregistré (pages et numéros de l'impression).
  const statsBlocks = savedBlocks ?? [];
  return (
    <div className={['page page--wide', s.page].join(' ')}>
      <header className={s.toolbar}>
        <div className={s.tools}>
          {/* La bascule de vue en tête, toujours à la même place : les outils d'écriture viennent après. */}
          <div className={s.seg} role="radiogroup" aria-label="Affichage du scénario">
            {(
              [
                ['script', 'Scénario', 'Le texte, page par page'],
                ['cut', 'Découpage', 'Le découpage technique mis en forme comme un scénario (lecture seule)'],
                ['stats', 'Statistiques', 'Rapports et graphiques du scénario'],
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
          {!readOnly && view === 'script' && (
            <>
              <TypePicker type={activeType} onPick={(t) => api.current?.setType(t)} />
              <span className={s.marks} role="group" aria-label="Mise en forme">
                {(
                  [
                    ['**', <Bold key="b" size={15} strokeWidth={1.5} />, 'Gras (⌘B)'],
                    ['*', <Italic key="i" size={15} strokeWidth={1.5} />, 'Italique (⌘I)'],
                    ['_', <Underline key="u" size={15} strokeWidth={1.5} />, 'Souligné (⌘U)'],
                  ] as const
                ).map(([m, icon, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-label={label}
                    title={label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => api.current?.emphasis(m)}
                    data-testid={`emphasis-${m === '**' ? 'b' : m === '*' ? 'i' : 'u'}`}
                  >
                    {icon}
                  </button>
                ))}
                <HighlightPicker onPick={(c) => api.current?.highlight(c)} />
              </span>
              <Button
                variant="icon"
                icon={<FileText size={16} strokeWidth={1.25} />}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => api.current?.editTitle()}
                aria-label="Page de garde"
                title="Page de garde"
                data-testid="edit-title-page"
              />
              <Button
                icon={<FilePlus2 size={16} strokeWidth={1.25} />}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  createShot({ x: r.left, y: r.bottom + 4 });
                }}
                disabled={!selection}
                variant="icon"
                aria-label="Créer un plan"
                title="Créer un plan avec le passage sélectionné (aussi au clic droit)"
                data-testid="create-shot-from-selection"
              />
            </>
          )}
          {canComment && isGuest && view === 'script' && (
            <Button
              icon={<MessageSquarePlus size={15} strokeWidth={1.25} />}
              onMouseDown={(e) => e.preventDefault()}
              onClick={commentSelection}
              disabled={!selection}
              title="Commenter le passage sélectionné"
              aria-label="Commenter le passage sélectionné"
              data-comment-trigger
              data-view
              data-testid="comment-selection"
            >
              Commenter
            </Button>
          )}
        </div>
        <div className={s.tools}>
          {view === 'script' && !phone && <Chrono settings={doc.project.settings.scriptChrono} />}
          <VersionSwitcher doc={doc} />
          {!readOnly && (
            <Button
              variant="icon"
              icon={<FileUp size={16} strokeWidth={1.25} />}
              onClick={importFile}
              aria-label="Importer"
              title="Importer : Final Draft, Fountain, PDF, Word, Markdown ou texte"
            />
          )}
          <ScriptExportButton doc={doc} current={current} title={title} />
          {/* Toujours au bout de la barre ; sans objet (et invisible) dans les statistiques, pour que rien ne bouge. */}
          <button
            type="button"
            className={[s.sideToggle, view === 'stats' ? s.ghost : ''].join(' ')}
            aria-pressed={side}
            aria-label={side ? 'Masquer le panneau (⌘\\)' : 'Afficher le panneau (⌘\\)'}
            title={side ? 'Masquer le panneau (⌘\\)' : 'Afficher le panneau (⌘\\)'}
            tabIndex={view === 'stats' ? -1 : undefined}
            onClick={() => setSide(!side)}
            data-view
            data-testid="scenario-side-toggle"
          >
            {side ? (
              <PanelRightClose size={16} strokeWidth={1.25} />
            ) : (
              <PanelRightOpen size={16} strokeWidth={1.25} />
            )}
          </button>
        </div>
      </header>

      {view === 'stats' ? (
        <ScriptStatsReports doc={doc} blocks={statsBlocks} onGo={(id) => goTo(id, statsBlocks)} />
      ) : (
        <div className={[s.layout, side ? '' : s.solo].join(' ')}>
          <div className={s.center} ref={center}>
            {view === 'cut' ? (
              // Même largeur que la page du scénario (réduite comme elle) : rien ne bouge d'une vue à l'autre.
              <div className={['a4-sheet', s.cutSheet].join(' ')} style={phone ? undefined : { width: PAGE.w * zoom }}>
                <CutView doc={doc} />
              </div>
            ) : (
              <div
                className={s.zoom}
                // Réduction par mise à l'échelle uniforme (et non `zoom`, qui arrondit chaque page à sa façon :
                // le texte dérivait d'une fraction de pixel par page jusqu'à sortir des feuilles).
                style={phone || zoom === 1 ? undefined : { width: PAGE.w * zoom, height: zoomH * zoom }}
                // Safari sélectionne le mot sous un clic droit : seule une sélection faite avant compte.
                onPointerDownCapture={(e) => {
                  if (e.button === 2) hadSelection.current = !!useScriptUi.getState().selection;
                }}
                onContextMenu={(e) => {
                  // Clic droit sur une sélection : en faire un plan, ou la commenter.
                  if (readOnly || !useScriptUi.getState().selection || !hadSelection.current) return;
                  e.preventDefault();
                  const at = { x: e.clientX, y: e.clientY };
                  useUi.getState().set({
                    menu: {
                      ...at,
                      items: [
                        { label: 'Créer un plan', action: () => createShot(at) },
                        { label: 'Commenter', action: () => commentSelection() },
                      ],
                    },
                  });
                }}
              >
                <div
                  ref={zoomInner}
                  style={
                    phone || zoom === 1
                      ? { position: 'relative' }
                      : {
                          position: 'relative',
                          width: PAGE.w,
                          transform: `scale(${zoom})`,
                          transformOrigin: '0 0',
                        }
                  }
                >
                  <MarkLayer surface="script" />
                  <ScriptEditor
                    key={doc.project.id}
                    doc={doc}
                    readOnly={readOnly}
                    anchors={anchors}
                    hot={hover ?? caretAnchor}
                    onCaretAnchor={setCaretAnchor}
                    apiRef={api}
                    paged={!phone}
                    comments={scriptComments}
                    onComment={openScriptComment}
                  />
                </div>
              </div>
            )}
          </div>

          {side && (
            <aside className={s.side} aria-label="Navigation du scénario">
              <div className={s.tabs} role="tablist">
                {/* « Plans » garde sa place hors de la vue Découpage (invisible) : les onglets ne bougent pas. */}
                {TABS.map(([t, label, Icon]) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    aria-label={label}
                    title={label}
                    className={[tab === t ? s.tabOn : '', t === 'shots' && view !== 'cut' ? s.ghost : ''].join(' ')}
                    aria-hidden={t === 'shots' && view !== 'cut' ? true : undefined}
                    tabIndex={t === 'shots' && view !== 'cut' ? -1 : undefined}
                    onClick={() => setTab(t)}
                    data-testid={`scenario-tab-${t}`}
                  >
                    <Icon size={15} strokeWidth={1.4} aria-hidden="true" />
                    {tab === t && <span>{label}</span>}
                  </button>
                ))}
              </div>
              {tab === 'scenes' &&
                (view === 'cut' && !outline.items.length && doc.project.sequenceIds.length ? (
                  <CutOutline doc={doc} />
                ) : (
                  <Outline doc={doc} items={outline.items} pages={outline.pages} onPick={goTo} />
                ))}
              {tab === 'characters' && (
                <CharactersPanel doc={doc} blocks={sideBlocks} readOnly={readOnly} onGo={goTo} />
              )}
              {tab === 'decors' && (
                <DecorsPanel doc={doc} blocks={sideBlocks} readOnly={readOnly} onGo={goTo} />
              )}
              {tab === 'research' && <ResearchPanel doc={doc} readOnly={readOnly} />}
              {tab === 'shots' && (
                <ShotsPanel
                  doc={doc}
                  readOnly={readOnly}
                  hot={hover ?? caretAnchor}
                  onHover={setHover}
                  onFlush={() => api.current?.flush()}
                />
              )}
            </aside>
          )}
        </div>
      )}
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
function Outline({
  doc,
  items: outline,
  pages,
  onPick,
}: {
  doc: ProjectDoc;
  items: readonly OutlineItem[];
  pages: number;
  onPick: (id: string) => void;
}) {
  const marks = useRevisionMarks(doc);
  const from = marks
    ? doc.versions?.find((v) => v.id === doc.versions?.find((x) => x.id === doc.activeVersionId)?.from)?.name
    : undefined;
  const active = useScriptUi((u) => u.activeHeading);
  if (!outline.length) return <p className={s.muted}>Aucune séquence pour l’instant.</p>;
  return (
    <>
      <p className={s.count}>
        {outline.length} séquence{outline.length > 1 ? 's' : ''} · {pages} page{pages > 1 ? 's' : ''}
      </p>
      <ol className={s.outline} data-testid="scenario-outline">
        {outline.map((o, i) => (
          <li key={o.id}>
            <button
              type="button"
              className={o.id === active ? s.current : ''}
              aria-current={o.id === active || undefined}
              onClick={() => onPick(o.id)}
              data-view
            >
              <span className={s.n}>
                {marks?.get(i) && (
                  <i
                    className={s.rev}
                    title={marks.get(i) === 'new' ? `Nouvelle depuis ${from}` : `Modifiée depuis ${from}`}
                    data-testid="revision-mark"
                  >
                    *
                  </i>
                )}
                {o.n}
              </span>
              <span className={s.h}>{o.text || 'Sans titre'}</span>
              <span className={s.p}>{o.page}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Titre d'une séquence du découpage, tel que la vue Découpage l'affiche. */
const cutHeading = (doc: ProjectDoc, seqId: ID) => {
  const seq = doc.sequences[seqId];
  return [seq?.intExt, seq?.label, seq?.effect].filter(Boolean).join(' – ');
};

/** Vue Découpage d'un projet sans texte : le sommaire est celui du découpage ; un clic y mène. */
function CutOutline({ doc }: { doc: ProjectDoc }) {
  const ids = doc.project.sequenceIds;
  return (
    <>
      <p className={s.count}>
        {ids.length} séquence{ids.length > 1 ? 's' : ''}
      </p>
      <ol className={s.outline} data-testid="scenario-outline">
        {ids.map((id, i) => (
          <li key={id}>
            <button
              type="button"
              onClick={() =>
                document.querySelector(`[data-cut-seq="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }
              data-view
            >
              <span className={s.n}>{i + 1}</span>
              <span className={s.h}>{cutHeading(doc, id).toLocaleUpperCase('fr') || 'Sans titre'}</span>
              <span className={s.p} />
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Plans du découpage, séquence par séquence, reliés à leurs passages. */
function ShotsPanel({
  doc,
  readOnly,
  hot,
  onHover,
  onFlush,
}: {
  doc: ProjectDoc;
  readOnly: boolean;
  hot: ID | null;
  onHover: (id: ID | null) => void;
  onFlush: () => void;
}) {
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
                if (r)
                  toast({
                    message: `${r.sequences} séquence${r.sequences > 1 ? 's' : ''} et ${r.characters} personnage${r.characters > 1 ? 's' : ''} ajouté${r.sequences + r.characters > 1 ? 's' : ''} au découpage.`,
                    actionLabel: 'Annuler',
                    action: undo,
                  });
              }}
            >
              + Ajouter au découpage{' '}
              {missing > 1 ? `les ${missing} séquences absentes` : 'la séquence absente'}
            </button>
          )}
        </div>
      )}
      {doc.project.sequenceIds.length === 0 && (
        <p className={s.muted}>Le découpage est vide : sélectionnez un passage puis « Créer un plan ».</p>
      )}
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
                    className={[linked ? s.linked : '', hot && shot.actionBlockId === hot ? s.hot : ''].join(
                      ' ',
                    )}
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

const METHOD_HINT: Record<ScriptChrono['method'], string> = {
  pages: 'par pages',
  characters: 'par caractères',
  configurable: 'par type de paragraphe',
};

/** Chronomètre : durée estimée à la position du curseur, puis au total, selon la méthode du projet. */
function Chrono({ settings }: { settings?: Partial<ScriptChrono> }) {
  const c = useMemo(() => chronoOf(settings), [settings]);
  const blocks = useScriptUi((u) => u.blocks);
  const caret = useScriptUi((u) => u.caret);
  // Même minutage que les statistiques : celui des pages imprimées (les notes n'y comptent pas).
  const timeline = useMemo(() => chronoTimeline(blocks, c), [blocks, c]);
  const at = timeline.at(caret);
  const chrono = { at: at === null ? null : Math.round(at), total: Math.round(timeline.total) };
  return (
    <span
      className={s.chrono}
      title={`Durée estimée ${METHOD_HINT[c.method]} : position du curseur / total`}
      data-testid="scenario-chrono"
    >
      <span>{chrono.at !== null ? mmss(chrono.at) : '–'}</span> / <b>{mmss(chrono.total)}</b>
    </span>
  );
}

/** Le découpage mis en forme comme un scénario : lecture seule, toujours à jour. */
function CutView({ doc }: { doc: ProjectDoc }) {
  return (
    <div className={s.cut} data-testid="scenario-cut">
      {doc.project.sequenceIds.map((seqId) => {
        const seq = doc.sequences[seqId];
        return (
          <section key={seqId} data-cut-seq={seqId}>
            <h3>
              {doc.project.sequenceIds.indexOf(seqId) + 1}. {cutHeading(doc, seqId)}
            </h3>
            {(seq?.actionBlockIds ?? []).map((bId) => {
              const b = doc.blocks[bId];
              const shots = (seq?.shotIds ?? []).filter((id) => doc.shots[id]?.actionBlockId === bId);
              if (!b) return null;
              return (
                <div key={bId} className={s.cutBlock}>
                  <span className={s.cutShots}>
                    {/* Numéros du découpage (les caméras d'un même cadre d'interview : 1A, 1B). */}
                    {shots.map((id) => shotNumberLabel(doc, id)).join(', ')}
                  </span>
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

/** Surlignage de révision : couleurs à l'écran, jamais imprimées (comme le mode révision de KIT). */
function HighlightPicker({ onPick }: { onPick: (c: HighlightColor | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Se referme au clic ailleurs (le texte garde la sélection que ce clic y pose) et à Échap.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <span className={s.hlWrap} ref={ref}>
      <button
        type="button"
        aria-label="Surligner"
        title="Surligner (révision, non imprimé)"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        data-testid="highlight"
      >
        <Highlighter size={15} strokeWidth={1.5} />
      </button>
      {open && (
        <span className={s.hlMenu} role="menu" onMouseDown={(e) => e.preventDefault()}>
          {HIGHLIGHTS.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              aria-label={`Surligner en ${c}`}
              title={c}
              className={s[`sw_${c}`]}
              onClick={() => (onPick(c), setOpen(false))}
              data-testid={`highlight-${c}`}
            />
          ))}
          <button
            type="button"
            role="menuitem"
            className={s.swNone}
            onClick={() => (onPick(undefined), setOpen(false))}
            data-testid="highlight-none"
          >
            Aucun
          </button>
        </span>
      )}
    </span>
  );
}
