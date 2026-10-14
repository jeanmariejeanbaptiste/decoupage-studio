import { useState } from 'react';
import { useLocation } from './router';
import { Sidebar } from '../features/shell/Sidebar';
import { Topbar } from '../features/shell/Topbar';
import { Button } from '../ui/Button';
import s from './App.module.css';

export function App() {
  const { route } = useLocation();
  const [theme, setTheme] = useState<'papier' | 'encre'>('papier');
  return (
    <div className={s.app} data-theme={theme}>
      <Topbar
        projectTitle="Projet sans titre"
        saveStatus="Enregistré dans le navigateur"
        canUndo={false}
        canRedo={false}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onSave={() => undefined}
        onExport={() => undefined}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'papier' ? 'encre' : 'papier')}
        userInitial="R"
        primary={<Button variant="primary">Valider l'étape</Button>}
      />
      <div className={s.body}>
        <Sidebar projectTitle="Projet sans titre" activeRoute={route === 'home' ? 'grid' : route} validated={[]} progress={{}} />
        <main className={s.main}>
          <div className="page">
            <p className="page-kicker">Étape 4 · Découpage</p>
            <h1 className="page-title">Les <em>0</em> séquences</h1>
            <div className="card empty">
              <span className="hand">Aucune séquence pour l'instant</span>
              Créez la première, ou importez un scénario.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
