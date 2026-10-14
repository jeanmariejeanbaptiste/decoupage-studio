import { navigate } from '../../app/router';
import { saveToFile, openFromFile } from '../../store/persistence';
import { redo, undo, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import {
  deleteCurrentShots,
  deleteSequenceOf,
  duplicateCurrent,
  fillDown,
  linkSelection,
  newSequenceAfter,
  newShotBelow,
  unlinkSelection,
} from '../grid/actions';

export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  run: () => void;
  needsProject?: boolean;
}

const toGrid = (fn: () => void) => () => {
  if (window.location.hash.startsWith('#/grid')) fn();
  else {
    navigate('grid');
    setTimeout(fn, 0);
  }
};

export const COMMANDS: readonly Command[] = [
  { id: 'new-shot', group: 'Grille', label: 'Nouveau plan sous le plan courant', shortcut: '⌘↵', run: toGrid(newShotBelow), needsProject: true },
  { id: 'new-seq', group: 'Grille', label: 'Nouvelle séquence', shortcut: '⌘⇧↵', run: toGrid(newSequenceAfter), needsProject: true },
  { id: 'dup', group: 'Grille', label: 'Dupliquer le plan', shortcut: '⌘D', run: toGrid(duplicateCurrent), needsProject: true },
  { id: 'del-shot', group: 'Grille', label: 'Supprimer le plan', shortcut: '⌘⌫', run: toGrid(deleteCurrentShots), needsProject: true },
  { id: 'del-seq', group: 'Grille', label: 'Supprimer la séquence…', run: toGrid(() => void deleteSequenceOf()), needsProject: true },
  { id: 'link', group: 'Grille', label: 'Lier l’action des plans sélectionnés', run: toGrid(linkSelection), needsProject: true },
  { id: 'unlink', group: 'Grille', label: 'Délier l’action', run: toGrid(unlinkSelection), needsProject: true },
  { id: 'fill', group: 'Grille', label: 'Recopier vers le bas', shortcut: '⌘⇧↓', run: toGrid(fillDown), needsProject: true },
  {
    id: 'print-view',
    group: 'Grille',
    label: 'Basculer la vue impression',
    run: toGrid(() => useUi.getState().set({ printView: !useUi.getState().printView })),
    needsProject: true,
  },
  {
    id: 'inspector',
    group: 'Grille',
    label: 'Afficher / masquer l’inspecteur',
    run: toGrid(() => useUi.getState().set({ inspectorOpen: !useUi.getState().inspectorOpen })),
    needsProject: true,
  },
  { id: 'undo', group: 'Édition', label: 'Annuler', shortcut: '⌘Z', run: undo, needsProject: true },
  { id: 'redo', group: 'Édition', label: 'Rétablir', shortcut: '⌘⇧Z', run: redo, needsProject: true },
  { id: 'go-home', group: 'Aller à', label: 'Accueil — projets', run: () => navigate('home') },
  { id: 'go-intention', group: 'Aller à', label: 'Note d’intention', run: () => navigate('intention'), needsProject: true },
  { id: 'go-scenario', group: 'Aller à', label: 'Scénario', run: () => navigate('scenario'), needsProject: true },
  { id: 'go-grid', group: 'Aller à', label: 'Découpage technique', run: () => navigate('grid'), needsProject: true },
  { id: 'go-registry', group: 'Aller à', label: 'Registre', run: () => navigate('registry'), needsProject: true },
  { id: 'go-checks', group: 'Aller à', label: 'Vérifications', run: () => navigate('checks'), needsProject: true },
  { id: 'go-equipment', group: 'Aller à', label: 'Listes de matériel', run: () => navigate('equipment'), needsProject: true },
  { id: 'go-export', group: 'Aller à', label: 'Exporter', run: () => navigate('export'), needsProject: true },
  { id: 'go-settings', group: 'Aller à', label: 'Réglages', run: () => navigate('settings'), needsProject: true },
  { id: 'pdf', group: 'Fichier', label: 'Exporter en PDF', run: () => navigate('print', { auto: '1' }), needsProject: true },
  { id: 'save', group: 'Fichier', label: 'Enregistrer le fichier .decoupage', shortcut: '⌘S', run: () => void saveToFile(), needsProject: true },
  { id: 'open', group: 'Fichier', label: 'Ouvrir un fichier .decoupage…', run: () => void openFromFile().then((ok) => ok && navigate('grid')) },
  {
    id: 'theme',
    group: 'Affichage',
    label: 'Basculer le thème papier / encre',
    run: () => useUi.getState().set({ theme: useUi.getState().theme === 'papier' ? 'encre' : 'papier' }),
  },
  { id: 'help', group: 'Affichage', label: 'Aide des raccourcis', shortcut: '?', run: () => useUi.getState().set({ helpOpen: true }) },
];

export function availableCommands(): Command[] {
  const has = !!useProjectStore.getState().doc;
  return COMMANDS.filter((c) => has || !c.needsProject);
}
