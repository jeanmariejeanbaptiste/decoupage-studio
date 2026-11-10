/**
 * Image importée (storyboard, inspecteur) : réduite si elle est très grande, puis rangée dans le
 * navigateur. Un échec de stockage est signalé une fois ; rien n'est alors modifié dans le projet.
 */
import { downscaleSize } from '../../domain/keyframes';
import { putBlob } from '../../store/db';
import { useUi } from '../../store/uiStore';

/** En dessous de ce poids, l'image est gardée telle quelle. */
const SMALL = 600 * 1024;

async function shrink(file: File): Promise<Blob> {
  // Vectoriel, animation ou petit fichier : rien à gagner.
  if (file.size < SMALL || /svg|gif/.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // naturalWidth / naturalHeight tiennent compte de l'orientation EXIF, comme le dessin sur le canevas.
    const size = downscaleSize(img.naturalWidth, img.naturalHeight);
    if (!size) return file;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, size.width, size.height);
    // Photo : JPEG ; autre image (transparence possible) : PNG.
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85));
    return out && out.size < file.size ? out : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const QUOTA = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];

/** Stockage plein (Chrome, Safari : QuotaExceededError ; Firefox : NS_ERROR_DOM_QUOTA_REACHED), éventuellement enveloppé par Dexie. */
export function isQuota(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return QUOTA.includes(err?.name ?? '') || QUOTA.includes(err?.inner?.name ?? '');
}

/** Range l'image et renvoie sa clé, ou `undefined` (message affiché) si le navigateur la refuse. */
export async function storeImage(projectId: string, file: File): Promise<string | undefined> {
  let blob: Blob = file;
  try {
    blob = await shrink(file);
  } catch {
    // Image que le navigateur ne sait pas réduire : gardée telle quelle.
  }
  try {
    return await putBlob(projectId, file.name, blob);
  } catch (e) {
    useUi.getState().toast({
      message: isQuota(e) ? 'Stockage du navigateur plein : image non ajoutée.' : 'Image non ajoutée : le navigateur n’a pas pu l’enregistrer.',
      tone: 'warn',
    });
    return undefined;
  }
}
