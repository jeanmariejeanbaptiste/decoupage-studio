/** Une page du PDF : une image JPEG pleine page. */
export interface PdfPage {
  jpeg: Uint8Array;
  /** Dimensions de l'image en pixels. */
  width: number;
  height: number;
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
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const id = pageIds[i];
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const n = 3 + pages.length * 3;
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
