import { mediaKeys, mediaOfFile, migrate, parseProjectFile, ProjectFileError, projectCopy, serializeDoc, fileNameFor, FILE_EXTENSION, type MediaEntry } from '../domain/serialize';
import { newId } from '../domain/factory';
import type { ProjectDoc } from '../domain/types';
import { ask } from '../ui/dialogStore';
import { db, getBlob, loadProject, putBlobRaw, saveProject } from './db';
import { useProjectStore } from './projectStore';
import { useUi } from './uiStore';
import { navigate } from '../app/router';

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
  if (!(await leaveCurrent(id))) return false;
  return showStored(id);
}

/**
 * Avant de changer de projet : la saisie du projet ouvert est enregistrée. Si l'enregistrement
 * échoue, on reste dessus (alerte maintenue, nouvel essai en cours) : le quitter la perdrait.
 */
async function leaveCurrent(targetId: string): Promise<boolean> {
  flushEditors();
  await flushSave();
  if (!pending || pending.project.id === targetId) return true;
  useUi.getState().toast({ message: `Les dernières modifications de « ${pending.project.title} » ne sont pas encore enregistrées : le projet reste ouvert.`, tone: 'warn' });
  return false;
}

/**
 * Relit le projet ouvert tel qu'il est enregistré (modifié dans un autre onglet, tiré du Drive),
 * sans y réécrire d'abord la version de cet onglet, ce qui effacerait la plus récente.
 */
export async function reloadStoredProject(id: string): Promise<boolean> {
  if (pending?.project.id === id) {
    clearTimeout(timer);
    pending = null;
  }
  return showStored(id);
}

async function showStored(id: string): Promise<boolean> {
  let doc: ProjectDoc;
  try {
    const stored = await loadProject(id);
    if (!stored) return false;
    doc = migrate(stored);
  } catch (e) {
    // Base indisponible (navigation privée, stockage bloqué) ou projet abîmé.
    console.error(e);
    useUi.getState().toast({ message: 'Ce projet est endommagé et n’a pas pu être ouvert.', tone: 'warn' });
    return false;
  }
  useProjectStore.getState().loadDoc(doc);
  // Tel qu'il est enregistré : rien à réécrire.
  if (pending?.project.id === id) {
    clearTimeout(timer);
    pending = null;
  }
  rememberLastProject(id);
  useUi.getState().set({ saveStatus: 'saved', selection: null, editing: null });
  return true;
}

/** Une saisie de ce projet attend encore d'être enregistrée. */
export const hasPendingSave = (projectId: string) => pending?.project.id === projectId;

/** Ouvre un projet en mémoire et l'enregistre immédiatement ; `false` si le projet ouvert n'a pas pu être quitté. */
export async function openDoc(doc: ProjectDoc): Promise<boolean> {
  if (!(await leaveCurrent(doc.project.id))) return false;
  useProjectStore.getState().loadDoc(doc);
  rememberLastProject(doc.project.id);
  useUi.getState().set({ selection: null, editing: null });
  await flushSave();
  return true;
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

/** Enregistrement en attente de ce projet : fait tout de suite (avant de le mettre de côté pour annuler). */
export async function flushPendingSave(projectId: string): Promise<void> {
  if (pending?.project.id === projectId) await flushSave();
}

/** Nouvel essai après un échec d'enregistrement (quota, base fermée) : de plus en plus espacé. */
export const RETRY_DELAYS = [2000, 5000, 15000, 30000] as const;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;
/** Numéro du dernier enregistrement lancé : un enregistrement dépassé ne décide plus de l'état. */
let lastSave = 0;

function scheduleRetry(): void {
  clearTimeout(retryTimer);
  const delay = RETRY_DELAYS[Math.min(retries, RETRY_DELAYS.length - 1)];
  retries += 1;
  retryTimer = setTimeout(() => void (pending && flushSave()), delay);
}

export async function flushSave(): Promise<void> {
  clearTimeout(timer);
  const doc = pending ?? useProjectStore.getState().doc;
  pending = null;
  if (!doc || (persistGuard && !persistGuard())) return;
  const n = ++lastSave;
  // Après un échec, l'alerte reste jusqu'à la première réussite.
  if (useUi.getState().saveStatus !== 'error') useUi.getState().set({ saveStatus: 'saving' });
  try {
    await saveProject(doc);
    if (n === lastSave) {
      clearTimeout(retryTimer);
      retries = 0;
      // Une saisie arrivée pendant l'écriture attend encore : pas d'« Enregistré » trop tôt.
      useUi.getState().set({ saveStatus: pending ? 'dirty' : 'saved' });
    }
    announce(doc);
  } catch (e) {
    console.error(e);
    // Rien n'est perdu : la version la plus récente reste en attente et sera réessayée.
    if (n === lastSave) {
      pending ??= doc;
      useUi.getState().set({ saveStatus: 'error' });
      scheduleRetry();
    }
  }
}

// --- Plusieurs onglets sur le même projet : le plus récent l'emporte sans écraser l'autre ---

type TabMessage = { id: string; updatedAt: string; tab: string; deleted?: boolean };
const TAB = newId();
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ds-projects') : null;
function announce(doc: ProjectDoc) {
  channel?.postMessage({ id: doc.project.id, updatedAt: doc.project.updatedAt, tab: TAB } satisfies TabMessage);
}

/** Projet supprimé ici : un autre onglet qui l'a ouvert ne doit pas le réenregistrer. */
export function announceDeleted(projectId: string): void {
  channel?.postMessage({ id: projectId, updatedAt: new Date().toISOString(), tab: TAB, deleted: true } satisfies TabMessage);
}

/** Message d'un autre onglet (exporté pour les tests). */
export function onTabMessage(m: TabMessage | null | undefined): void {
  const cur = useProjectStore.getState().doc;
  if (!m || m.tab === TAB || !cur || cur.project.id !== m.id) return;
  if (m.deleted) {
    // Supprimé ailleurs : ce projet n'est plus enregistré ici, ni maintenant ni plus tard.
    dropPendingSave(m.id);
    useProjectStore.getState().loadDoc(null);
    rememberLastProject(null);
    useUi.getState().set({ saveStatus: 'idle', selection: null, editing: null });
    navigate('home');
    useUi.getState().toast({ message: 'Ce projet a été supprimé dans un autre onglet.' });
    return;
  }
  if (m.updatedAt <= cur.project.updatedAt) return;
  // Modifié dans un autre onglet : sans saisie en attente ici, on reprend la version enregistrée.
  flushEditors();
  if (!pending) void reloadStoredProject(m.id);
  else
    useUi.getState().toast({
      message: 'Ce projet a été modifié dans un autre onglet.',
      actionLabel: 'Recharger',
      action: () => void reloadStoredProject(m.id),
      duration: 20000,
    });
}
channel?.addEventListener('message', (e: MessageEvent<TabMessage>) => onTabMessage(e.data));

/** Sauvegarde automatique (débounce 600 ms) de chaque modification du projet. */
/** Garde de l'enregistrement (invité d'un partage sans copie autorisée) : `false` = ne rien enregistrer. */
let persistGuard: (() => boolean) | null = null;
export const setPersistGuard = (g: (() => boolean) | null) => void (persistGuard = g);

/**
 * Fermeture de l'onglet après un échec d'enregistrement : le navigateur demande confirmation
 * (pas pendant l'attente ordinaire avant l'enregistrement, qui aboutit à la fermeture).
 */
export function warnUnsaved(e: BeforeUnloadEvent): void {
  if (useUi.getState().saveStatus !== 'error') return;
  e.preventDefault();
  e.returnValue = '';
}

export function startAutosave(): () => void {
  holdTabLock();
  const unsub = useProjectStore.subscribe((state, prev) => {
    if (!state.doc || state.doc === prev.doc || (persistGuard && !persistGuard())) return;
    pending = state.doc;
    if (useUi.getState().saveStatus !== 'error') useUi.getState().set({ saveStatus: 'dirty' });
    clearTimeout(timer);
    timer = setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
  });
  const onHide = () => {
    // Saisie en attente (texte, réglages non validés) appliquée avant la fermeture de l'onglet.
    flushEditors();
    if (pending) void flushSave();
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', warnUnsaved);
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', warnUnsaved);
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

export const blobToBase64 = (blob: Blob) =>
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
    if (b) out[key] = { type: b.type || 'application/octet-stream', data: await blobToBase64(b) };
  }
  return out;
}

/** Médias d'un fichier ouvert : rangés dans ce navigateur sous leur clé d'origine. */
export async function restoreMedia(text: string, projectId: string): Promise<number> {
  // Un média illisible (fichier tronqué, modifié à la main) est passé : le projet s'ouvre quand même.
  let lost = 0;
  for (const [key, m] of Object.entries(mediaOfFile(text))) {
    if (await getBlob(key, false)) continue;
    let blob: Blob;
    try {
      const bin = atob(m.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: m.type });
    } catch {
      lost += 1;
      continue;
    }
    await putBlobRaw(key, projectId, blob);
  }
  return lost;
}

/** ⌘S : enregistre le projet dans un fichier `.decoupage` (images et piste comprises). */
export async function saveToFile(): Promise<void> {
  flushEditors();
  const doc = useProjectStore.getState().doc;
  if (!doc) return;
  await flushSave();
  let blob: Blob;
  try {
    blob = new Blob([serializeDoc(doc, undefined, await collectMedia(doc))], { type: 'application/json' });
  } catch (e) {
    // Médias illisibles (stockage du navigateur indisponible) : dit clairement, jamais en silence.
    console.error(e);
    useUi.getState().toast({ message: 'Le fichier n’a pas pu être préparé : images et sons illisibles dans ce navigateur.', tone: 'warn' });
    return;
  }
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
      if (r.alt) doc = projectCopy(doc, newId());
      else if (!r.ok) return false;
    }
    const lost = await restoreMedia(text, doc.project.id);
    if (!(await openDoc(doc))) return false;
    if (lost) useUi.getState().toast({ message: lost > 1 ? `${lost} médias du fichier n’ont pas pu être relus.` : 'Un média du fichier n’a pas pu être relu.', tone: 'warn' });
    return true;
  } catch (e) {
    // Fichier illisible : son message ; panne du navigateur (stockage indisponible) : jamais de texte technique.
    if (!(e instanceof ProjectFileError)) console.error(e);
    useUi.getState().toast({ message: e instanceof ProjectFileError ? e.message : 'Ce fichier n’a pas pu être ouvert dans ce navigateur.', tone: 'warn' });
    return false;
  }
}

// --- Onglets ouverts : chacun tient un verrou partagé tant qu'il vit -------------------------------

const TABS_LOCK = 'ds-tabs';
interface LockManagerLike {
  request: (name: string, opts: { mode: 'shared' }, cb: () => Promise<void>) => Promise<unknown>;
  query: () => Promise<{ held?: Array<{ name?: string }> }>;
}
const locks = (): LockManagerLike | undefined => (typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: LockManagerLike }).locks : undefined);
let tabLock = false;

/** Cet onglet se déclare ouvert (verrou partagé, libéré par le navigateur à la fermeture). */
export function holdTabLock(): void {
  const l = locks();
  if (!l || tabLock) return;
  tabLock = true;
  void l.request(TABS_LOCK, { mode: 'shared' }, () => new Promise<void>(() => undefined)).catch(() => undefined);
}

/** Un autre onglet de l'application est-il ouvert ? (Sans l'API des verrous : on ne sait pas, donc non.) */
export async function otherTabsOpen(): Promise<boolean> {
  const l = locks();
  if (!l) return false;
  try {
    const { held = [] } = await l.query();
    return held.filter((x) => x.name === TABS_LOCK).length > (tabLock ? 1 : 0);
  } catch {
    return true;
  }
}

/**
 * Images et sons que plus aucun projet n'utilise (remplacés, effacés) : retirés du navigateur.
 * Lancé au démarrage, quand l'historique d'annulation ne peut plus les réclamer ; les états encore
 * annulables du projet ouvert sont tout de même consultés. Jamais quand un autre onglet est ouvert :
 * son historique peut encore rétablir une image remplacée.
 */
export async function pruneOrphanBlobs(): Promise<number> {
  if (await otherTabsOpen()) return 0;
  const keep = new Set<string>();
  for (const p of await db.projects.toArray()) for (const k of mediaKeys(p.doc)) keep.add(k);
  const st = useProjectStore.getState();
  const t = useProjectStore.temporal.getState();
  for (const d of [st.doc, ...t.pastStates.map((s) => s.doc), ...t.futureStates.map((s) => s.doc)]) if (d) for (const k of mediaKeys(d)) keep.add(k);
  const keys = (await db.blobs.toCollection().primaryKeys()) as string[];
  const dead = keys.filter((k) => !keep.has(k));
  if (dead.length) await db.blobs.bulkDelete(dead);
  return dead.length;
}

