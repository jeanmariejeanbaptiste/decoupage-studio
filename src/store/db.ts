import Dexie, { type Table } from 'dexie';
import type { ProjectDoc, ProjectFormat } from '../domain/types';
import { sharedMediaOwners } from '../domain/serialize';

export interface StoredProject {
  id: string;
  title: string;
  format: ProjectFormat;
  version: string;
  updatedAt: string;
  sequences: number;
  shots: number;
  doc: ProjectDoc;
}

export interface StoredBlob {
  key: string;
  projectId: string;
  name: string;
  blob: Blob;
}

class DecoupageDB extends Dexie {
  projects!: Table<StoredProject, string>;
  blobs!: Table<StoredBlob, string>;
  constructor() {
    super('decoupage-studio');
    this.version(1).stores({ projects: 'id, updatedAt', blobs: 'key, projectId' });
  }
}

export const db = new DecoupageDB();

export type ProjectSummary = Omit<StoredProject, 'doc'>;

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await db.projects.orderBy('updatedAt').reverse().toArray();
  return all.map((p) => ({ id: p.id, title: p.title, format: p.format, version: p.version, updatedAt: p.updatedAt, sequences: p.sequences, shots: p.shots }));
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  await db.projects.put({
    id: doc.project.id,
    title: doc.project.title,
    format: doc.project.format,
    version: doc.project.version,
    updatedAt: doc.project.updatedAt,
    sequences: doc.project.sequenceIds.length,
    shots: Object.keys(doc.shots).length,
    doc,
  });
}

export async function loadProject(id: string): Promise<ProjectDoc | undefined> {
  return (await db.projects.get(id))?.doc;
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.blobs, async () => {
    await db.projects.delete(id);
    // Une copie (fichier ouvert en copie, partage) peut garder les clés de l'original : ses médias
    // changent de propriétaire au lieu d'être effacés.
    const keys = (await db.blobs.where('projectId').equals(id).primaryKeys()) as string[];
    if (!keys.length) return;
    const others = (await db.projects.toArray()).map((p) => p.doc);
    const owners = sharedMediaOwners(keys, others);
    for (const [key, projectId] of owners) await db.blobs.update(key, { projectId });
    const dead = keys.filter((k) => !owners.has(k));
    if (dead.length) await db.blobs.bulkDelete(dead);
  });
}

export async function putBlob(projectId: string, name: string, blob: Blob): Promise<string> {
  const key = `${projectId}:${crypto.randomUUID()}`;
  await db.blobs.put({ key, projectId, name, blob });
  return key;
}

/** Source de secours des images (partage) : les autres participants. */
let remoteBlobSource: ((key: string) => Promise<Blob | undefined>) | null = null;
export const setRemoteBlobSource = (src: typeof remoteBlobSource) => void (remoteBlobSource = src);

export async function getBlob(key: string, remote = true): Promise<Blob | undefined> {
  const local = (await db.blobs.get(key))?.blob;
  if (local || !remote || !remoteBlobSource) return local;
  return remoteBlobSource(key);
}

/** Enregistre une image reçue sous sa clé d'origine. */
export async function putBlobRaw(key: string, projectId: string, blob: Blob): Promise<void> {
  await db.blobs.put({ key, projectId, name: key, blob });
}

/** Projet complet (fiche + images), pour annuler une suppression. */
export interface ProjectSnapshot {
  project: StoredProject;
  blobs: StoredBlob[];
}

export async function snapshotProject(id: string): Promise<ProjectSnapshot | undefined> {
  const project = await db.projects.get(id);
  if (!project) return undefined;
  return { project, blobs: await db.blobs.where('projectId').equals(id).toArray() };
}

export async function restoreProject(snap: ProjectSnapshot): Promise<void> {
  await db.transaction('rw', db.projects, db.blobs, async () => {
    await db.projects.put(snap.project);
    await db.blobs.bulkPut(snap.blobs);
  });
}
