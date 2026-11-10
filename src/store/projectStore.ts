import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { produce } from 'immer';
import { apply, type Op } from '../domain/patch';
import type { ProjectDoc } from '../domain/types';
import { syncInterviewShots } from '../domain/interview';
import { syncProduction } from '../domain/production';
import { useUi } from './uiStore';

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
        dropUndoToasts();
        set({
          doc: produce(next, (d) => {
            // Institutionnel : les plans d'interview suivent la fiche (caméras, intervenant, place).
            syncInterviewShots(d);
            // Calendrier de production : l'étape liée suit les jours de tournage datés.
            syncProduction(d);
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

/**
 * Toasts « Annuler » : leur bouton annule la dernière étape. Une autre modification (ou une
 * annulation) les rend faux : ils se ferment, pour ne jamais annuler autre chose que leur action.
 */
function dropUndoToasts(): void {
  const ui = useUi.getState();
  for (const t of ui.toasts) if (t.action === undo) ui.dismissToast(t.id);
}

/** Annuler / rétablir : sans effet pour un invité en lecture seule. */
export const undo = () => {
  if (!canMutate()) return;
  dropUndoToasts();
  const t = useProjectStore.temporal.getState();
  if (!t.pastStates.length) return;
  t.undo();
  touchAfterTravel();
};
export const redo = () => {
  if (!canMutate()) return;
  dropUndoToasts();
  const t = useProjectStore.temporal.getState();
  if (!t.futureStates.length) return;
  t.redo();
  touchAfterTravel();
};

/**
 * Annuler ramène l'état d'avant, date comprise : le projet paraîtrait plus ancien que sa version
 * enregistrée (les autres onglets et le Drive garderaient l'état annulé). La date suit donc l'heure
 * réelle du geste, hors historique.
 */
function touchAfterTravel(): void {
  const doc = useProjectStore.getState().doc;
  if (!doc) return;
  const t = useProjectStore.temporal.getState();
  t.pause();
  try {
    useProjectStore.setState({ doc: produce(doc, (d) => void (d.project.updatedAt = new Date().toISOString())) });
  } finally {
    t.resume();
  }
}

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

/**
 * Modification venue d'ailleurs (retours relevés dans Drive), appliquée hors historique : au projet
 * et à chaque état d'annuler / rétablir, par la même recette (pure, rejouable). Annuler ne défait donc
 * que ses propres changements, et « Rétablir » reste possible. Renvoie `true` si le projet a changé.
 */
export function mutateOutsideHistory(recipe: (doc: ProjectDoc) => void): boolean {
  const cur = useProjectStore.getState().doc;
  if (!cur) return false;
  const next = produce(cur, recipe);
  if (next === cur) return false;
  const t = useProjectStore.temporal.getState();
  t.pause();
  try {
    useProjectStore.setState({ doc: produce(next, (d) => void (d.project.updatedAt = new Date().toISOString())) });
    const replay = <S extends { doc?: ProjectDoc | null }>(list: S[]): S[] => list.map((snap) => (snap.doc ? { ...snap, doc: produce(snap.doc, recipe) } : snap));
    useProjectStore.temporal.setState((st) => ({ pastStates: replay(st.pastStates), futureStates: replay(st.futureStates) }));
  } finally {
    t.resume();
  }
  return true;
}
