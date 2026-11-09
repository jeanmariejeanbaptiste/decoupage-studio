import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { produce } from 'immer';
import { apply, type Op } from '../domain/patch';
import type { ProjectDoc } from '../domain/types';
import { syncInterviewShots } from '../domain/interview';

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
      mutate: (recipe) => {
        const cur = useProjectStore.getState().doc;
        if (!cur || (mutationGuard && !mutationGuard())) return;
        const next = produce(cur, (d) => {
          recipe(d);
        });
        // Rien n'a changé (saisie refusée, valeur identique) : pas d'étape d'annulation vide.
        if (next === cur) return;
        set({
          doc: produce(next, (d) => {
            // Institutionnel : les plans d'interview suivent la fiche (caméras, intervenant, place).
            syncInterviewShots(d);
            d.project.updatedAt = new Date().toISOString();
          }),
        });
      },
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

/** Annuler / rétablir : sans effet pour un invité en lecture seule. */
export const undo = () => {
  if (canMutate()) useProjectStore.temporal.getState().undo();
};
export const redo = () => {
  if (canMutate()) useProjectStore.temporal.getState().redo();
};

export function useHistory() {
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo };
}

export const useDoc = () => useProjectStore((s) => s.doc);

/**
 * Données tirées d'un service (géocodage des adresses) gardées dans le projet : hors historique
 * d'annulation, et reportées dans les états mémorisés, pour qu'annuler ne les efface jamais.
 */
export function mutateQuiet(recipe: (doc: ProjectDoc) => void): void {
  const cur = useProjectStore.getState().doc;
  if (!cur || !canMutate()) return;
  const next = produce(cur, (d) => void recipe(d));
  if (next === cur) return;
  const t = useProjectStore.temporal.getState();
  t.pause();
  try {
    useProjectStore.setState({ doc: next });
    const patchSnap = <S extends { doc?: ProjectDoc | null }>(list: S[]): S[] => list.map((snap) => (snap.doc ? { ...snap, doc: produce(snap.doc, (d) => void recipe(d)) } : snap));
    useProjectStore.temporal.setState((st) => ({ pastStates: patchSnap(st.pastStates), futureStates: patchSnap(st.futureStates) }));
  } finally {
    t.resume();
  }
}

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
    // Les états mémorisés pour annuler / rétablir reçoivent aussi la modification : annuler ne défait
    // que ses propres changements, jamais ceux des autres participants.
    const patchSnap = <S extends { doc?: ProjectDoc | null }>(list: S[]): S[] =>
      list.map((snap) => (snap.doc ? { ...snap, doc: produce(snap.doc, (d) => void apply(d as unknown as Record<string, unknown>, ops)) } : snap));
    useProjectStore.temporal.setState((st) => ({ pastStates: patchSnap(st.pastStates), futureStates: patchSnap(st.futureStates) }));
  } finally {
    remoteDepth--;
    t.resume();
  }
}
