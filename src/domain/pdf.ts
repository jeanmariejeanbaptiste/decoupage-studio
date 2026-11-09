/** Une page du PDF : une image JPEG pleine page. */
export interface PdfPage {
  jpeg: Uint8Array;
  /** Dimensions de l'image en pixels. */
  width: number;
  height: number;
  /** Liens cliquables (itinéraires…) : rectangles en fraction de la page, origine en haut à gauche. */
  links?: PdfLink[];
}

export interface PdfLink {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
}

/** Chaîne PDF littérale : ASCII seulement (le reste encodé comme dans une URL), parenthèses et barres échappées. */
const pdfString = (s: string) =>
  `(${s
    .replace(/[^\x20-\x7e]/gu, (c) => encodeURIComponent(c))
    .replace(/[\\()]/g, (c) => `\\${c}`)})`;
const httpLink = (l: PdfLink) => /^https?:\/\//i.test(l.url) && [l.x, l.y, l.w, l.h].every(Number.isFinite) && l.w > 0 && l.h > 0;

/** Lien repéré dans un document mis en page (px CSS, depuis le haut du document). */
export interface DocLink {
  left: number;
  top: number;
  width: number;
  height: number;
  url: string;
}

/**
 * Répartit les liens d'un document découpé en tranches (une par page) : chaque lien va à la page qui
 * contient son milieu, en fraction de la page. `contentWidth` (px CSS) remplit la largeur de la page
 * (`pageWidth` × `pageHeight`, mêmes unités), chaque tranche commence sous la marge du haut.
 */
export function sliceLinks(links: readonly DocLink[], slices: ReadonlyArray<readonly [number, number]>, page: { contentWidth: number; pageWidth: number; pageHeight: number; margin: number }): PdfLink[][] {
  const k = page.pageWidth / page.contentWidth;
  return slices.map(([a, b]) =>
    links
      .filter((l) => {
        const mid = l.top + l.height / 2;
        return mid >= a && mid < b;
      })
      .map((l) => {
        const top = Math.max(l.top, a);
        const bottom = Math.min(l.top + l.height, b);
        return { x: (l.left * k) / page.pageWidth, y: (page.margin + (top - a) * k) / page.pageHeight, w: (l.width * k) / page.pageWidth, h: ((bottom - top) * k) / page.pageHeight, url: l.url };
      }),
  );
}

const MM = 72 / 25.4;
const enc = new TextEncoder();

/**
 * Assemble des images JPEG en PDF, une image par page, à bord perdu (sans marge).
 * Les dimensions de page suivent le papier demandé (en mm) ; l'image la remplit exactement.
 */
export function buildPdf(pages: readonly PdfPage[], pageMm: { w: number; h: number }): Uint8Array {
  const W = (pageMm.w * MM).toFixed(2);
  const H = (pageMm.h * MM).toFixed(2);
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: string | Uint8Array) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    size += b.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // 1 : catalogue, 2 : arbre des pages, puis par page : page, contenu, image.
  const pageIds = pages.map((_, i) => 3 + i * 3);
  // Liens : une annotation par lien, numérotées après les pages.
  let next = 3 + pages.length * 3;
  const annots = pages.map((p) => (p.links ?? []).filter(httpLink).map((l) => ({ id: next++, l })));
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const id = pageIds[i];
    const links = annots[i].length ? ` /Annots [${annots[i].map((a) => `${a.id} 0 R`).join(' ')}]` : '';
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R${links} >>`));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const pw = pageMm.w * MM;
  const ph = pageMm.h * MM;
  const f = (v: number) => v.toFixed(2);
  for (const { id, l } of annots.flat()) {
    // Rectangle en points, origine du PDF en bas à gauche.
    const rect = [l.x * pw, ph - (l.y + l.h) * ph, (l.x + l.w) * pw, ph - l.y * ph].map(f).join(' ');
    obj(id, () => push(`<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] /A << /Type /Action /S /URI /URI ${pdfString(l.url)} >> >>`));
  }
  const n = next;
  const xref = size;
  push(`xref\n0 ${n}\n0000000000 65535 f \n`);
  for (let i = 1; i < n; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
