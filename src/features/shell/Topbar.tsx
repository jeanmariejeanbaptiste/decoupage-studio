import type { ReactNode } from 'react';
import { useShortcutLabel } from '../../store/shortcuts';
import { ShareButton } from '../share/Share';
import { Home, Moon, PanelLeft, Redo2, Save, Sparkles, Sun, TriangleAlert, Undo2 } from 'lucide-react';
import type { ProjectDoc } from '../../domain/types';
import { navigate } from '../../app/router';
import { Button } from '../../ui/Button';
import { toggleAssistant, useAssistant } from '../assistant/assistant';
import { useAiStatus } from '../assistant/aiStatus';
import { ProjectMenu } from './ProjectMenu';
import s from './Topbar.module.css';

const IC = { size: 17, strokeWidth: 1.25 } as const;

interface Props {
  doc: ProjectDoc | null;
  saveStatus: string;
  /** Dernier enregistrement en échec : alerte visible à toute largeur. */
  saveError?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Absent : enregistrement indisponible (invité sans droit de copie). */
  onSave?: () => void;
  /** Invité en lecture seule : ni enregistrer, ni annuler, ni assistant. */
  readOnly?: boolean;
  theme: 'papier' | 'encre';
  onToggleTheme: (e: { clientX: number; clientY: number }) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** Compte (connexion Google), quand la synchronisation est disponible. */
  account?: ReactNode;
}

/** Barre du haut : navigation et projet à gauche, actions à droite. */
export function Topbar(p: Props) {
  const k = { save: useShortcutLabel('save'), undo: useShortcutLabel('undo'), redo: useShortcutLabel('redo') };
  const assistantOpen = useAssistant((a) => a.open);
  // L'assistant n'est proposé qu'une fois essayé et fonctionnel.
  const ai = useAiStatus();
  return (
    <header className={[s.topbar, 'no-print'].join(' ')}>
      <div className={s.left}>
        {p.onToggleSidebar && (
          <Button
            variant="icon"
            aria-label="Afficher ou réduire le menu"
            title="Afficher ou réduire le menu"
            aria-pressed={p.sidebarOpen}
            onClick={p.onToggleSidebar}
            icon={<PanelLeft {...IC} />}
            data-testid="toggle-sidebar"
          />
        )}
        <Button variant="icon" className={s.home} aria-label="Tous les projets" title="Tous les projets" onClick={() => navigate('home')} icon={<Home {...IC} />} />
        {p.doc && <ProjectMenu doc={p.doc} readOnly={p.readOnly} />}
        {p.saveStatus && (
          <span
            className={[s.status, p.saveError ? s.failed : ''].join(' ')}
            data-testid="save-status"
            role={p.saveError ? 'alert' : undefined}
            title={p.saveError ? p.saveStatus : undefined}
          >
            {p.saveError && <TriangleAlert size={15} strokeWidth={1.25} aria-hidden />}
            <span className={s.statusText}>{p.saveStatus}</span>
          </span>
        )}
      </div>
      <div className={s.right}>
        {!p.readOnly && (
          <div className={s.group}>
            <Button variant="icon" aria-label={`Annuler (${k.undo})`} title={`Annuler (${k.undo})`} disabled={!p.canUndo} onClick={p.onUndo} icon={<Undo2 {...IC} />} />
            <Button variant="icon" aria-label={`Rétablir (${k.redo})`} title={`Rétablir (${k.redo})`} disabled={!p.canRedo} onClick={p.onRedo} icon={<Redo2 {...IC} />} />
            {p.onSave && (
              <Button variant="icon" className={s.secondary} aria-label={`Enregistrer le fichier (${k.save})`} title={`Enregistrer le fichier .decoupage (${k.save})`} onClick={p.onSave} icon={<Save {...IC} />} />
            )}
          </div>
        )}
        {p.doc && !p.readOnly && ai.ready && (
          <Button
            variant="ghost"
            className={[s.assistant, assistantOpen ? s.pressed : '', ai.appear ? s.appear : ''].join(' ')}
            onAnimationEnd={() => useAiStatus.setState({ appear: false })}
            icon={<Sparkles size={15} strokeWidth={1.3} />}
            aria-pressed={assistantOpen}
            onClick={() => toggleAssistant()}
            data-testid="assistant-toggle"
          >
            <span className={s.assistantLabel}>Assistant</span>
          </Button>
        )}
        <ShareButton />
        <Button
          variant="icon"
          className={s.secondary}
          aria-label={p.theme === 'encre' ? 'Thème papier' : 'Thème encre'}
          title={p.theme === 'encre' ? 'Thème papier' : 'Thème encre'}
          onClick={p.onToggleTheme}
          icon={p.theme === 'encre' ? <Sun {...IC} /> : <Moon {...IC} />}
        />
        {p.account}
      </div>
    </header>
  );
}
