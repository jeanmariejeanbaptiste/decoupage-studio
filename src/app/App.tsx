import { redoHome, undoHome } from '../store/homeHistory';
import { isShortcut } from '../store/shortcuts';
import { useCanCopy, useDriveReview, useReadOnly, useShare } from '../store/share';
import { forgetReviewSession, resumeReview, startReviewSync } from '../store/review';
import { ReviewPage } from '../features/review/Review';
import { REVIEWED } from '../features/shell/steps';
import { switchTheme } from '../ui/themeSwitch';
import { GuestBanner, JoinPage } from '../features/share/Share';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { CommentPopover } from '../features/comments/CommentPopover';
import { CommentsPanel } from '../features/comments/CommentsPanel';
import { SketchPad } from '../features/comments/SketchPad';
import { runChecks } from '../domain/lint';
import { computeTiming } from '../domain/timing';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { ChecksPage } from '../features/checks/ChecksPage';
import { EquipmentPage } from '../features/equipment/EquipmentPage';
import { ExportPage } from '../features/export/ExportPage';
import { IntentionPage } from '../features/intention/IntentionPage';
import { ScenarioPage } from '../features/scenario/ScenarioPage';
import { FloorPlanPage } from '../features/floorplan/FloorPlanPage';
import { SchedulePage } from '../features/schedule/SchedulePage';
import { CallSheetPage } from '../features/callsheet/CallSheetPage';
import { CalendarPage } from '../features/calendar/CalendarPage';
import { ProductionPage } from '../features/production/ProductionPage';
import { BreakdownPage } from '../features/breakdown/BreakdownPage';
import { PrintPage } from '../features/export/PrintPage';
import { GridPage } from '../features/grid/GridPage';
import { RegistryPage } from '../features/registry/RegistryPage';
import { CommandPalette } from '../features/shell/CommandPalette';
import { HelpDialog } from '../features/shell/HelpDialog';
import { HomePage } from '../features/shell/HomePage';
import { SettingsPage } from '../features/shell/SettingsPage';
import { Sidebar } from '../features/shell/Sidebar';
import { Topbar } from '../features/shell/Topbar';
import { AssistantPanel } from '../features/assistant/AssistantPanel';
import { recheckAi, useAiStatus } from '../features/assistant/aiStatus';
import { useIsMobile } from '../ui/useIsMobile';
import { lastProjectId, openDoc, openStoredProject, pruneOrphanBlobs, saveToFile, startAutosave } from '../store/persistence';
import { cloudForget, cloudRestore, keepSessionAlive, preloadGoogle, startCloudPush, syncAll, useCloud } from '../store/cloud';
import { setHomeHooks } from '../store/homeHistory';
import { AccountButton } from '../features/shell/Account';
import { redo, undo, useDoc, useHistory } from '../store/projectStore';
import { toggleSidebar, useUi } from '../store/uiStore';
import { Button } from '../ui/Button';
import { ContextMenuHost } from '../ui/ContextMenu';
import { DialogHost } from '../ui/Modal';
import { Toasts } from '../ui/Toasts';
import { navigate, parseHash, useLocation, type Route } from './router';
import s from './App.module.css';

/** Champ de saisie de texte (où ⌘Z annule la frappe) : pas les cases à cocher, curseurs ou listes. */
function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  return /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week)$/.test((el as HTMLInputElement).type || 'text');
}

const SAVE_LABEL: Record<string, string> = {
  saved: 'Enregistré dans le navigateur',
  saving: 'Enregistrement…',
  dirty: 'Modifications en cours…',
  error: 'Échec de l’enregistrement',
  idle: '',
};

async function boot(): Promise<void> {
  const { route } = parseHash(window.location.hash);
  // Lien de relecture : la page d'arrivée l'ouvre elle-même.
  if (route === 'review') return;
  const seed = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed');
  if (seed === 'rav3') return openDoc(buildRav3());
  if (seed === 'fiction') return openDoc(buildFiction());
  // Rechargement pendant une relecture en ligne : elle se rouvre (l'accueil la referme).
  if (route === 'home') forgetReviewSession();
  else if (await resumeReview()) return;
  forgetReviewSession();
  const last = lastProjectId();
  if (last && (await openStoredProject(last))) return;
}

export function App() {
  const { route } = useLocation();
  const doc = useDoc();
  // Contrôles de la scripte : comptés une fois par version du projet (et jamais au point de tout bloquer).
  const checkCount = useMemo(() => {
    if (!doc) return 0;
    try {
      return runChecks(doc, computeTiming(doc)).length;
    } catch (e) {
      console.error(e);
      return 0;
    }
  }, [doc]);
  const theme = useUi((u) => u.theme);
  const saveStatus = useUi((u) => u.saveStatus);
  const sidebarOpen = useUi((u) => u.sidebarOpen);
  const setUi = useUi((u) => u.set);
  const { canUndo, canRedo } = useHistory();
  const [booted, setBooted] = useState(false);
  const readOnly = useReadOnly();
  const canCopy = useCanCopy();
  const phone = useIsMobile();
  const aiReady = useAiStatus((a) => a.ready);

  useEffect(() => {
    const stop = startAutosave();
    // Assistant réglé : essai silencieux, il n'est proposé que s'il répond.
    void recheckAi();
    // Synchronisation Google Drive (si configurée) : envoi après chaque enregistrement, suppressions suivies.
    const stopCloud = startCloudPush();
    const stopSession = keepSessionAlive();
    // Relecture en ligne (si configurée) : retours relevés, réponses renvoyées.
    const stopReview = startReviewSync();
    setHomeHooks({ removed: (id) => void cloudForget(id), restored: (id) => void cloudRestore(id) });
    if (useCloud.getState().enabled && useCloud.getState().user) void preloadGoogle().catch(() => undefined);
    void boot().finally(() => {
      setBooted(true);
      // Session Google reprise (jeton encore valide) : les autres appareils sont rattrapés.
      if (useCloud.getState().connected) void syncAll();
      // Ménage discret : images et sons qui ne servent plus à aucun projet.
      setTimeout(() => void pruneOrphanBlobs().catch(() => undefined), 1500);
    });
    return () => {
      stop();
      stopCloud();
      stopSession();
      stopReview();
    };
  }, []);

  // Un fichier lâché hors d'une zone de dépôt ne doit pas remplacer l'application par ce fichier.
  useEffect(() => {
    const stray = (e: DragEvent) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLInputElement && el.type === 'file') return;
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stray);
    window.addEventListener('drop', stray);
    return () => {
      window.removeEventListener('dragover', stray);
      window.removeEventListener('drop', stray);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ds-theme', theme);
    } catch {
      /* stockage indisponible */
    }
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (isShortcut(e, 'save')) {
        e.preventDefault();
        // Invité sans droit de copie : rien n'est enregistré sur cet ordinateur.
        if (useShare.getState().role === 'guest' && !useShare.getState().keep) return;
        void saveToFile();
        return;
      }
      if (isShortcut(e, 'palette')) {
        e.preventDefault();
        setUi({ paletteOpen: !useUi.getState().paletteOpen });
        return;
      }
      if (e.key === 'Escape' && useUi.getState().helpOpen) setUi({ helpOpen: false });
      if (e.defaultPrevented || isTextTarget(e.target)) return;
      if (isShortcut(e, 'help')) {
        e.preventDefault();
        setUi({ helpOpen: true });
        return;
      }
      const isUndo = isShortcut(e, 'undo');
      const isRedo = isShortcut(e, 'redo') || (mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y'));
      if (isUndo || isRedo) {
        e.preventDefault();
        // À l'accueil, annuler / rétablir portent sur la suppression des projets.
        if (window.location.hash.replace(/^#\/?/, '').split('?')[0] === '' || window.location.hash.startsWith('#/home')) {
          if (isRedo) void redoHome();
          else void undoHome();
        } else if (isRedo) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setUi]);

  if (route === 'print' && doc && booted && canCopy) {
    return (
      <>
        <ErrorBoundary onHome={() => navigate('home')}>
          <PrintPage doc={doc} />
        </ErrorBoundary>
        <Toasts />
      </>
    );
  }

  const showSidebar = route !== 'home' && !!doc;
  // Ordinateur : menu déplié ou réduit en barre d'icônes. Téléphone : tiroir ouvert ou fermé.
  const sidebarShown = showSidebar && (sidebarOpen || !phone);

  return (
    <div className={s.app} data-readonly={readOnly || undefined} data-nocopy={!canCopy || undefined}>
      <a className="skip-link" href="#contenu" onClick={(e) => {
        e.preventDefault();
        document.getElementById('contenu')?.focus();
      }}>
        Aller au contenu
      </a>
      {route !== 'home' && (
        <Topbar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={showSidebar ? () => toggleSidebar() : undefined}
          doc={doc}
          saveStatus={doc ? SAVE_LABEL[saveStatus] : ''}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onSave={canCopy ? () => void saveToFile() : undefined}
          readOnly={readOnly || route === 'review'}
          theme={theme}
          onToggleTheme={(e) => switchTheme(e)}
          account={readOnly || route === 'review' ? undefined : <AccountButton />}
        />
      )}
      <GuestBanner />
      <div className={s.body}>
        {sidebarShown && phone && <div className={s.scrim} onClick={() => toggleSidebar(false)} aria-hidden="true" />}
        {sidebarShown && (
          <Sidebar activeRoute={route} collapsed={!sidebarOpen && !phone} counts={{ checks: checkCount }} onNavigate={phone ? () => toggleSidebar(false) : undefined} />
        )}
        <main
          className={s.main}
          id="contenu"
          tabIndex={-1}
          // Lecture seule : pas de menus contextuels d'édition.
          onContextMenuCapture={readOnly ? (e) => e.stopPropagation() : undefined}
        >
          {booted && (
            <ErrorBoundary key={route} onHome={() => navigate('home')}>
              <Page route={route} />
            </ErrorBoundary>
          )}
        </main>
        {doc && !readOnly && route !== 'home' && aiReady && <AssistantPanel />}
      </div>
      <Toasts />
      <CommentPopover />
      <CommentsPanel />
      <SketchPad />
      <DialogHost />
      <ContextMenuHost />
      <CommandPalette />
      <HelpDialog />
    </div>
  );
}

function Page({ route }: { route: Route }) {
  const doc = useDoc();
  const readOnly = useReadOnly();
  const canCopy = useCanCopy();
  const drive = useDriveReview();
  if (route === 'home') return <HomePage />;
  if (route === 'join') return <JoinPage />;
  if (route === 'review') return <ReviewPage />;
  if (!doc) {
    return (
      <div className="page">
        <div className="card empty">
          <span className="hand">Aucun projet ouvert</span>
          <p>Choisissez un projet à l’accueil, ou créez-en un nouveau.</p>
          <Button variant="primary" autoFocus onClick={() => navigate('home')}>
            Aller à l’accueil
          </Button>
        </div>
      </div>
    );
  }
  if (route === 'grid') return <GridPage doc={doc} />;
  // Relecture en ligne : seuls le scénario et le découpage sont publiés.
  if (drive && !REVIEWED.has(route)) return <GridPage doc={doc} />;
  // Invité sans droit de copie : rien à exporter, le découpage à la place.
  if (route === 'export') return canCopy ? <ExportPage doc={doc} /> : <GridPage doc={doc} />;
  if (route === 'registry') return <RegistryPage doc={doc} />;
  // Lecture seule : pas de réglages, le découpage à la place.
  if (route === 'settings') return readOnly ? <GridPage doc={doc} /> : <SettingsPage doc={doc} />;
  if (route === 'checks') return <ChecksPage doc={doc} />;
  if (route === 'intention') return <IntentionPage doc={doc} />;
  if (route === 'scenario') return <ScenarioPage doc={doc} />;
  // Le storyboard est une vue du découpage technique.
  if (route === 'storyboard') return <GridPage doc={doc} board />;
  if (route === 'floorplan') return <FloorPlanPage doc={doc} />;
  if (route === 'schedule') return <SchedulePage doc={doc} />;
  if (route === 'callsheet') return <CallSheetPage doc={doc} />;
  if (route === 'calendar') return <CalendarPage doc={doc} />;
  if (route === 'production') return <ProductionPage doc={doc} />;
  if (route === 'breakdown') return <BreakdownPage doc={doc} />;
  if (route === 'equipment') return <EquipmentPage doc={doc} />;
  return (
    <div className="page">
      <div className="card empty">
        <span className="hand">Cette étape arrive bientôt</span>
        <p>Le découpage technique est déjà prêt à l’emploi.</p>
        <Button variant="outline" onClick={() => navigate('grid')}>
          Ouvrir le découpage
        </Button>
      </div>
    </div>
  );
}
