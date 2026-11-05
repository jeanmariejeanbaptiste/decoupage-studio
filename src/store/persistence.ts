import { parseProjectFile, serializeDoc, fileNameFor, FILE_EXTENSION } from '../domain/serialize';
import { activeColumns } from '../domain/columns';
import { normalizeTiming } from '../domain/factory';
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
  // Les projets créés avant le mode « durée de chaque plan » y passent, sauf choix explicite.
  if (doc.project.settings.tcMode === 'cumulatif' && !doc.project.settings.tcModeChosen) doc.project.settings.tcMode = 'duree';
  // Minutage toujours cohérent avec le format (piste pour un clip, jamais pour une fiction…).
  normalizeTiming(doc);
  // Colonnes retirées (Personnages, Lumière, Machinerie, Durée) : plus affichées ni exportées.
  doc.project.settings.gridColumns = activeColumns(doc.project.settings.gridColumns);
  doc.project.settings.exportColumns = activeColumns(doc.project.settings.exportColumns);
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
/** Garde de l'enregistrement (invité d'un partage sans copie autorisée) : `false` = ne rien enregistrer. */
let persistGuard: (() => boolean) | null = null;
export const setPersistGuard = (g: (() => boolean) | null) => void (persistGuard = g);

export function startAutosave(): () => void {
  const unsub = useProjectStore.subscribe((state, prev) => {
    if (!state.doc || state.doc === prev.doc || (persistGuard && !persistGuard())) return;
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
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  // Safari lit le fichier après coup : l'adresse temporaire reste valable une minute.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
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
    return true;
  } catch (e) {
    useUi.getState().toast({ message: (e as Error).message, tone: 'warn' });
    return false;
  }
}
