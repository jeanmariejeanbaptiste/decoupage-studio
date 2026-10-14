import { useEffect, useState } from 'react';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { ExportPage } from '../features/export/ExportPage';
import { PrintPage } from '../features/export/PrintPage';
import { GridPage } from '../features/grid/GridPage';
import { RegistryPage } from '../features/registry/RegistryPage';
import { HomePage } from '../features/shell/HomePage';
import { SettingsPage } from '../features/shell/SettingsPage';
import { Sidebar } from '../features/shell/Sidebar';
import { PREP_STEPS } from '../features/shell/steps';
import { Topbar } from '../features/shell/Topbar';
import { lastProjectId, openDoc, openStoredProject, saveToFile, startAutosave } from '../store/persistence';
import { mutateDoc, redo, undo, useDoc, useHistory } from '../store/projectStore';
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
      if (e.defaultPrevented || isTextTarget(e.target)) return;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (route === 'print' && doc && booted) {
    return (
      <>
        <PrintPage doc={doc} />
        <Toasts />
      </>
    );
  }

  const title = doc?.project.title ?? '';
  const step = PREP_STEPS.find((p) => p.route === route);
  const stepValidated = !!step && !!doc?.validatedSteps.includes(step.n);
  const showSidebar = route !== 'home' && !!doc;

  return (
    <div className={s.app}>
      <Topbar
        projectTitle={route === 'home' ? undefined : title}
        saveStatus={doc ? SAVE_LABEL[saveStatus] : ''}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void saveToFile()}
        onExport={() => navigate('export')}
        theme={theme}
        onToggleTheme={() => setUi({ theme: theme === 'papier' ? 'encre' : 'papier' })}
        userInitial={(doc?.project.director || title || 'D').charAt(0).toUpperCase()}
        primary={
          step && doc ? (
            <Button
              variant="primary"
              aria-pressed={stepValidated}
              onClick={() =>
                mutateDoc((d) => {
                  d.validatedSteps = stepValidated ? d.validatedSteps.filter((n) => n !== step.n) : [...d.validatedSteps, step.n].sort((a, b) => a - b);
                })
              }
            >
              {stepValidated ? 'Étape validée' : 'Valider l’étape'}
            </Button>
          ) : null
        }
      />
      <div className={s.body}>
        {showSidebar && doc && <Sidebar
            projectTitle={title}
            activeRoute={route}
            validated={doc.validatedSteps}
            progress={{}}
            extraLinks={[
              { label: 'Registre', route: 'registry', count: doc.project.sequenceIds.length },
            ]}
          />}
        <main className={s.main}>{booted && <Page route={route} />}</main>
      </div>
      <Toasts />
      <DialogHost />
      <ContextMenuHost />
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
  const step = PREP_STEPS.find((p) => p.route === route);
  return (
    <div className="page">
      <p className="page-kicker">{step ? `Étape ${step.n} · ${step.label}` : 'Bientôt'}</p>
      <h1 className="page-title">{step?.label ?? 'Cette page'}</h1>
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
