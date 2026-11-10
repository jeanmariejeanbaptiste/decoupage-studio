import { useState } from 'react';
import type { ProjectDoc } from '../../../domain/types';
import { TextToggle } from '../TextToggle';

export type OutlineMode = 'list' | 'plots';
const MODES: ReadonlyArray<readonly [OutlineMode, string]> = [
  ['list', 'Liste'],
  ['plots', 'Par intrigue'],
];

export const savedOutlineMode = (): OutlineMode => {
  try {
    return localStorage.getItem('ds-outline-view') === 'plots' ? 'plots' : 'list';
  } catch {
    return 'list';
  }
};

/**
 * Outils du Séquencier (ligne 2 de la page). Provisoire : la bascule Liste / Par intrigue est retenue
 * (`ds-outline-view`) mais ne change encore rien ; le menu Intrigues viendra après elle, à 24 px.
 */
export function OutlineToolbar({ doc }: { doc: ProjectDoc }) {
  const [mode, setModeState] = useState<OutlineMode>(savedOutlineMode);
  const setMode = (m: OutlineMode) => {
    setModeState(m);
    try {
      localStorage.setItem('ds-outline-view', m);
    } catch {
      /* choix valable pour la session */
    }
  };
  return <TextToggle key={doc.project.id} label="Affichage du séquencier" items={MODES} value={mode} onChange={setMode} testId="outline-mode" />;
}
