import { Home, Moon, PanelLeft, Redo2, Save, Settings, Sun, Undo2 } from 'lucide-react';
import { APP_NAME } from '../../app/config';
import { navigate } from '../../app/router';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import s from './Topbar.module.css';

const IC = { size: 17, strokeWidth: 1.25 } as const;

interface Props {
  projectTitle?: string;
  saveStatus: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  theme: 'papier' | 'encre';
  onToggleTheme: () => void;
  userInitial: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function Topbar(p: Props) {
  return (
    <header className={[s.topbar, 'no-print'].join(' ')}>
      <div className={s.left}>
        {p.onToggleSidebar && (
          <Button variant="icon" aria-label="Afficher ou masquer le menu latéral" title="Afficher ou masquer le menu latéral" aria-pressed={p.sidebarOpen} onClick={p.onToggleSidebar} icon={<PanelLeft {...IC} />} data-testid="toggle-sidebar" />
        )}
        <Button variant="icon" aria-label="Accueil" title="Accueil" onClick={() => navigate('home')} icon={<Home {...IC} />} />
        <Button variant="icon" aria-label="Enregistrer (⌘S)" title="Enregistrer (⌘S)" onClick={p.onSave} icon={<Save {...IC} />} />
        <Button variant="icon" aria-label="Annuler (⌘Z)" title="Annuler (⌘Z)" disabled={!p.canUndo} onClick={p.onUndo} icon={<Undo2 {...IC} />} />
        <Button variant="icon" aria-label="Rétablir (⌘⇧Z)" title="Rétablir (⌘⇧Z)" disabled={!p.canRedo} onClick={p.onRedo} icon={<Redo2 {...IC} />} />
        <Hand className={s.status}>
          <span data-testid="save-status">{p.saveStatus}</span>
        </Hand>
      </div>
      <div className={s.center}>
        <span className={s.app}>{APP_NAME}</span>
        {p.projectTitle && (
          <>
            <span className={s.sep}>·</span>
            <span className={s.title}>{p.projectTitle}</span>
          </>
        )}
      </div>
      <div className={s.right}>
        <span className={s.avatar} aria-hidden="true">{p.userInitial}</span>
        <Button
          variant="icon"
          aria-label={p.theme === 'encre' ? 'Thème papier' : 'Thème encre'}
          title={p.theme === 'encre' ? 'Thème papier' : 'Thème encre'}
          onClick={p.onToggleTheme}
          icon={p.theme === 'encre' ? <Sun {...IC} /> : <Moon {...IC} />}
        />
        <Button variant="icon" aria-label="Réglages" title="Réglages" onClick={() => navigate('settings')} icon={<Settings {...IC} />} />
      </div>
    </header>
  );
}
