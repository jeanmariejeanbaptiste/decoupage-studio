/**
 * Graphique SVG → image PNG, rendu en clair quel que soit le thème : le dessin est recopié dans
 * un conteneur `.paper-light`, ses styles calculés sont figés sur chaque élément, puis il est
 * peint sur un fond blanc à deux fois sa taille.
 */
import { downloadBlob } from '../../store/persistence';

const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline'] as const;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'graphique';

export async function svgToPng(svg: SVGSVGElement, fileBase: string, scale = 2): Promise<void> {
  const host = document.createElement('div');
  host.className = 'paper-light';
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const vb = svg.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : svg.clientWidth;
    const h = vb && vb.height ? vb.height : svg.clientHeight;
    for (const el of [clone, ...Array.from(clone.querySelectorAll<SVGElement>('*'))]) {
      const cs = getComputedStyle(el);
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) el.style.setProperty(p, v);
      }
      el.removeAttribute('class');
    }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise<void>((ok, ko) => {
        img.onload = () => ok();
        img.onerror = () => ko(new Error('Image illisible'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      if (blob) downloadBlob(blob, `${slug(fileBase)}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    host.remove();
  }
}
