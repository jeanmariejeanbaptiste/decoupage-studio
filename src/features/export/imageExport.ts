import { buildPdf, type PdfPage } from '../../domain/pdf';
import { downloadBlob } from '../../store/persistence';

export type Orientation = 'landscape' | 'portrait';
export interface PageExportOptions {
  /** PDF assemblé par l'outil, ou images PNG (dossier compressé si plusieurs pages). */
  format: 'pdf' | 'images';
  orientation: Orientation;
  /** Numéro « n / total » en petit, en bas à droite. */
  numbers: boolean;
}

/** Éléments exclus de l'image : boutons, champs et tout ce qui est marqué « no-image ». */
const clean = (n: Node) => !(n instanceof HTMLElement && (n.tagName === 'BUTTON' || n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.classList.contains('no-image')));

export const a4 = (o: Orientation) => (o === 'portrait' ? { w: 210, h: 297 } : { w: 297, h: 210 });

/** Rend des pages déjà mises en page (une boîte par page, au format exact du papier). */
export async function exportNodePages(pages: HTMLElement[], base: string, opts: PageExportOptions, background = '#ffffff'): Promise<number> {
  const { toCanvas } = await import('html-to-image');
  await document.fonts.ready;
  const canvases: HTMLCanvasElement[] = [];
  for (const node of pages) canvases.push(await toCanvas(node, { pixelRatio: 3, backgroundColor: background, filter: clean, width: node.offsetWidth, height: node.offsetHeight }));
  await finish(canvases, base, opts);
  return canvases.length;
}

/** Chaque SVG devient une page A4 (200 dpi), centrée avec marges. */
export async function exportSvgPages(svgs: string[], base: string, opts: PageExportOptions): Promise<void> {
  const dpmm = 200 / 25.4;
  const { w, h } = a4(opts.orientation);
  const W = Math.round(w * dpmm);
  const H = Math.round(h * dpmm);
  const margin = Math.round(12 * dpmm);
  const canvases: HTMLCanvasElement[] = [];
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
      ctx.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      canvases.push(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  await finish(canvases, base, opts);
}

/** Numérote, puis enregistre en PDF (assemblé ici, sans le module d'impression) ou en images. */
async function finish(canvases: HTMLCanvasElement[], base: string, opts: PageExportOptions): Promise<void> {
  if (!canvases.length) return;
  if (opts.numbers)
    canvases.forEach((c, i) => {
      const ctx = c.getContext('2d')!;
      const mm = c.width / a4(opts.orientation).w;
      ctx.font = `${Math.round(2.8 * mm)}px "Barlow Semi Condensed", "Helvetica Neue", sans-serif`;
      ctx.fillStyle = '#555';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${i + 1} / ${canvases.length}`, c.width - 6 * mm, c.height - 4.5 * mm);
    });
  const blob = (c: HTMLCanvasElement, type: string) => new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('Rendu impossible'))), type, 0.92));
  if (opts.format === 'pdf') {
    const pages: PdfPage[] = [];
    for (const c of canvases) pages.push({ jpeg: new Uint8Array(await (await blob(c, 'image/jpeg')).arrayBuffer()), width: c.width, height: c.height });
    downloadBlob(new Blob([buildPdf(pages, a4(opts.orientation))], { type: 'application/pdf' }), `${base}.pdf`);
    return;
  }
  const blobs: Blob[] = [];
  for (const c of canvases) blobs.push(await blob(c, 'image/png'));
  if (blobs.length === 1) return downloadBlob(blobs[0], `${base}.png`);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = zip.folder(base)!;
  blobs.forEach((b, i) => folder.file(`${base}-page-${String(i + 1).padStart(2, '0')}.png`, b));
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}.zip`);
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
