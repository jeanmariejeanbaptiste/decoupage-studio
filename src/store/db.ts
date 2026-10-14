import Dexie, { type Table } from 'dexie';
import type { ProjectDoc, ProjectFormat } from '../domain/types';

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
    await db.blobs.where('projectId').equals(id).delete();
  });
}

export async function putBlob(projectId: string, name: string, blob: Blob): Promise<string> {
  const key = `${projectId}:${crypto.randomUUID()}`;
  await db.blobs.put({ key, projectId, name, blob });
  return key;
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db.blobs.get(key))?.blob;
}
