/**
 * Image ajoutée à la note : réduite si elle est très grande (le projet, ses exports et sa
 * synchronisation restent légers), puis rangée dans le projet. Un échec de stockage est signalé.
 */
import { shrunkImageSize } from '../../domain/richText';
import { putBlob } from '../../store/db';
import { useUi } from '../../store/uiStore';

/** Image réduite à NOTE_IMAGE_MAX_PX au plus grand côté (WebP, transparence gardée) ; l'originale si rien à gagner. */
export async function shrinkImage(file: Blob): Promise<Blob> {
  // Vectoriel ou animé : gardé tel quel.
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const size = shrunkImageSize(bmp.width, bmp.height);
    if (!size) return file;
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, size.w, size.h);
    const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', 0.85));
    return out && out.size < file.size ? out : file;
  } finally {
    bmp.close();
  }
}

/** Range l'image dans le projet ; null (et un message) si le stockage du navigateur la refuse. */
export async function storeNoteImage(projectId: string, file: File): Promise<string | null> {
  try {
    return await putBlob(projectId, file.name || 'image', await shrinkImage(file));
  } catch (e) {
    // Dexie enveloppe parfois l'erreur du navigateur (`inner`).
    const err = e as { name?: string; inner?: { name?: string } } | undefined;
    const full = /quota/i.test(`${err?.name ?? ''} ${err?.inner?.name ?? ''}`);
    useUi.getState().toast({ message: full ? 'Stockage du navigateur plein : image non ajoutée.' : 'Image non ajoutée : le navigateur n’a pas pu l’enregistrer.', tone: 'warn' });
    return null;
  }
}
