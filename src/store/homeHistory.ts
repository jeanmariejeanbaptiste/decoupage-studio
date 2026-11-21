import { create } from 'zustand';
import { deleteProject, liveReviewOf, restoreProject, snapshotProject, type ProjectSnapshot } from './db';
import { announceDeleted, dropPendingSave, flushPendingSave } from './persistence';
import { useUi } from './uiStore';

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

/**
 * Liste des projets changée ici (suppression, restauration, copie) : annoncée aux autres onglets sur
 * le canal des enregistrements, au même format. Une date vide ne fait rouvrir le projet nulle part.
 */
const TAB = `home-${Math.random().toString(36).slice(2)}`;
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ds-projects') : null;
export function announceProjects(id: string): void {
  try {
    channel?.postMessage({ id, updatedAt: '', tab: TAB });
  } catch {
    /* canal fermé : les autres onglets se mettront à jour au prochain affichage */
  }
}

export const useHomeHistory = create<HomeHistory>(() => ({ past: [], future: [], rev: 0 }));

/**
 * Suites d'une suppression ou d'une restauration (synchronisation en ligne) ; lien de relecture en
 * ligne fermé avant la suppression (elle n'a pas lieu s'il ne se ferme pas), rouvert à l'annulation.
 */
const hooks: {
  removed?: (id: string) => void;
  restored?: (id: string) => void;
  closeLink?: (fileId: string) => Promise<void>;
  reopenLink?: (projectId: string, fileId: string) => Promise<void>;
} = {};
export const setHomeHooks = (h: typeof hooks) => Object.assign(hooks, h);

/**
 * Supprime un projet. `liveReview` : fichier de sa relecture en ligne, lien encore ouvert ; il est
 * fermé d'abord (à appeler depuis le geste : la connexion Google peut s'ouvrir). S'il ne se ferme
 * pas, le projet reste et l'erreur remonte.
 */
export async function removeProject(id: string, liveReview?: string): Promise<void> {
  if (liveReview && hooks.closeLink) await hooks.closeLink(liveReview);
  // L'état en attente d'enregistrement est celui qu'« Annuler » doit rendre ; ensuite, plus rien
  // ne doit faire revenir le projet supprimé.
  await flushPendingSave(id);
  dropPendingSave(id);
  const snap = await snapshotProject(id);
  await deleteProject(id);
  announceDeleted(id);
  if (snap) useHomeHistory.setState((s) => ({ past: [...s.past, snap], future: [], rev: s.rev + 1 }));
  announceProjects(id);
  hooks.removed?.(id);
}

/** Rétablit un projet supprimé précis (bouton « Annuler » de son message), sinon le dernier. */
export async function undoHome(projectId?: string): Promise<void> {
  const { past } = useHomeHistory.getState();
  const snap = projectId ? [...past].reverse().find((p) => p.project.id === projectId) : past[past.length - 1];
  if (!snap) return;
  await restoreProject(snap);
  useHomeHistory.setState((s) => ({ past: s.past.filter((p) => p !== snap), future: [...s.future, snap], rev: s.rev + 1 }));
  announceProjects(snap.project.id);
  hooks.restored?.(snap.project.id);
  const live = liveReviewOf(snap.project.doc);
  if (live && hooks.reopenLink) await hooks.reopenLink(snap.project.id, live);
}

export async function redoHome(): Promise<void> {
  const { future } = useHomeHistory.getState();
  const old = future[future.length - 1];
  if (!old) return;
  const live = liveReviewOf(old.project.doc);
  if (live && hooks.closeLink) {
    try {
      await hooks.closeLink(live);
    } catch (e) {
      useUi.getState().toast({ message: `Projet « ${old.project.title} » gardé : ${(e as Error).message}` });
      return;
    }
  }
  // Le projet a pu changer depuis sa restauration : on garde son état actuel pour pouvoir annuler.
  const snap = (await snapshotProject(old.project.id)) ?? old;
  dropPendingSave(old.project.id);
  await deleteProject(old.project.id);
  announceDeleted(old.project.id);
  useHomeHistory.setState((s) => ({ future: s.future.slice(0, -1), past: [...s.past, snap], rev: s.rev + 1 }));
  announceProjects(old.project.id);
  hooks.removed?.(old.project.id);
}
