import { useEffect } from 'react';
import { createProjectDoc } from '../domain/factory';
import { buildFiction } from '../../seed/fiction';
import { buildRav3 } from '../../seed/rav3';
import { GridPage } from '../features/grid/GridPage';
import { Sidebar } from '../features/shell/Sidebar';
import { Topbar } from '../features/shell/Topbar';
import { redo, undo, useDoc, useHistory, useProjectStore } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { Button } from '../ui/Button';
import { DialogHost } from '../ui/Modal';
import { Toasts } from '../ui/Toasts';
import { useLocation } from './router';
import s from './App.module.css';

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function App() {
  const { route } = useLocation();
  const doc = useDoc();
  const theme = useUi((u) => u.theme);
  const setUi = useUi((u) => u.set);
  const { canUndo, canRedo } = useHistory();

  useEffect(() => {
    const seed = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed');
    if (seed === 'rav3') useProjectStore.getState().loadDoc(buildRav3());
    else if (seed === 'fiction') useProjectStore.getState().loadDoc(buildFiction());
    else if (!useProjectStore.getState().doc) useProjectStore.getState().loadDoc(createProjectDoc({ title: 'Projet sans titre', format: 'fiction' }));
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
      if (e.defaultPrevented || isTextTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = doc?.project.title ?? '';
  return (
    <div className={s.app}>
      <Topbar
        projectTitle={title}
        saveStatus="Enregistré dans le navigateur"
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={() => undefined}
        onExport={() => undefined}
        theme={theme}
        onToggleTheme={() => setUi({ theme: theme === 'papier' ? 'encre' : 'papier' })}
        userInitial={(doc?.project.director ?? title ?? 'D').charAt(0).toUpperCase() || 'D'}
        primary={<Button variant="primary">Valider l'étape</Button>}
      />
      <div className={s.body}>
        <Sidebar projectTitle={title} activeRoute={route === 'home' ? 'grid' : route} validated={doc?.validatedSteps ?? []} progress={{}} />
        <main className={s.main}>{doc && <GridPage doc={doc} />}</main>
      </div>
      <Toasts />
      <DialogHost />
    </div>
  );
}
