import { create } from 'zustand';
import { deleteProject, restoreProject, snapshotProject, type ProjectSnapshot } from './db';
import { dropPendingSave } from './persistence';

/**
 * Historique de l'accueil : la suppression d'un projet s'annule (⌘Z) et se rétablit (⌘⇧Z),
 * comme une modification du découpage. Le projet est gardé en mémoire le temps de la session.
 */
interface HomeHistory {
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  /** Incrémenté à chaque changement, pour rafraîchir la liste des projets. */
  rev: number;
}

export const useHomeHistory = create<HomeHistory>(() => ({ past: [], future: [], rev: 0 }));

/** Suites d'une suppression ou d'une restauration (synchronisation en ligne). */
const hooks: { removed?: (id: string) => void; restored?: (id: string) => void } = {};
export const setHomeHooks = (h: typeof hooks) => Object.assign(hooks, h);

export async function removeProject(id: string): Promise<void> {
  // Un enregistrement en attente ne doit pas faire revenir le projet supprimé.
  dropPendingSave(id);
  const snap = await snapshotProject(id);
  await deleteProject(id);
  if (snap) useHomeHistory.setState((s) => ({ past: [...s.past, snap], future: [], rev: s.rev + 1 }));
  hooks.removed?.(id);
}

/** Rétablit un projet supprimé précis (bouton « Annuler » de son message), sinon le dernier. */
export async function undoHome(projectId?: string): Promise<void> {
  const { past } = useHomeHistory.getState();
  const snap = projectId ? [...past].reverse().find((p) => p.project.id === projectId) : past[past.length - 1];
  if (!snap) return;
  await restoreProject(snap);
  useHomeHistory.setState((s) => ({ past: s.past.filter((p) => p !== snap), future: [...s.future, snap], rev: s.rev + 1 }));
  hooks.restored?.(snap.project.id);
}

export async function redoHome(): Promise<void> {
  const { future } = useHomeHistory.getState();
  const old = future[future.length - 1];
  if (!old) return;
  // Le projet a pu changer depuis sa restauration : on garde son état actuel pour pouvoir annuler.
  const snap = (await snapshotProject(old.project.id)) ?? old;
  dropPendingSave(old.project.id);
  await deleteProject(old.project.id);
  useHomeHistory.setState((s) => ({ future: s.future.slice(0, -1), past: [...s.past, snap], rev: s.rev + 1 }));
  hooks.removed?.(old.project.id);
}
