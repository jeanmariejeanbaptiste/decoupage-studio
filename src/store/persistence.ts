import { mediaKeys, mediaOfFile, migrate, parseProjectFile, serializeDoc, fileNameFor, FILE_EXTENSION, type MediaEntry } from '../domain/serialize';
import { newId } from '../domain/factory';
import type { ProjectDoc } from '../domain/types';
import { ask } from '../ui/dialogStore';
import { db, getBlob, loadProject, putBlobRaw, saveProject } from './db';
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

// --- Éditeurs en cours de frappe : vidés avant d'enregistrer, d'exporter ou de changer de projet ---

const flushers = new Set<() => void>();
/** Un éditeur (scénario, note d'intention…) déclare de quoi appliquer sa saisie en attente. */
export function registerFlush(fn: () => void): () => void {
  flushers.add(fn);
  return () => void flushers.delete(fn);
}
/** Applique au projet toute saisie encore en attente dans un éditeur. */
export function flushEditors(): void {
  for (const fn of [...flushers]) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

/** Ouvre un projet stocké dans le navigateur (même remise en ordre qu'un fichier ouvert). */
export async function openStoredProject(id: string): Promise<boolean> {
  flushEditors();
  await flushSave();
  const stored = await loadProject(id);
  if (!stored) return false;
  let doc: ProjectDoc;
  try {
    doc = migrate(stored);
  } catch (e) {
    console.error(e);
    useUi.getState().toast({ message: 'Ce projet est endommagé et n’a pas pu être ouvert.', tone: 'warn' });
    return false;
  }
  useProjectStore.getState().loadDoc(doc);
  rememberLastProject(id);
  useUi.getState().set({ saveStatus: 'saved', selection: null, editing: null });
  return true;
}

/** Ouvre un projet en mémoire et l'enregistre immédiatement. */
export async function openDoc(doc: ProjectDoc): Promise<void> {
  flushEditors();
  await flushSave();
  useProjectStore.getState().loadDoc(doc);
  rememberLastProject(doc.project.id);
  useUi.getState().set({ selection: null, editing: null });
  await flushSave();
}

/** Projet supprimé : son enregistrement en attente ne doit pas le faire revenir. */
export function dropPendingSave(projectId: string): void {
  if (pending?.project.id === projectId) {
    clearTimeout(timer);
    pending = null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: ProjectDoc | null = null;

export async function flushSave(): Promise<void> {
  clearTimeout(timer);
  const doc = pending ?? useProjectStore.getState().doc;
  pending = null;
  if (!doc || (persistGuard && !persistGuard())) return;
  useUi.getState().set({ saveStatus: 'saving' });
  try {
    await saveProject(doc);
    useUi.getState().set({ saveStatus: 'saved' });
    announce(doc);
  } catch (e) {
    console.error(e);
    useUi.getState().set({ saveStatus: 'error' });
  }
}

// --- Plusieurs onglets sur le même projet : le plus récent l'emporte sans écraser l'autre ---

const TAB = newId();
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ds-projects') : null;
function announce(doc: ProjectDoc) {
  channel?.postMessage({ id: doc.project.id, updatedAt: doc.project.updatedAt, tab: TAB });
}
channel?.addEventListener('message', (e: MessageEvent<{ id: string; updatedAt: string; tab: string }>) => {
  const m = e.data;
  const cur = useProjectStore.getState().doc;
  if (!m || m.tab === TAB || !cur || cur.project.id !== m.id || m.updatedAt <= cur.project.updatedAt) return;
  // Modifié dans un autre onglet : sans saisie en attente ici, on reprend la version enregistrée.
  if (!pending) void openStoredProject(m.id);
  else
    useUi.getState().toast({
      message: 'Ce projet a été modifié dans un autre onglet.',
      actionLabel: 'Recharger',
      action: () => {
        pending = null;
        void openStoredProject(m.id);
      },
      duration: 20000,
    });
});

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

const toBase64 = (blob: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });

/** Médias du projet, en base 64, pour un fichier autonome. */
export async function collectMedia(doc: ProjectDoc): Promise<Record<string, MediaEntry>> {
  const out: Record<string, MediaEntry> = {};
  for (const key of mediaKeys(doc)) {
    const b = await getBlob(key);
    if (b) out[key] = { type: b.type || 'application/octet-stream', data: await toBase64(b) };
  }
  return out;
}

/** Médias d'un fichier ouvert : rangés dans ce navigateur sous leur clé d'origine. */
async function restoreMedia(text: string, projectId: string): Promise<void> {
  for (const [key, m] of Object.entries(mediaOfFile(text))) {
    if (await getBlob(key, false)) continue;
    const bin = atob(m.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await putBlobRaw(key, projectId, new Blob([bytes], { type: m.type }));
  }
}

/** ⌘S : enregistre le projet dans un fichier `.decoupage` (images et piste comprises). */
export async function saveToFile(): Promise<void> {
  flushEditors();
  const doc = useProjectStore.getState().doc;
  if (!doc) return;
  await flushSave();
  const blob = new Blob([serializeDoc(doc, undefined, await collectMedia(doc))], { type: 'application/json' });
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
    const text = await f.text();
    let doc = parseProjectFile(text);
    // Même projet déjà présent ici, et plus récent : on demande avant de le remplacer.
    const local = await db.projects.get(doc.project.id);
    if (local && local.updatedAt > doc.project.updatedAt) {
      const r = await ask({
        title: `Une version plus récente de « ${local.title} » est dans ce navigateur`,
        body: 'Le fichier ouvert est plus ancien. Le remplacer effacerait les modifications plus récentes.',
        confirmLabel: 'Remplacer',
        altLabel: 'Ouvrir comme copie',
        danger: true,
      });
      if (r.alt) doc = { ...doc, project: { ...doc.project, id: newId(), title: `${doc.project.title} (copie)` } };
      else if (!r.ok) return false;
    }
    await restoreMedia(text, doc.project.id);
    await openDoc(doc);
    return true;
  } catch (e) {
    useUi.getState().toast({ message: (e as Error).message, tone: 'warn' });
    return false;
  }
}
