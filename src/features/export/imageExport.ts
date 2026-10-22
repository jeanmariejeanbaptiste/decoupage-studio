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
  // Safari omet les images d'URL « blob: » et celles pas encore décodées dans la capture :
  // on les intègre en données, puis on fait une première passe de préchauffage par page.
  await inlineImages(pages);
  const canvases: HTMLCanvasElement[] = [];
  for (const node of pages) {
    const o = { pixelRatio: 3, backgroundColor: background, filter: clean, width: node.offsetWidth, height: node.offsetHeight };
    if (node.querySelector('img')) await toCanvas(node, { ...o, pixelRatio: 0.2 });
    const canvas = await toCanvas(node, o);
    drawImagesOver(canvas, node, o.pixelRatio);
    canvases.push(canvas);
  }
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
      // Taille de l'image : celle déclarée, sinon la viewBox (Safari renvoie 0 pour un SVG sans taille).
      const vb = /viewBox="[^"]*?([\d.]+)\s+([\d.]+)"/.exec(svg);
      const iw = img.naturalWidth || Number(vb?.[1]) || W;
      const ih = img.naturalHeight || Number(vb?.[2]) || H;
      const k = Math.min((W - 2 * margin) / iw, (H - 2 * margin) / ih);
      ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
      canvases.push(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  await finish(canvases, base, opts);
}

/** Numérote, puis enregistre en PDF (assemblé ici, sans le module d'impression) ou en images. */
export async function finish(canvases: HTMLCanvasElement[], base: string, opts: PageExportOptions): Promise<void> {
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

/**
 * Document mis en page (dépouillement, plan de travail, feuille de service…) découpé en pages A4 :
 * rendu dans un cadre invisible à la largeur du papier, puis coupé entre deux lignes ou blocs,
 * jamais au milieu, avec des marges de 13 mm.
 */
export async function exportDocumentPages(html: string, base: string, opts: PageExportOptions): Promise<void> {
  const { w, h } = a4(opts.orientation);
  const px = 96 / 25.4;
  // Rendu dans la page elle-même (hors écran), styles du document confinés à un conteneur :
  // les polices de l'application s'appliquent et la capture reste fidèle.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const css = [...parsed.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  const host = document.createElement('div');
  host.className = 'docroot';
  host.style.cssText = `width:${Math.round(w * px)}px;background:#fff;`;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-30000px;top:0;';
  wrap.appendChild(host);
  const style = document.createElement('style');
  style.textContent = scopeCss(css, '.docroot');
  host.appendChild(style);
  host.insertAdjacentHTML('beforeend', parsed.body.innerHTML);
  document.body.appendChild(wrap);
  try {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const d = host;
    const body = host;
    const top = body.getBoundingClientRect().top;
    const rel = (e: Element) => e.getBoundingClientRect();
    const pads = [...d.querySelectorAll('.pad')];
    const start0 = pads[0] ? rel(pads[0]).bottom - top : 0;
    const end = pads.length > 1 ? rel(pads[pads.length - 1]).top - top : body.scrollHeight;
    const margin = 13 * px;
    const pageH = h * px - 2 * margin;
    const bottoms = [...d.querySelectorAll('tr, h1, h2, h3, p, li, header, .block, .day, .plan, .grid > *, svg, img')]
      .map((e) => rel(e).bottom - top)
      .sort((a, b) => a - b);
    const forced = [...d.querySelectorAll('.plan')].slice(1).map((e) => rel(e).top - top);
    const slices: Array<[number, number]> = [];
    let start = start0;
    while (start < end - 1) {
      const limit = start + pageH;
      let cut = limit >= end ? end : Math.max(0, ...bottoms.filter((b) => b > start + 1 && b <= limit));
      if (!cut || cut - start < pageH * 0.25) cut = Math.min(limit, end);
      const brk = forced.find((f) => f > start + 1 && f < cut);
      if (brk) cut = brk;
      slices.push([start, cut]);
      start = cut;
    }
    const { toCanvas } = await import('html-to-image');
    const ratio = 2.5;
    const full = await toCanvas(body, { pixelRatio: ratio, backgroundColor: '#ffffff', width: body.scrollWidth, height: body.scrollHeight });
    const W = Math.round(w * px * ratio);
    const H = Math.round(h * px * ratio);
    const k = full.width / body.scrollWidth;
    const pages = slices.map(([a, b]) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const sc = W / full.width;
      ctx.drawImage(full, 0, a * k, full.width, (b - a) * k, 0, margin * ratio, W, (b - a) * k * sc);
      return c;
    });
    await finish(pages, base, opts);
  } finally {
    wrap.remove();
  }
}

/** Confine une feuille de style simple (sans imbrication) à un conteneur ; `body` devient le conteneur. */
function scopeCss(css: string, root: string): string {
  return css
    .replace(/@page[^{]*\{[^}]*\}/g, '')
    .replace(/([^{}]+)\{/g, (_m, sel: string) =>
      `${sel
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => (x === 'body' || x === 'html' ? root : x === '*' ? `${root}, ${root} *` : `${root} ${x}`))
        .join(', ')} {`,
    );
}

/** Attend que les images (chargées en différé depuis la base locale) soient présentes et décodées. */
export async function waitForImages(root: HTMLElement, expected: number, timeout = 10000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const imgs = [...root.querySelectorAll('img')];
    if ((imgs.length >= expected && imgs.every((i) => i.complete && i.naturalWidth > 0)) || Date.now() - start > timeout) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => undefined)));
}

/** Remplace les images « blob: » par des données intégrées (data URL) et attend leur décodage. */
async function inlineImages(roots: HTMLElement[]): Promise<void> {
  const imgs = roots.flatMap((r) => [...r.querySelectorAll('img')]);
  await Promise.all(
    imgs.map(async (img) => {
      if (img.src.startsWith('blob:')) {
        const blob = await (await fetch(img.src)).blob();
        img.src = await new Promise<string>((ok, ko) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result));
          r.onerror = () => ko(r.error);
          r.readAsDataURL(blob);
        });
      }
      await img.decode().catch(() => undefined);
    }),
  );
}

/**
 * Redessine chaque image directement sur la page rendue, à sa place et en « contain » :
 * filet de sécurité pour les navigateurs qui omettent les images dans la capture (Safari).
 */
function drawImagesOver(canvas: HTMLCanvasElement, node: HTMLElement, ratio: number): void {
  const ctx = canvas.getContext('2d')!;
  const origin = node.getBoundingClientRect();
  for (const img of node.querySelectorAll('img')) {
    if (!img.complete || !img.naturalWidth) continue;
    const box = img.closest<HTMLElement>('[data-fit]');
    if (box) {
      // Image cadrée (storyboard) : même calcul que l'affichage — remplir/ajuster, décalage, rotation, zoom.
      const fr = box.getBoundingClientRect();
      const c = JSON.parse(box.dataset.crop ?? '{}') as { zoom?: number; x?: number; y?: number; rot?: number };
      const fit = box.dataset.fit === 'contain' ? Math.min : Math.max;
      const k = fit(fr.width / img.naturalWidth, fr.height / img.naturalHeight);
      ctx.save();
      ctx.beginPath();
      ctx.rect((fr.left - origin.left) * ratio, (fr.top - origin.top) * ratio, fr.width * ratio, fr.height * ratio);
      ctx.clip();
      ctx.translate((fr.left - origin.left + fr.width / 2 + ((c.x ?? 0) / 100) * fr.width) * ratio, (fr.top - origin.top + fr.height / 2 + ((c.y ?? 0) / 100) * fr.height) * ratio);
      ctx.rotate(((c.rot ?? 0) * Math.PI) / 180);
      ctx.scale(c.zoom ?? 1, c.zoom ?? 1);
      const [w, h] = [img.naturalWidth * k * ratio, img.naturalHeight * k * ratio];
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      continue;
    }
    const r = img.getBoundingClientRect();
    const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    const x = r.left - origin.left + (r.width - w) / 2;
    const y = r.top - origin.top + (r.height - h) / 2;
    ctx.drawImage(img, x * ratio, y * ratio, w * ratio, h * ratio);
  }
  // Les étiquettes posées sur les images (numéro du plan) repassent au premier plan.
  for (const el of node.querySelectorAll<HTMLElement>('[data-label]')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const [x, y, w, h] = [r.left - origin.left, r.top - origin.top, r.width, r.height].map((v) => v * ratio);
    ctx.fillStyle = cs.backgroundColor || '#fff';
    ctx.strokeStyle = cs.borderTopColor || '#ccc';
    ctx.lineWidth = ratio;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3 * ratio);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = cs.color;
    ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * ratio}px ${cs.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(el.textContent ?? '', x + w / 2, y + h / 2);
  }
}
