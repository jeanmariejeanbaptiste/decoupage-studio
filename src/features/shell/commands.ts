import { switchTheme } from '../../ui/themeSwitch';
import type { ShortcutId } from '../../domain/shortcuts';
import { navigate, scenarioHref, type Route, type ScenarioView } from '../../app/router';
import { REVIEWED } from './steps';
import { saveToFile, openFromFile } from '../../store/persistence';
import { redo, undo, useProjectStore } from '../../store/projectStore';
import { redoHome, undoHome } from '../../store/homeHistory';
import { useShare } from '../../store/share';
import { toggleSidebar, useUi } from '../../store/uiStore';
import { toggleAssistant } from '../assistant/assistant';
import { useAiStatus } from '../assistant/aiStatus';
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
  shortcut?: ShortcutId;
  run: () => void;
  needsProject?: boolean;
  /** Emporte le projet hors de l'application (enregistrement, export) : refusé à l'invité sans copie. */
  copies?: boolean;
  /** Modifie le projet : refusé à l'invité en lecture seule. */
  edits?: boolean;
  /** Proposée seulement si la condition est remplie. */
  when?: () => boolean;
}

const toGrid = (fn: () => void) => () => {
  if (window.location.hash.startsWith('#/grid')) fn();
  else {
    navigate('grid');
    setTimeout(fn, 0);
  }
};

export const COMMANDS: readonly Command[] = [
  { id: 'new-shot', group: 'Grille', label: 'Nouveau plan sous le plan courant', shortcut: 'newShot', run: toGrid(newShotBelow), needsProject: true, edits: true },
  { id: 'new-seq', group: 'Grille', label: 'Nouvelle séquence', shortcut: 'newSequence', run: toGrid(newSequenceAfter), needsProject: true, edits: true },
  { id: 'dup', group: 'Grille', label: 'Dupliquer le plan', shortcut: 'duplicate', run: toGrid(duplicateCurrent), needsProject: true, edits: true },
  { id: 'del-shot', group: 'Grille', label: 'Supprimer le plan', shortcut: 'deleteShot', run: toGrid(deleteCurrentShots), needsProject: true, edits: true },
  { id: 'del-seq', group: 'Grille', label: 'Supprimer la séquence…', run: toGrid(() => void deleteSequenceOf()), needsProject: true, edits: true },
  { id: 'link', group: 'Grille', label: 'Lier l’action des plans sélectionnés', run: toGrid(linkSelection), needsProject: true, edits: true },
  { id: 'unlink', group: 'Grille', label: 'Délier l’action', run: toGrid(unlinkSelection), needsProject: true, edits: true },
  { id: 'fill', group: 'Grille', label: 'Recopier vers le bas', shortcut: 'fillDown', run: toGrid(fillDown), needsProject: true, edits: true },
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
    run: toGrid(() => useUi.getState().set({ rightPanel: useUi.getState().rightPanel === 'inspector' ? null : 'inspector' })),
    needsProject: true,
  },
  // À l'accueil, annuler / rétablir portent sur la suppression des projets (comme ⌘Z).
  { id: 'undo', group: 'Édition', label: 'Annuler', shortcut: 'undo', run: () => (atHome() ? void undoHome() : undo()), needsProject: true, edits: true },
  { id: 'redo', group: 'Édition', label: 'Rétablir', shortcut: 'redo', run: () => (atHome() ? void redoHome() : redo()), needsProject: true, edits: true },
  { id: 'go-home', group: 'Aller à', label: 'Accueil — projets', run: () => navigate('home') },
  { id: 'go-intention', group: 'Aller à', label: 'Note d’intention', run: () => navigate('intention'), needsProject: true },
  ...(
    [
      ['outline', 'Séquencier'],
      ['script', 'Texte'],
      ['cut', 'Découpage'],
      ['stats', 'Statistiques'],
    ] as const satisfies ReadonlyArray<readonly [ScenarioView, string]>
  ).map(([v, label]): Command => ({
    id: `go-scenario:${v}`,
    group: 'Aller à',
    label: `Scénario : ${label}`,
    run: () => void (window.location.hash = scenarioHref(v)),
    needsProject: true,
  })),
  { id: 'go-breakdown', group: 'Aller à', label: 'Dépouillement', run: () => navigate('breakdown'), needsProject: true },
  { id: 'go-grid', group: 'Aller à', label: 'Découpage technique', run: () => navigate('grid'), needsProject: true },
  { id: 'go-storyboard', group: 'Aller à', label: 'Storyboard', run: () => navigate('storyboard'), needsProject: true },
  { id: 'go-floorplan', group: 'Aller à', label: 'Plan au sol', run: () => navigate('floorplan'), needsProject: true },
  { id: 'go-registry', group: 'Aller à', label: 'Registre', run: () => navigate('registry'), needsProject: true },
  { id: 'go-checks', group: 'Aller à', label: 'Vérifications', run: () => navigate('checks'), needsProject: true },
  { id: 'go-equipment', group: 'Aller à', label: 'Listes de matériel', run: () => navigate('equipment'), needsProject: true },
  { id: 'go-schedule', group: 'Aller à', label: 'Plan de travail', run: () => navigate('schedule'), needsProject: true },
  { id: 'go-callsheet', group: 'Aller à', label: 'Feuille de service', run: () => navigate('callsheet'), needsProject: true },
  { id: 'go-production', group: 'Aller à', label: 'Calendrier de production', run: () => navigate('production'), needsProject: true },
  { id: 'go-calendar', group: 'Aller à', label: 'Calendrier', run: () => navigate('calendar'), needsProject: true },
  { id: 'go-export', group: 'Aller à', label: 'Exporter', run: () => navigate('export'), needsProject: true },
  { id: 'go-settings', group: 'Aller à', label: 'Paramètres', run: () => navigate('settings'), needsProject: true, edits: true },
  { id: 'pdf', group: 'Fichier', label: 'Exporter en PDF', run: () => navigate('print', { auto: '1' }), needsProject: true, copies: true },
  {
    id: 'outline-pdf',
    group: 'Fichier',
    label: 'Exporter le séquencier (PDF)',
    run: () => {
      const doc = useProjectStore.getState().doc;
      if (doc) void import('../scenario/outlineExport').then((m) => m.exportOutlinePdf(doc));
    },
    needsProject: true,
    copies: true,
    when: () => !!useProjectStore.getState().doc?.scenario?.trim(),
  },
  { id: 'save', group: 'Fichier', label: 'Enregistrer le fichier .decoupage', shortcut: 'save', run: () => void saveToFile(), needsProject: true, copies: true },
  { id: 'open', group: 'Fichier', label: 'Ouvrir un fichier .decoupage…', run: () => void openFromFile().then((ok) => ok && navigate('grid')) },
  { id: 'assistant', group: 'Affichage', label: 'Assistant IA', run: () => toggleAssistant(), needsProject: true, edits: true, when: () => useAiStatus.getState().ready },
  {
    id: 'sidebar',
    group: 'Affichage',
    label: 'Réduire / déplier le menu latéral',
    run: () => toggleSidebar(),
    needsProject: true,
  },
  {
    id: 'theme',
    group: 'Affichage',
    label: 'Basculer le thème papier / encre',
    run: () => switchTheme(),
  },
  { id: 'help', group: 'Affichage', label: 'Aide des raccourcis', shortcut: 'help', run: () => useUi.getState().set({ helpOpen: true }) },
];

const atHome = () => {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return h === '' || h === 'home';
};

export function availableCommands(): Command[] {
  const has = !!useProjectStore.getState().doc;
  const sh = useShare.getState();
  const canCopy = sh.role !== 'guest' || sh.keep;
  // Lecture seule ou relecture : rien qui modifie le projet.
  const readOnly = sh.role === 'guest' && sh.mode !== 'edit';
  // Relecture en ligne : seuls le scénario et le découpage sont publiés.
  const drive = sh.role === 'guest' && sh.via === 'drive';
  // Sous-pages du Scénario (« go-scenario:<vue> ») : le séquencier n'est pas publié.
  const reachable = (c: Command) =>
    !drive || !c.id.startsWith('go-') || c.id === 'go-home' || (REVIEWED.has(c.id.slice(3).split(':')[0] as Route) && c.id !== 'go-scenario:outline');
  return COMMANDS.filter((c) => (has || !c.needsProject) && (canCopy || !c.copies) && (!readOnly || !c.edits) && reachable(c) && (!c.when || c.when()));
}
