import { useState } from 'react';
import { useDraft } from '../../ui/useDraft';
import { ArrowLeft, BookOpen, PenLine, X } from 'lucide-react';
import type { ProjectDoc } from '../../domain/types';
import { shotCode } from '../../domain/numbering';
import { useUi } from '../../store/uiStore';
import { useScriptCapture } from '../grid/scriptCapture';
import { LinkModeToggle, ScriptReader, commitScenario } from './ScriptReader';
import s from './ScenarioPanel.module.css';

const MIN_W = 300;
const MAX_W = 900;
const readWidth = () => {
  try {
    return Math.min(MAX_W, Math.max(MIN_W, Number(localStorage.getItem('ds-scenario-width')) || 420));
  } catch {
    return 420;
  }
};

/**
 * Scénario dans le découpage (panneau de droite) : lecture active (+ par phrase, + sur sélection)
 * ou écriture ; c'est le même texte que l'onglet Scénario. Largeur réglable en tirant le bord gauche.
 */
export function ScenarioPanel({ doc }: { doc: ProjectDoc }) {
  const [mode, setMode] = useState<'read' | 'write'>('read');
  const [width, setWidth] = useState(readWidth);
  // Texte modifié ailleurs (onglet Scénario, autre participant) : repris tant qu'on n'écrit pas ici ;
  // la saisie est appliquée après une pause, en quittant le champ, la page, ou avant d'enregistrer.
  const [draft, setDraft, flushDraft] = useDraft(doc.scenario ?? '', commitScenario, 700);
  // Cellule Action ouverte en saisie : en lecture, ce qu'on choisit dans le scénario y entre.
  const target = useScriptCapture((c) => c.target);
  const capturing = mode === 'read' && !!target && !!doc.shots[target.shotId];

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, w0 + (x0 - ev.clientX))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => {
        try {
          localStorage.setItem('ds-scenario-width', String(w));
        } catch {
          /* stockage indisponible */
        }
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className={['card', s.panel].join(' ')} style={{ width }} aria-label="Scénario" data-capturing={capturing || undefined} data-testid="scenario-panel">
      <div className={s.resize} onPointerDown={startResize} title="Tirer pour élargir" role="separator" aria-orientation="vertical" />
      <header className={s.head}>
        <div className={s.seg} role="radiogroup" aria-label="Mode du scénario">
          <button type="button" role="radio" aria-checked={mode === 'read'} className={mode === 'read' ? s.on : ''} onClick={() => setMode('read')}>
            <BookOpen size={13} /> Lire
          </button>
          <button type="button" role="radio" aria-checked={mode === 'write'} className={mode === 'write' ? s.on : ''} onClick={() => setMode('write')}>
            <PenLine size={13} /> Écrire
          </button>
        </div>
        <button type="button" className={s.close} aria-label="Fermer le scénario" onClick={() => useUi.getState().set({ rightPanel: null })}>
          <X size={15} />
        </button>
      </header>
      <div className={s.opts}>
        {capturing ? (
          // Même ligne, même hauteur : la destination remplace le réglage, qui ne sert pas ici.
          <span className={s.target} data-testid="capture-target">
            <ArrowLeft size={13} strokeWidth={1.5} aria-hidden="true" />
            Action du plan {shotCode(doc, target.shotId)}
          </span>
        ) : (
          <LinkModeToggle doc={doc} />
        )}
      </div>
      <div className={s.body}>
        {mode === 'read' ? (
          <ScriptReader doc={doc} source={doc.scenario ?? ''} capture />
        ) : (
          <textarea
            className={s.editor}
            value={draft}
            spellCheck={false}
            onBlur={flushDraft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Scénario (syntaxe Fountain)"
            data-testid="scenario-panel-editor"
          />
        )}
      </div>
    </aside>
  );
}
