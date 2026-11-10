import { fileNameFor, migrate, serializeDoc, FILE_EXTENSION } from '../../domain/serialize';
import { db } from '../../store/db';
import { collectMedia, downloadBlob, flushEditors, flushSave } from '../../store/persistence';
import { useUi } from '../../store/uiStore';

/** Nom unique dans l'archive : « film.decoupage », puis « film-2.decoupage »… */
export function uniqueName(name: string, taken: Set<string>): string {
  const base = name.endsWith(FILE_EXTENSION) ? name.slice(0, -FILE_EXTENSION.length) : name;
  let out = name;
  for (let i = 2; taken.has(out); i++) out = `${base}-${i}${FILE_EXTENSION}`;
  taken.add(out);
  return out;
}

/** Tous les projets de ce navigateur, chacun en fichier .decoupage autonome (images et sons compris). */
export async function buildBackupZip(): Promise<{ data: Uint8Array; count: number }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const taken = new Set<string>();
  let count = 0;
  for (const row of await db.projects.toArray()) {
    let doc;
    try {
      doc = migrate(row.doc);
    } catch (e) {
      // Projet endommagé : le reste de la sauvegarde passe quand même.
      console.error(e);
      continue;
    }
    zip.file(uniqueName(fileNameFor(doc), taken), serializeDoc(doc, undefined, await collectMedia(doc)));
    count++;
  }
  return { data: await zip.generateAsync({ type: 'uint8array' }), count };
}

/** Commande « Enregistrer tous les projets » : l'archive du jour est téléchargée. */
export async function saveAllToZip(): Promise<void> {
  flushEditors();
  await flushSave();
  try {
    const { data, count } = await buildBackupZip();
    if (!count) return;
    downloadBlob(new Blob([data], { type: 'application/zip' }), `decoupage-studio-${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (e) {
    useUi.getState().toast({ message: (e as Error).message, tone: 'warn' });
  }
}
