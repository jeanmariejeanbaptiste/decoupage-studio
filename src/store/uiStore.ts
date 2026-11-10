import { create } from 'zustand';
import type { ColumnKey, ID } from '../domain/types';

export interface CellPos {
  row: number;
  col: ColumnKey;
}

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
  tone?: 'info' | 'warn';
  /** Durée d'affichage (ms), 6 s par défaut. */
  duration?: number;
}

export interface MenuItem {
  label: string;
  action: () => void;
}

export interface UiState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  /** `auto` : posée d'office à l'arrivée (aucun choix de l'utilisateur) ; elle ne fait pas défiler la grille. */
  selection: { anchor: CellPos; focus: CellPos; auto?: boolean } | null;
  /** Séquence à montrer à l'arrivée sur la grille (lien d'une vérification, d'une autre page…). */
  focusSeq: ID | null;
  editing: { pos: CellPos; initial?: string } | null;
  toasts: Toast[];
  theme: 'papier' | 'encre';
  printView: boolean;
  /** Institutionnel : volet affiché (la fiche d'interview, ou le tableau du découpage). */
  itwTab: 'itw' | 'broll';
  /** Fiche d'interview à ouvrir sur cet intervenant et ce cadre (depuis la bande du découpage). */
  itwFocus: { subjectId: ID; setupId: ID } | null;
  /** Un seul panneau à droite du découpage à la fois : l'inspecteur ou le scénario. */
  rightPanel: 'inspector' | 'scenario' | null;
  sidebarOpen: boolean;
  /** Plan-séquence ouvert dans l'éditeur de chorégraphie. */
  oneShotEditor: ID | null;
  paletteOpen: boolean;
  helpOpen: boolean;
  saveStatus: 'saved' | 'saving' | 'dirty' | 'error' | 'idle';
  skipCrossSequenceConfirm: boolean;
  highlightShotId: ID | null;
  /**
   * Arrivée d'un lien interne (vérifications) dans le découpage : le plan à ouvrir sur téléphone, ou
   * la séquence sans plan à montrer (gardée dans l'aperçu en lecture seule). Effacée en quittant la page.
   */
  cutFocus: { seqId: ID; shotId?: ID } | null;
  setSelection: (anchor: CellPos | null, focus?: CellPos, opts?: { auto?: boolean }) => void;
  setEditing: (e: UiState['editing']) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  set: (p: Partial<UiState>) => void;
}

let toastSeq = 0;

function initialTheme(): 'papier' | 'encre' {
  try {
    return localStorage.getItem('ds-theme') === 'encre' ? 'encre' : 'papier';
  } catch {
    return 'papier';
  }
}

export const useUi = create<UiState>()((set) => ({
  menu: null,
  selection: null,
  focusSeq: null,
  editing: null,
  toasts: [],
  theme: initialTheme(),
  printView: false,
  itwTab: (() => {
    try {
      return localStorage.getItem('ds-itw-tab') === 'broll' ? 'broll' : 'itw';
    } catch {
      return 'itw';
    }
  })(),
  itwFocus: null,
  rightPanel: null,
  oneShotEditor: null,
  sidebarOpen: (() => {
    // Sur téléphone, le menu est un tiroir fermé au départ.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches) return false;
    try {
      return localStorage.getItem('ds-sidebar') !== '0';
    } catch {
      return true;
    }
  })(),
  paletteOpen: false,
  helpOpen: false,
  saveStatus: 'idle',
  skipCrossSequenceConfirm: false,
  highlightShotId: null,
  cutFocus: null,
  setSelection: (anchor, focus, opts) => set({ selection: anchor ? { anchor, focus: focus ?? anchor, ...(opts?.auto ? { auto: true } : {}) } : null }),
  setEditing: (editing) => set({ editing }),
  toast: (t) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.duration ?? 6000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  set: (p) => set(p),
}));

/** Déplie ou réduit le menu latéral (mémorisé sur ordinateur ; sur téléphone, le tiroir se referme à chaque page). */
export function toggleSidebar(open = !useUi.getState().sidebarOpen): void {
  useUi.getState().set({ sidebarOpen: open });
  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches) return;
  try {
    localStorage.setItem('ds-sidebar', open ? '1' : '0');
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}

/** Ouvre la fiche d'interview du découpage sur cet intervenant et ce cadre. */
export function openInterviewFiche(subjectId: ID, setupId: ID): void {
  useUi.getState().set({ itwTab: 'itw', printView: false, editing: null, itwFocus: { subjectId, setupId } });
  try {
    localStorage.setItem('ds-itw-tab', 'itw');
  } catch {
    /* stockage indisponible */
  }
}

