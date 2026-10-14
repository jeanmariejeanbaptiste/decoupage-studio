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
}

export interface MenuItem {
  label: string;
  action: () => void;
}

export interface UiState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  selection: { anchor: CellPos; focus: CellPos } | null;
  editing: { pos: CellPos; initial?: string } | null;
  toasts: Toast[];
  theme: 'papier' | 'encre';
  printView: boolean;
  inspectorOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  saveStatus: 'saved' | 'saving' | 'dirty' | 'error' | 'idle';
  skipCrossSequenceConfirm: boolean;
  highlightShotId: ID | null;
  setSelection: (anchor: CellPos | null, focus?: CellPos) => void;
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
  editing: null,
  toasts: [],
  theme: initialTheme(),
  printView: false,
  inspectorOpen: typeof window !== 'undefined' && window.innerWidth >= 1600,
  paletteOpen: false,
  helpOpen: false,
  saveStatus: 'idle',
  skipCrossSequenceConfirm: false,
  highlightShotId: null,
  setSelection: (anchor, focus) => set({ selection: anchor ? { anchor, focus: focus ?? anchor } : null }),
  setEditing: (editing) => set({ editing }),
  toast: (t) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 6000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  set: (p) => set(p),
}));
