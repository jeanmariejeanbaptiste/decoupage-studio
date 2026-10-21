import { useUi } from '../../store/uiStore';
import { downloadBlob } from '../../store/persistence';

/** Éléments exclus de l'image : boutons, champs et tout ce qui est marqué « no-print ». */
const clean = (n: Node) => !(n instanceof HTMLElement && (n.tagName === 'BUTTON' || n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.classList.contains('no-image')));

/**
 * Exporte des pages déjà mises en page (une boîte par page, au format exact du papier) :
 * une image PNG pour une page, sinon un dossier compressé de PNG numérotés dans l'ordre.
 */
export async function pagesToImages(pages: HTMLElement[], base: string, background = '#ffffff'): Promise<number> {
  const { toBlob } = await import('html-to-image');
  await document.fonts.ready;
  const blobs: Blob[] = [];
  for (const node of pages) {
    const blob = await toBlob(node, { pixelRatio: 3, backgroundColor: background, filter: clean, width: node.offsetWidth, height: node.offsetHeight });
    if (blob) blobs.push(blob);
  }
  await saveImages(blobs, base);
  return blobs.length;
}

/** Attend que des pages apparaissent dans un conteneur (pagination calculée après rendu). */
export async function waitForPages(root: HTMLElement, selector: string, timeout = 8000): Promise<HTMLElement[]> {
  const start = Date.now();
  for (;;) {
    const found = [...root.querySelectorAll<HTMLElement>(selector)];
    if (found.length || Date.now() - start > timeout) return found;
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/** Petit menu : format A4 paysage ou portrait. */
export function askOrientation(e: { clientX: number; clientY: number; currentTarget: Element }, pick: (o: 'landscape' | 'portrait') => void): void {
  const r = e.currentTarget.getBoundingClientRect();
  useUi.getState().set({
    menu: {
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: 'Images A4 paysage (une par page)', action: () => pick('landscape') },
        { label: 'Images A4 portrait (une par page)', action: () => pick('portrait') },
      ],
    },
  });
}

/** Chaque SVG devient une page A4 (200 dpi) centrée avec marges ; plusieurs pages → dossier compressé. */
export async function svgPagesToImages(svgs: string[], base: string, orientation: 'landscape' | 'portrait'): Promise<void> {
  const dpmm = 200 / 25.4;
  const [w, h] = orientation === 'portrait' ? [210, 297] : [297, 210];
  const W = Math.round(w * dpmm);
  const H = Math.round(h * dpmm);
  const margin = Math.round(12 * dpmm);
  const blobs: Blob[] = [];
  for (const svg of svgs) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise<void>((ok, ko) => {
        img.onload = () => ok();
        img.onerror = () => ko(new Error('SVG illisible'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const k = Math.min((W - 2 * margin) / img.naturalWidth, (H - 2 * margin) / img.naturalHeight);
      const dw = img.naturalWidth * k;
      const dh = img.naturalHeight * k;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      if (blob) blobs.push(blob);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  await saveImages(blobs, base);
}

async function saveImages(blobs: Blob[], base: string): Promise<void> {
  if (blobs.length === 1) downloadBlob(blobs[0], `${base}.png`);
  else if (blobs.length > 1) {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const folder = zip.folder(base)!;
    blobs.forEach((b, i) => folder.file(`${base}-page-${String(i + 1).padStart(2, '0')}.png`, b));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}.zip`);
  }
}
