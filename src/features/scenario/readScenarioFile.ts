import { linesToFountain, stripMarkdown, textToLines, type SourceLine } from '../../domain/scenarioImport';

/** Lignes d'un PDF avec leur position (retrait, centrage, espacement). */
async function pdfLines(buf: ArrayBuffer): Promise<SourceLine[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const out: SourceLine[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const width = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    const rows = new Map<number, { x0: number; x1: number; parts: Array<{ x: number; s: string }> }>();
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2;
      const x = it.transform[4] as number;
      const row = rows.get(y) ?? { x0: x, x1: x, parts: [] as Array<{ x: number; s: string }> };
      row.x0 = Math.min(row.x0, x);
      row.x1 = Math.max(row.x1, x + it.width);
      row.parts.push({ x, s: it.str });
      rows.set(y, row);
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    const gaps = ys.slice(1).map((y, i) => ys[i] - y).sort((a, b) => a - b);
    const lineH = gaps[Math.floor(gaps.length / 2)] ?? 14;
    ys.forEach((y, i) => {
      const r = rows.get(y)!;
      const text = r.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(' ').replace(/\s+/g, ' ').trim();
      const mid = (r.x0 + r.x1) / 2;
      const w = r.x1 - r.x0;
      out.push({
        text,
        x0: r.x0 / width,
        center: Math.abs(mid - width / 2) < width * 0.05 && w < width * 0.5 && r.x0 > width * 0.25,
        gapBefore: i === 0 || ys[i - 1] - y > lineH * 1.5,
      });
    });
  }
  return out;
}

/** Paragraphes d'un .docx (alignement centré, retrait gauche). */
async function docxLines(buf: ArrayBuffer): Promise<SourceLine[]> {
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Document Word illisible.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out: SourceLine[] = [];
  let gap = true;
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const text = Array.from(p.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('');
    if (!text.trim()) {
      gap = true;
      continue;
    }
    const jc = p.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val');
    const ind = p.getElementsByTagNameNS(W, 'ind')[0];
    const left = Number(ind?.getAttributeNS(W, 'left') ?? ind?.getAttributeNS(W, 'start') ?? 0) || 0;
    out.push({ text: text.trim(), center: jc === 'center', x0: Math.min(0.7, left / 9600), gapBefore: gap });
    gap = false;
  }
  return out;
}

/** Lit un scénario (PDF, Word, Markdown, texte ou Fountain) et le convertit en Fountain. */
export async function readScenarioFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.fountain') || name.endsWith('.spmd')) return file.text();
  if (name.endsWith('.pdf')) return linesToFountain(await pdfLines(await file.arrayBuffer()));
  if (name.endsWith('.docx')) return linesToFountain(await docxLines(await file.arrayBuffer()));
  if (name.endsWith('.doc')) throw new Error('Format .doc ancien : enregistrez-le en .docx ou en PDF.');
  const text = await file.text();
  return linesToFountain(textToLines(name.endsWith('.md') || name.endsWith('.markdown') ? stripMarkdown(text) : text));
}
