import { useCanComment, useDriveReview, useReadOnly, useShare } from '../../store/share';
import { shownComments } from '../../domain/comments';
import { MarkLayer } from '../comments/MarkLayer';
import { clearFocus, openComment, useCommentsUi } from '../comments/commentsUi';
import { LinkModeToggle, addPassageAsShot } from './ScriptReader';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Bold,
  ChevronDown,
  FilePlus2,
  FileText,
  Highlighter,
  Italic,
  MessageSquarePlus,
  PanelRight,
  Underline,
} from 'lucide-react';
import { HIGHLIGHTS, layoutScript, scriptOutline, type HighlightColor } from '../../domain/scriptLayout';
import { chronoOf, chronoTimeline, mmss, type ScriptChrono } from '../../domain/chronometry';
import { importScenes, matchSequence, parseDialogue, scenesOf } from '../../domain/fountain';
import { reviseScenario, revisionSummary, type RevisionReport } from '../../domain/revision';
import { createVersion, ensureVersions, nextVersionName } from '../../domain/versions';
import { VersionSwitcher } from '../versions/VersionSwitcher';
import { ComparePage } from '../versions/ComparePage';
import { scenarioHref, scenarioLocation, useLocation, type ScenarioView } from '../../app/router';
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
import { useIsMobile } from '../../ui/useIsMobile';
import { ExportMenu, scriptExportSection, type ExportSection } from './ScriptExportButton';
import { goToShot } from '../grid/goTo';
import { PAGE, ScriptEditor, useScriptUi, type ScriptEditorApi } from './ScriptEditor';
import { CharactersPanel, DecorsPanel, ResearchPanel } from './ResearchPanels';
import { CHART_REPORTS, REPORTS, ScriptStatsReports, isReport, savedReport, storeReport, type Report, type ReportsApi } from './ScriptStatsReports';
import { SequencesPanel } from './SequencesPanel';
import { TextToggle } from './TextToggle';
import { OutlineView } from './outline/OutlineView';
import { OutlineToolbar } from './outline/OutlineToolbar';
import { outlineExportSection } from './outline/outlineExportSection';
import s from './ScenarioPage.module.css';

/** Sous-pages, dans l'ordre du travail. */
const VIEWS: ReadonlyArray<readonly [ScenarioView, string]> = [
  ['outline', 'Séquencier'],
  ['script', 'Continuité dialoguée'],
  ['cut', 'Découpage'],
  ['stats', 'Statistiques'],
];

type Tab = 'scenes' | 'characters' | 'decors' | 'research';
/** Onglets du panneau de Texte, en mots. */
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['scenes', 'Séquences'],
  ['characters', 'Personnages'],
  ['decors', 'Décors'],
  ['research', 'Recherche'],
];

/** Largeur du panneau latéral : par défaut, bornes. */
const SIDE_W = 344;
const SIDE_MIN = 280;
const SIDE_MAX = 480;

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

// Les anciennes valeurs (« shots », l'onglet Plans d'avant) et les inconnues reviennent aux séquences.
const savedTab = (): Tab => {
  const t = stored('ds-scenario-tab');
  return TABS.some(([k]) => k === t) ? (t as Tab) : 'scenes';
};
const savedSideWidth = () => {
  const w = Number(stored('ds-scenario-side-w'));
  return w ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)) : SIDE_W;
};

/** Sous-page sans adresse : la dernière ouverte ; à la première visite, le texte s'il existe, sinon le séquencier. */
const initialView = (doc: ProjectDoc, drive: boolean): ScenarioView => {
  const v = stored('ds-scenario-view');
  if ((v === 'outline' && !drive) || v === 'script' || v === 'cut' || v === 'stats') return v;
  return drive || (doc.scenario ?? '').trim() ? 'script' : 'outline';
};

/** « 1:38:12 » au-delà d'une heure, « 4:37 » en deçà. */
const hms = (sec: number) => {
  const t = Math.max(0, Math.round(sec));
  return t < 3600 ? mmss(t) : `${Math.floor(t / 3600)}:${mmss(t % 3600).padStart(5, '0')}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Scénario, ou sa sous-page de comparaison des versions (#/scenario?compare=A~B). */
export function ScenarioPage({ doc }: { doc: ProjectDoc }) {
  const { params } = useLocation();
  if (params.has('compare')) return <ComparePage doc={doc} />;
  return <ScenarioMain doc={doc} params={params} />;
}

/**
 * Scénario : quatre sous-pages (Séquencier, Texte, Découpage, Statistiques) sous une même adresse.
 * Ligne 1 : où l'on est, et ce qui vaut pour tout le scénario (versions, exports). Ligne 2 : les outils
 * de la sous-page. Barre d'état : les mesures.
 */
function ScenarioMain({ doc, params }: { doc: ProjectDoc; params: URLSearchParams }) {
  const readOnly = useReadOnly();
  const phone = useIsMobile();
  // Relecture en ligne : pas de séquencier (les phrases ne sont pas publiées), ni fiches ni recherche.
  const drive = useDriveReview();
  const loc = scenarioLocation(params);
  const [remembered, setRemembered] = useState<ScenarioView>(() => initialView(doc, drive));
  const view: ScenarioView = loc.view && !(drive && loc.view === 'outline') ? loc.view : remembered;
  useEffect(() => {
    setRemembered(view);
    store('ds-scenario-view', view);
  }, [view]);
  // Adresse sans sous-page, ou sans objet ici (séquencier en relecture Drive) : elle reçoit la sous-page
  // affichée (sans nouvelle entrée), pour que Précédent y revienne.
  useEffect(() => {
    if (loc.view === view) return;
    const q = new URLSearchParams(params);
    q.set('view', view);
    window.history.replaceState(window.history.state, '', `#/scenario?${q.toString()}`);
  }, [loc.view, view, params]);

  const [tabState, setTabState] = useState<Tab>(savedTab);
  const tab: Tab = drive ? 'scenes' : tabState;
  const setTab = (t: Tab) => {
    setTabState(t);
    store('ds-scenario-tab', t);
  };
  // Panneau latéral : masquable pour écrire sans rien autour (⌘\), retenu d'une visite à l'autre.
  const [side, setSideState] = useState(() => stored('ds-scenario-side') !== '0');
  const setSide = (on: boolean) => {
    setSideState(on);
    store('ds-scenario-side', on ? '1' : '0');
  };
  const [sideW, setSideW] = useState(savedSideWidth);
  const [hover, setHover] = useState<ID | null>(null);
  const [caretAnchor, setCaretAnchor] = useState<ID | null>(null);
  const api = useRef<ScriptEditorApi | null>(null);
  const hadSelection = useRef(true);
  const activeType = useScriptUi((u) => u.activeType);
  const selection = useScriptUi((u) => u.selection);
  const toast = useUi((u) => u.toast);

  // Rapport des statistiques : celui de l'adresse, sinon le dernier ouvert.
  const [report, setReportState] = useState<Report>(() => (isReport(loc.report) ? loc.report : savedReport()));
  useEffect(() => {
    if (isReport(loc.report)) setReportState(loc.report);
  }, [loc.report]);
  const setReport = (r: Report) => {
    setReportState(r);
    storeReport(r);
    window.history.replaceState(window.history.state, '', scenarioHref('stats', { report: r }));
  };
  const reportsApi = useRef<ReportsApi>(null);

  /** Changer de sous-page : une entrée d'historique (Précédent ramène à la précédente). */
  const goView = (v: ScenarioView) => {
    if (v === view) return;
    if (view === 'script') api.current?.flush();
    window.location.hash = scenarioHref(v, v === 'stats' ? { report } : {});
  };

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
  // Commentaire à montrer : il est dans le texte, qui s'ouvre au besoin.
  const focus = useCommentsUi((u) => u.focus);
  useEffect(() => {
    if (focus?.kind !== 'script') return;
    if (view !== 'script') {
      window.location.hash = scenarioHref('script');
      return;
    }
    let k = 0;
    let t = 0;
    const tryShow = () => {
      if (!api.current && k++ < 30) {
        t = window.setTimeout(tryShow, 60);
        return;
      }
      const rect = api.current?.revealSource(focus.start, focus.end);
      clearFocus();
      if (rect) openComment(focus, rect.left, rect.bottom);
    };
    t = window.setTimeout(tryShow, 120);
    return () => window.clearTimeout(t);
  }, [focus, view]);
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
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // « \ » se tape avec ⌥⇧/ sur un Mac AZERTY, AltGr+8 sous Windows : ⌥, ⇧ et AltGr sont admis ;
      // la touche physique « \ » d'un clavier QWERTY aussi, quelle que soit la disposition.
      if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.code === 'Backslash')) {
        // Seules les sous-pages qui ont un panneau le montrent ou le masquent.
        if (viewRef.current !== 'script' && viewRef.current !== 'cut') return;
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
    if (!sel) return;
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
      let rep: RevisionReport | null = null;
      mutateDoc((d) => {
        if (asVersion) {
          ensureVersions(d);
          createVersion(d);
        }
        rep = reviseScenario(d, content);
      });
      const n = scenesOf(content).length;
      const r = rep as RevisionReport | null;
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

  // Texte du panneau, des rapports et des mesures : celui de l'éditeur quand il est ouvert ; sinon le
  // texte enregistré, qui suit les changements de version.
  const editorBlocks = useScriptUi((u) => u.blocks);
  const savedBlocks = useMemo(
    () => (view === 'script' ? null : blocksFromSource(doc.scenario ?? '').blocks),
    [view, doc.scenario],
  );
  const sideBlocks = savedBlocks ?? editorBlocks;
  // Aller à une séquence depuis un panneau ou un rapport. Hors de l'éditeur, les blocs n'ont plus les mêmes
  // identifiants une fois le texte rouvert : la séquence est retrouvée par son numéro, dans l'adresse.
  const goTo = (id: string, from: readonly SBlock[] = sideBlocks) => {
    if (view === 'script') return api.current?.scrollTo(id);
    const n = headingNumbers(from).get(id);
    if (n !== undefined) window.location.hash = scenarioHref('script', { seq: n });
  };
  // Séquence demandée par l'adresse : la sous-page s'y place, puis l'adresse redevient simple.
  const seq = loc.seq;
  useEffect(() => {
    if (!seq) return;
    let k = 0;
    let timer = 0;
    const settle = () => window.history.replaceState(window.history.state, '', scenarioHref(view, view === 'stats' ? { report } : {}));
    const tryGo = () => {
      if (view === 'script') {
        const o = useScriptUi.getState().outline.find((x) => x.n === seq);
        if (o && api.current && document.querySelector(`[data-bid="${o.id}"]`)) {
          api.current.scrollTo(o.id);
          return settle();
        }
      } else if (view === 'outline') {
        const row = document.querySelector<HTMLElement>(`[data-outline-n="${seq}"]`);
        if (row) {
          row.scrollIntoView({ block: 'center' });
          row.setAttribute('data-flash', '');
          window.setTimeout(() => row.removeAttribute('data-flash'), 1400);
          return settle();
        }
      } else return settle();
      if (k++ < 40) timer = window.setTimeout(tryGo, 50);
      else settle();
    };
    timer = window.setTimeout(tryGo, 50);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, view]);

  // Séquences du texte absentes du découpage : un bouton de la ligne 2 (Découpage) les y ajoute.
  const scenes = useMemo(() => (view === 'cut' ? scenesOf(doc.scenario ?? '') : []), [view, doc.scenario]);
  const missing = view === 'cut' ? scenes.filter((sc) => !matchSequence(doc, sc)).length : 0;
  const addMissing = () => {
    const src = useProjectStore.getState().doc?.scenario ?? '';
    const r = mutateDoc((d) => importScenes(d, src));
    if (r)
      toast({
        message: `${r.sequences} séquence${r.sequences > 1 ? 's' : ''} et ${r.characters} personnage${r.characters > 1 ? 's' : ''} ajouté${r.sequences + r.characters > 1 ? 's' : ''} au découpage.`,
        actionLabel: 'Annuler',
        action: undo,
      });
  };

  // Menu Exporter : sections fixes ; Statistiques seulement sur sa sous-page.
  const sections: ExportSection[] = [scriptExportSection(current, title)];
  const outlineSection = drive ? null : outlineExportSection();
  if (outlineSection) sections.push(outlineSection);
  if (view === 'stats')
    sections.push({
      id: 'stats',
      label: 'Statistiques',
      items: [
        { key: 'report', label: 'Rapport affiché (PDF)', run: () => reportsApi.current?.print() },
        ...(CHART_REPORTS.has(report) ? [{ key: 'chart', label: 'Graphique (PNG)', run: () => reportsApi.current?.png() }] : []),
      ],
    });

  const views = VIEWS.filter(([v]) => !drive || v !== 'outline');
  const tabsRef = useRef<HTMLDivElement>(null);
  // Motif tablist : ← → déplacent le focus d'un onglet à l'autre (Début, Fin aux extrémités).
  const onTabsKey = (e: ReactKeyboardEvent) => {
    const all = Array.from(tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const j =
      e.key === 'ArrowRight' ? (i + 1) % all.length
      : e.key === 'ArrowLeft' ? (i - 1 + all.length) % all.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? all.length - 1
      : -1;
    if (j < 0) return;
    e.preventDefault();
    all[j].focus();
  };
  const withSide = view === 'script' || view === 'cut';
  const statsBlocks = savedBlocks ?? [];

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.views} role="tablist" aria-label="Scénario" ref={tabsRef} onKeyDown={onTabsKey} data-view>
          {views.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              id={`scenario-tab-view-${v}`}
              aria-selected={view === v}
              aria-controls="scenario-view"
              tabIndex={view === v ? 0 : -1}
              className={view === v ? s.viewOn : ''}
              data-label={label}
              onClick={() => goView(v)}
              data-testid={`scenario-view-${v}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={s.headEnd}>
          <VersionSwitcher doc={doc} onImport={readOnly ? undefined : () => void importFile()} />
          <ExportMenu sections={sections} />
        </div>
      </header>

      <div className={s.tools} data-testid="scenario-tools">
        <div className={s.toolsMain}>
          {view === 'outline' && <OutlineToolbar doc={doc} />}
          {view === 'script' && !readOnly && (
            <>
              <TypePicker type={activeType} onPick={(t) => api.current?.setType(t)} />
              <span className={s.group} role="group" aria-label="Mise en forme">
                {(
                  [
                    ['**', Bold, 'Gras (⌘B)', 'b'],
                    ['*', Italic, 'Italique (⌘I)', 'i'],
                    ['_', Underline, 'Souligné (⌘U)', 'u'],
                  ] as const
                ).map(([m, Icon, label, id]) => (
                  <button
                    key={m}
                    type="button"
                    className={s.icon}
                    aria-label={label}
                    title={label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => api.current?.emphasis(m)}
                    data-testid={`emphasis-${id}`}
                  >
                    <Icon size={16} strokeWidth={1.25} />
                  </button>
                ))}
                <HighlightPicker onPick={(c) => api.current?.highlight(c)} />
              </span>
              <button
                type="button"
                className={s.labelled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  createShot({ x: r.left, y: r.bottom + 4 });
                }}
                disabled={!selection}
                title="Créer un plan"
                data-testid="create-shot-from-selection"
              >
                <FilePlus2 size={16} strokeWidth={1.25} aria-hidden="true" />
                <span className={s.lbl}>Créer un plan</span>
              </button>
              <button
                type="button"
                className={s.labelled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => api.current?.editTitle()}
                title="Page de garde"
                data-testid="edit-title-page"
              >
                <FileText size={16} strokeWidth={1.25} aria-hidden="true" />
                <span className={s.lbl}>Page de garde</span>
              </button>
            </>
          )}
          {view === 'script' && canComment && isGuest && (
            <button
              type="button"
              className={s.labelled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={commentSelection}
              disabled={!selection}
              data-comment-trigger
              data-view
              title="Commenter"
              data-testid="comment-selection"
            >
              <MessageSquarePlus size={16} strokeWidth={1.25} aria-hidden="true" />
              <span className={s.lbl}>Commenter</span>
            </button>
          )}
          {view === 'cut' && !readOnly && (
            <>
              <LinkModeToggle doc={doc} />
              {missing > 0 && (
                <button type="button" className={s.labelled} onClick={addMissing} data-testid="import-scenes">
                  Ajouter {plural(missing, 'séquence')} au découpage
                </button>
              )}
            </>
          )}
          {view === 'stats' && (
            <TextToggle
              label="Rapports"
              items={REPORTS.map(([k, short]) => [k, short] as const)}
              value={report}
              onChange={setReport}
              testId="report"
            />
          )}
        </div>
        {withSide && (
          <button
            type="button"
            className={[s.icon, side ? s.iconOn : ''].join(' ')}
            aria-pressed={side}
            aria-label={side ? 'Masquer le panneau (⌘\\)' : 'Afficher le panneau (⌘\\)'}
            title={side ? 'Masquer le panneau (⌘\\)' : 'Afficher le panneau (⌘\\)'}
            onClick={() => setSide(!side)}
            data-view
            data-testid="scenario-side-toggle"
          >
            <PanelRight size={16} strokeWidth={1.25} />
          </button>
        )}
      </div>

      <div className={s.body} id="scenario-view" role="tabpanel" aria-labelledby={`scenario-tab-view-${view}`}>
        {view === 'outline' && <OutlineView doc={doc} />}
        {view === 'stats' && (
          <ScriptStatsReports doc={doc} blocks={statsBlocks} report={report} onGo={(id) => goTo(id, statsBlocks)} apiRef={reportsApi} />
        )}
        {withSide && (
          <div
            className={[s.layout, side ? '' : s.solo].join(' ')}
            style={{ ['--side-w' as string]: `${sideW}px` }}
          >
            <div className={s.center} ref={center}>
              {view === 'cut' ? (
                // Même largeur que la page du texte (réduite comme elle) : rien ne bouge d'une vue à l'autre.
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
                {!phone && <SideResize width={sideW} onChange={setSideW} />}
                {view === 'cut' ? (
                  <div className={s.sideScroll}>
                    <ShotsPanel doc={doc} hot={hover ?? caretAnchor} onHover={setHover} />
                  </div>
                ) : (
                  <>
                    {!drive && (
                      <div className={s.tabs} role="tablist" aria-label="Panneau">
                        {TABS.map(([t, label]) => (
                          <button
                            key={t}
                            type="button"
                            role="tab"
                            aria-selected={tab === t}
                            className={tab === t ? s.tabOn : ''}
                            data-label={label}
                            onClick={() => setTab(t)}
                            data-testid={`scenario-tab-${t}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={s.sideScroll}>
                      {tab === 'scenes' && <SequencesPanel doc={doc} api={api} readOnly={readOnly} />}
                      {tab === 'characters' && (
                        <CharactersPanel doc={doc} blocks={sideBlocks} readOnly={readOnly} onGo={goTo} />
                      )}
                      {tab === 'decors' && (
                        <DecorsPanel doc={doc} blocks={sideBlocks} readOnly={readOnly} onGo={goTo} />
                      )}
                      {tab === 'research' && <ResearchPanel doc={doc} readOnly={readOnly} />}
                    </div>
                  </>
                )}
              </aside>
            )}
          </div>
        )}
      </div>

      {view !== 'stats' && (
        <footer className={s.status} data-testid="scenario-status">
          {view === 'script' && <ScriptStatus settings={doc.project.settings.scriptChrono} />}
          {view === 'outline' && <OutlineStatus doc={doc} />}
          {view === 'cut' && <CutStatus doc={doc} />}
        </footer>
      )}
    </div>
  );
}

/**
 * Poignée du panneau : tirer pour régler la largeur (280 à 480 px), double-clic pour revenir à 344 ;
 * au clavier, ← élargit, → rétrécit (⇧ : par 64 px), Début / Fin aux bornes, Entrée revient à 344.
 */
function SideResize({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const clamp = (w: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, w));
  const set = (w: number) => {
    const v = clamp(w);
    onChange(v);
    store('ds-scenario-side-w', String(v));
  };
  return (
    <div
      className={s.resize}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Largeur du panneau"
      aria-valuemin={SIDE_MIN}
      aria-valuemax={SIDE_MAX}
      aria-valuenow={width}
      data-view
      onDoubleClick={() => set(SIDE_W)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const next =
          e.key === 'ArrowLeft' ? width + step
          : e.key === 'ArrowRight' ? width - step
          : e.key === 'Home' ? SIDE_MIN
          : e.key === 'End' ? SIDE_MAX
          : e.key === 'Enter' ? SIDE_W
          : null;
        if (next === null) return;
        e.preventDefault();
        set(next);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX;
        let w = width;
        const move = (ev: PointerEvent) => {
          w = clamp(width + (x0 - ev.clientX));
          onChange(w);
        };
        // Fin du geste, ou geste interrompu (le système reprend le pointeur) : la largeur atteinte est gardée.
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          set(w);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      }}
      data-testid="scenario-side-resize"
    />
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
        title="Type du paragraphe (Tab)"
        data-testid="block-type"
      >
        <span>{type ? blockLabel(type) : 'Paragraphe'}</span>
        <ChevronDown size={14} strokeWidth={1.25} aria-hidden="true" />
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

/** Titre d'une séquence du découpage, tel que la vue Découpage l'affiche. */
const cutHeading = (doc: ProjectDoc, seqId: ID) => {
  const seq = doc.sequences[seqId];
  return [seq?.intExt, seq?.label, seq?.effect].filter(Boolean).join(' – ');
};

/** Panneau du Découpage : les plans, séquence par séquence, reliés à leurs passages. */
function ShotsPanel({ doc, hot, onHover }: { doc: ProjectDoc; hot: ID | null; onHover: (id: ID | null) => void }) {
  const ids = doc.project.sequenceIds;
  if (!ids.some((id) => doc.sequences[id]?.shotIds.length)) return <p className={s.muted}>Aucun plan</p>;
  return (
    <div className={s.shots} data-testid="scenario-shots">
      {ids.map((seqId) => {
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
              {seq && seq.shotIds.length === 0 && <li className={s.muted}>Aucun plan</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const METHOD: Record<ScriptChrono['method'], string> = {
  pages: 'Minutage : par pages',
  characters: 'Minutage : par caractères',
  configurable: 'Minutage : par type de paragraphe',
};

/** Barre d'état du texte : séquence et page du curseur, puis la durée estimée au curseur et au total. */
function ScriptStatus({ settings }: { settings?: Partial<ScriptChrono> }) {
  const c = useMemo(() => chronoOf(settings), [settings]);
  const blocks = useScriptUi((u) => u.blocks);
  const caret = useScriptUi((u) => u.caret);
  const outline = useScriptUi((u) => u.outline);
  const pages = useScriptUi((u) => u.pages);
  const activeHeading = useScriptUi((u) => u.activeHeading);
  // Même minutage que les statistiques : celui des pages imprimées (les notes n'y comptent pas).
  const timeline = useMemo(() => chronoTimeline(blocks, c), [blocks, c]);
  const at = timeline.at(caret);
  const total = Math.round(timeline.total);
  const k = outline.findIndex((o) => o.id === activeHeading);
  // Page imprimée du curseur ; une ligne qui ne s'imprime pas (note) prend celle de sa séquence.
  const placed = caret ? layoutScript(blocks).placement.get(caret.id) : undefined;
  const page = placed ? placed.page + 1 : k >= 0 ? outline[k].page : null;
  return (
    <>
      {/* Curseur hors du texte : les comptes, comme au séquencier. */}
      <span data-testid="scenario-position">
        {page === null ? (
          <>
            {plural(outline.length, 'séquence')} · {plural(pages, 'page')}
          </>
        ) : (
          <>
            {outline.length > 0 && <>Séquence {k >= 0 ? outline[k].n : '–'} / {outline.length} · </>}
            Page {page} / {pages}
          </>
        )}
      </span>
      <span title={METHOD[c.method]} data-testid="scenario-chrono">
        {at !== null ? mmss(Math.round(at)) : '–'} / {mmss(total)}
      </span>
    </>
  );
}

/** Barre d'état du séquencier : séquences et pages du texte, durée totale estimée. */
function OutlineStatus({ doc }: { doc: ProjectDoc }) {
  const settings = doc.project.settings.scriptChrono;
  const { n, pages, total } = useMemo(() => {
    const blocks = blocksFromSource(doc.scenario ?? '').blocks;
    const o = scriptOutline(blocks);
    return { n: o.items.length, pages: o.pages, total: chronoTimeline(blocks, chronoOf(settings)).total };
  }, [doc.scenario, settings]);
  return (
    <>
      <span>
        {plural(n, 'séquence')} · {plural(pages, 'page')}
      </span>
      <span title={METHOD[chronoOf(settings).method]}>{hms(total)}</span>
    </>
  );
}

/** Barre d'état du découpage : séquences et plans. */
function CutStatus({ doc }: { doc: ProjectDoc }) {
  const ids = doc.project.sequenceIds;
  const shots = ids.reduce((k, id) => k + (doc.sequences[id]?.shotIds.length ?? 0), 0);
  return (
    <span>
      {plural(ids.length, 'séquence')} · {plural(shots, 'plan')}
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
        className={s.iconMenu}
        aria-label="Surligner"
        title="Surligner"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        data-testid="highlight"
      >
        <Highlighter size={16} strokeWidth={1.25} />
        <ChevronDown size={12} strokeWidth={1.25} aria-hidden="true" />
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
