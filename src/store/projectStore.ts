import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { apply, type Op } from '../domain/patch';
import type { ProjectDoc } from '../domain/types';

interface ProjectState {
  doc: ProjectDoc | null;
  /** Remplace le projet courant et vide l'historique. */
  loadDoc: (doc: ProjectDoc | null) => void;
  /** Applique une modification annulable au projet courant. */
  mutate: (recipe: (doc: ProjectDoc) => void) => void;
}

export const HISTORY_LIMIT = 150;

/** Garde des modifications (partage en lecture seule) : `false` bloque toute modification locale. */
let mutationGuard: (() => boolean) | null = null;
export const setMutationGuard = (g: (() => boolean) | null) => void (mutationGuard = g);
export const canMutate = () => !mutationGuard || mutationGuard();

export const useProjectStore = create<ProjectState>()(
  temporal(
    immer((set) => ({
      doc: null,
      loadDoc: (doc) => {
        set((s) => {
          s.doc = doc;
        });
        useProjectStore.temporal.getState().clear();
      },
      mutate: (recipe) =>
        set((s) => {
          if (!s.doc || (mutationGuard && !mutationGuard())) return;
          recipe(s.doc);
          s.doc.project.updatedAt = new Date().toISOString();
        }),
    })),
    {
      limit: HISTORY_LIMIT,
      partialize: (s) => ({ doc: s.doc }),
      equality: (a, b) => a.doc === b.doc,
    },
  ),
);

/** Raccourci : exécute une mutation et renvoie sa valeur de retour. */
export function mutateDoc<T>(recipe: (doc: ProjectDoc) => T): T | undefined {
  let out: T | undefined;
  useProjectStore.getState().mutate((d) => {
    out = recipe(d);
  });
  return out;
}

export const undo = () => useProjectStore.temporal.getState().undo();
export const redo = () => useProjectStore.temporal.getState().redo();

export function useHistory() {
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo };
}

export const useDoc = () => useProjectStore((s) => s.doc);

/** Modifications reçues d'un autre participant : appliquées hors historique d'annulation. */
let remoteDepth = 0;
export const isApplyingRemote = () => remoteDepth > 0;
export function applyRemote(ops: readonly Op[]) {
  const t = useProjectStore.temporal.getState();
  t.pause();
  remoteDepth++;
  try {
    useProjectStore.setState((s) => {
      if (s.doc) apply(s.doc as unknown as Record<string, unknown>, ops);
    });
  } finally {
    remoteDepth--;
    t.resume();
  }
}
