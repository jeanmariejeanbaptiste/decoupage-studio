import { useEffect, useState } from 'react';
import { runChecks } from '../domain/lint';
import { computeTiming } from '../domain/timing';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { ChecksPage } from '../features/checks/ChecksPage';
import { EquipmentPage } from '../features/equipment/EquipmentPage';
import { ExportPage } from '../features/export/ExportPage';
import { IntentionPage } from '../features/intention/IntentionPage';
import { ScenarioPage } from '../features/scenario/ScenarioPage';
import { StoryboardPage } from '../features/storyboard/StoryboardPage';
import { FloorPlanPage } from '../features/floorplan/FloorPlanPage';
import { SchedulePage } from '../features/schedule/SchedulePage';
import { CallSheetPage } from '../features/callsheet/CallSheetPage';
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
import { lastProjectId, openDoc, openStoredProject, saveToFile, startAutosave } from '../store/persistence';
import { redo, undo, useDoc, useHistory } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { Button } from '../ui/Button';
import { ContextMenuHost } from '../ui/ContextMenu';
import { DialogHost } from '../ui/Modal';
import { Toasts } from '../ui/Toasts';
import { navigate, useLocation, type Route } from './router';
import s from './App.module.css';

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

const SAVE_LABEL: Record<string, string> = {
  saved: 'Enregistré dans le navigateur',
  saving: 'Enregistrement…',
  dirty: 'Modifications en cours…',
  error: 'Échec de l’enregistrement',
  idle: '',
};

async function boot(): Promise<void> {
  const seed = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed');
  if (seed === 'rav3') return openDoc(buildRav3());
  if (seed === 'fiction') return openDoc(buildFiction());
  const last = lastProjectId();
  if (last && (await openStoredProject(last))) return;
}

export function App() {
  const { route } = useLocation();
  const doc = useDoc();
  const theme = useUi((u) => u.theme);
  const saveStatus = useUi((u) => u.saveStatus);
  const sidebarOpen = useUi((u) => u.sidebarOpen);
  const toggleSidebar = () => {
    const next = !useUi.getState().sidebarOpen;
    setUi({ sidebarOpen: next });
    try {
      localStorage.setItem('ds-sidebar', next ? '1' : '0');
    } catch {
      /* stockage indisponible : le choix vaut pour la session */
    }
  };
  const setUi = useUi((u) => u.set);
  const { canUndo, canRedo } = useHistory();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const stop = startAutosave();
    void boot().finally(() => setBooted(true));
    return stop;
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
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void saveToFile();
        return;
      }
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setUi({ paletteOpen: !useUi.getState().paletteOpen });
        return;
      }
      if (e.key === 'Escape' && useUi.getState().helpOpen) setUi({ helpOpen: false });
      if (e.defaultPrevented || isTextTarget(e.target)) return;
      if (e.key === '?' && !mod) {
        e.preventDefault();
        setUi({ helpOpen: true });
        return;
      }
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setUi]);

  if (route === 'print' && doc && booted) {
    return (
      <>
        <PrintPage doc={doc} />
        <Toasts />
      </>
    );
  }

  const title = doc?.project.title ?? '';
  const checkCount = doc ? runChecks(doc, computeTiming(doc)).length : 0;
  const showSidebar = route !== 'home' && !!doc;

  return (
    <div className={s.app}>
      <a className="skip-link" href="#contenu" onClick={(e) => {
        e.preventDefault();
        document.getElementById('contenu')?.focus();
      }}>
        Aller au contenu
      </a>
      <Topbar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={showSidebar ? toggleSidebar : undefined}
        projectTitle={route === 'home' ? undefined : title}
        saveStatus={doc ? SAVE_LABEL[saveStatus] : ''}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void saveToFile()}
        theme={theme}
        onToggleTheme={() => setUi({ theme: theme === 'papier' ? 'encre' : 'papier' })}
        userInitial={(doc?.project.director || title || 'D').charAt(0).toUpperCase()}
      />
      <div className={s.body}>
        {showSidebar && sidebarOpen && doc && <Sidebar
            projectTitle={title}
            activeRoute={route}
            extraLinks={[
              { label: 'Registre', route: 'registry', count: doc.project.sequenceIds.length },
              { label: 'Vérifications', route: 'checks', count: checkCount },
            ]}
          />}
        <main className={s.main} id="contenu" tabIndex={-1}>{booted && <Page route={route} />}</main>
      </div>
      <Toasts />
      <DialogHost />
      <ContextMenuHost />
      <CommandPalette />
      <HelpDialog />
    </div>
  );
}

function Page({ route }: { route: Route }) {
  const doc = useDoc();
  if (route === 'home') return <HomePage />;
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
  if (route === 'export') return <ExportPage doc={doc} />;
  if (route === 'registry') return <RegistryPage doc={doc} />;
  if (route === 'settings') return <SettingsPage doc={doc} />;
  if (route === 'checks') return <ChecksPage doc={doc} />;
  if (route === 'intention') return <IntentionPage doc={doc} />;
  if (route === 'scenario') return <ScenarioPage doc={doc} />;
  if (route === 'storyboard') return <StoryboardPage doc={doc} />;
  if (route === 'floorplan') return <FloorPlanPage doc={doc} />;
  if (route === 'schedule') return <SchedulePage doc={doc} />;
  if (route === 'callsheet') return <CallSheetPage doc={doc} />;
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
