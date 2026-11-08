import { create } from 'zustand';

export interface DialogRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  checkbox?: string;
  /** Troisième choix (ex. « Ouvrir comme copie ») : renvoie `alt: true`. */
  altLabel?: string;
}

export interface DialogResult {
  ok: boolean;
  checked: boolean;
  alt?: boolean;
}

interface DialogState {
  current: (DialogRequest & { resolve: (r: DialogResult) => void }) | null;
  ask: (req: DialogRequest) => Promise<DialogResult>;
  close: (ok: boolean, checked: boolean, alt?: boolean) => void;
}

export const useDialog = create<DialogState>()((set, get) => ({
  current: null,
  ask: (req) =>
    new Promise((resolve) => {
      get().current?.resolve({ ok: false, checked: false });
      set({ current: { ...req, resolve } });
    }),
  close: (ok, checked, alt) => {
    get().current?.resolve({ ok, checked, alt });
    set({ current: null });
  },
}));

export const ask = (req: DialogRequest) => useDialog.getState().ask(req);
