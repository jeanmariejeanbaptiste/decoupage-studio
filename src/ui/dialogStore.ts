import { create } from 'zustand';

export interface DialogRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  checkbox?: string;
}

interface DialogState {
  current: (DialogRequest & { resolve: (r: { ok: boolean; checked: boolean }) => void }) | null;
  ask: (req: DialogRequest) => Promise<{ ok: boolean; checked: boolean }>;
  close: (ok: boolean, checked: boolean) => void;
}

export const useDialog = create<DialogState>()((set, get) => ({
  current: null,
  ask: (req) =>
    new Promise((resolve) => {
      get().current?.resolve({ ok: false, checked: false });
      set({ current: { ...req, resolve } });
    }),
  close: (ok, checked) => {
    get().current?.resolve({ ok, checked });
    set({ current: null });
  },
}));

export const ask = (req: DialogRequest) => useDialog.getState().ask(req);
