import { parseProjectFile, serializeDoc, fileNameFor, FILE_EXTENSION } from '../domain/serialize';
import type { ProjectDoc } from '../domain/types';
import { loadProject, saveProject } from './db';
import { useProjectStore } from './projectStore';
import { useUi } from './uiStore';

const LAST_KEY = 'ds-last-project';
export const AUTOSAVE_DELAY = 600;

export function rememberLastProject(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** Ouvre un projet stocké dans le navigateur. */
export async function openStoredProject(id: string): Promise<boolean> {
  const doc = await loadProject(id);
  if (!doc) return false;
  useProjectStore.getState().loadDoc(doc);
  rememberLastProject(id);
  useUi.getState().set({ saveStatus: 'saved', selection: null, editing: null });
  return true;
}

/** Ouvre un projet en mémoire et l'enregistre immédiatement. */
export async function openDoc(doc: ProjectDoc): Promise<void> {
  useProjectStore.getState().loadDoc(doc);
  rememberLastProject(doc.project.id);
  useUi.getState().set({ selection: null, editing: null });
  await flushSave();
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: ProjectDoc | null = null;

export async function flushSave(): Promise<void> {
  clearTimeout(timer);
  const doc = pending ?? useProjectStore.getState().doc;
  pending = null;
  if (!doc) return;
  useUi.getState().set({ saveStatus: 'saving' });
  try {
    await saveProject(doc);
    useUi.getState().set({ saveStatus: 'saved' });
  } catch (e) {
    console.error(e);
    useUi.getState().set({ saveStatus: 'error' });
  }
}

/** Sauvegarde automatique (débounce 600 ms) de chaque modification du projet. */
export function startAutosave(): () => void {
  const unsub = useProjectStore.subscribe((state, prev) => {
    if (!state.doc || state.doc === prev.doc) return;
    pending = state.doc;
    useUi.getState().set({ saveStatus: 'dirty' });
    clearTimeout(timer);
    timer = setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
  });
  const onHide = () => {
    if (pending) void flushSave();
  };
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
  };
}

// --- Fichiers .decoupage -------------------------------------------------------------------

interface FilePickerWindow {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  showOpenFilePicker?: (o: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
}

const pickerTypes = [{ description: 'Projet Découpage Studio', accept: { 'application/json': [FILE_EXTENSION, '.json'] } }];

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ⌘S : enregistre le projet dans un fichier `.decoupage`. */
export async function saveToFile(): Promise<void> {
  const doc = useProjectStore.getState().doc;
  if (!doc) return;
  await flushSave();
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
  const name = fileNameFor(doc);
  const w = window as unknown as FilePickerWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: pickerTypes });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      useUi.getState().toast({ message: `Projet enregistré dans ${name}` });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  downloadBlob(blob, name);
  useUi.getState().toast({ message: `Fichier ${name} téléchargé.` });
}

function pickFileFallback(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function pickFile(accept: string, useNative = true): Promise<File | null> {
  const w = window as unknown as FilePickerWindow;
  if (useNative && w.showOpenFilePicker && accept.includes(FILE_EXTENSION)) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: pickerTypes, multiple: false });
      return handle ? await handle.getFile() : null;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  return pickFileFallback(accept);
}

/** Ouvre un fichier `.decoupage` / JSON. */
export async function openFromFile(file?: File | null): Promise<boolean> {
  const f = file ?? (await pickFile(`${FILE_EXTENSION},.json,application/json`));
  if (!f) return false;
  try {
    const doc = parseProjectFile(await f.text());
    await openDoc(doc);
    useUi.getState().toast({ message: `Projet « ${doc.project.title} » ouvert.` });
    return true;
  } catch (e) {
    useUi.getState().toast({ message: (e as Error).message, tone: 'warn' });
    return false;
  }
}
