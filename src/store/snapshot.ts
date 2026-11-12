import { packJson, unpackJson } from '../domain/linkPayload';
import { parseProjectFile, withoutReview } from '../domain/serialize';
import type { ProjectDoc } from '../domain/types';
import { useProjectStore } from './projectStore';
import { enterSnapshot } from './share';

/** Au-delà, certaines messageries coupent le lien. */
export const SNAPSHOT_SOFT_LIMIT = 60000;

interface Snapshot {
  v: 1;
  by: string;
  doc: ProjectDoc;
}

/** Lien autonome du projet : la version courante, sans les autres versions ni la relecture en ligne. */
export async function snapshotLink(doc: ProjectDoc): Promise<string> {
  const lite: ProjectDoc = { ...withoutReview(doc), versions: undefined };
  const data = await packJson({ v: 1, by: doc.project.director || '', doc: lite } satisfies Snapshot);
  return `${window.location.origin}${window.location.pathname}#/view/${data}`;
}

/** Ouvre un lien autonome. Renvoie un message d'erreur, ou `null` si le projet est ouvert. */
export async function openSnapshot(data: string): Promise<string | null> {
  try {
    const snap = await unpackJson<Snapshot>(data);
    const doc = parseProjectFile(JSON.stringify(snap.doc));
    enterSnapshot(snap.by || 'l’auteur');
    useProjectStore.getState().loadDoc(doc);
    return null;
  } catch {
    return 'Ce lien est incomplet ou abîmé : demandez-en un nouveau.';
  }
}
