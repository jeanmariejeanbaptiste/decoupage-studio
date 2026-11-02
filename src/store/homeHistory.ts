import { create } from 'zustand';
import { deleteProject, restoreProject, snapshotProject, type ProjectSnapshot } from './db';

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

export async function removeProject(id: string): Promise<void> {
  const snap = await snapshotProject(id);
  await deleteProject(id);
  if (snap) useHomeHistory.setState((s) => ({ past: [...s.past, snap], future: [], rev: s.rev + 1 }));
}

export async function undoHome(): Promise<void> {
  const { past } = useHomeHistory.getState();
  const snap = past[past.length - 1];
  if (!snap) return;
  await restoreProject(snap);
  useHomeHistory.setState((s) => ({ past: s.past.slice(0, -1), future: [...s.future, snap], rev: s.rev + 1 }));
}

export async function redoHome(): Promise<void> {
  const { future } = useHomeHistory.getState();
  const snap = future[future.length - 1];
  if (!snap) return;
  await deleteProject(snap.project.id);
  useHomeHistory.setState((s) => ({ future: s.future.slice(0, -1), past: [...s.past, snap], rev: s.rev + 1 }));
}
