import { fdxToFountain } from '../../domain/fdx';
import { DEMO_WATERMARK } from '../../domain/fountain';
import { linesToFountain, splitLongActions, stripMarkdown, textToLines, type SourceLine } from '../../domain/scenarioImport';

/** Lignes d'un PDF avec leur position (retrait, centrage, espacement). */
async function pdfLines(buf: ArrayBuffer): Promise<SourceLine[]> {
  // Version « legacy » : compatible avec Safari antérieur à 17.4 (Promise.withResolvers).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
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
      // Numéro de page ou de séquence dans la marge de droite, filigrane de version d'essai : hors du texte.
      if (/^\d{1,3}[A-Z]?\.?$/.test(it.str.trim()) && x > width * 0.72) continue;
      if (/demonstration version|version de démonstration|printed with/i.test(it.str)) continue;
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
        page: p,
      });
    });
  }
  return out;
}

/** Style de paragraphe Word : retrait, centrage, espace avant, et nom (« Personnage », « Dialogue »…). */
interface WordStyle {
  left?: number;
  center?: boolean;
  before?: number;
  name: string;
  basedOn?: string;
}

/** Paragraphes d'un .docx : retraits et centrage directs ou hérités des styles, retours à la ligne, tabulations. */
async function docxLines(buf: ArrayBuffer): Promise<SourceLine[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Document Word illisible.');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const attr = (el: Element | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
  const pPrOf = (el: Element) => Array.from(el.children).find((c) => c.localName === 'pPr');
  const child = (el: Element | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);
  // Styles : un scénario Word met souvent la mise en page dans les styles, pas dans le paragraphe.
  const styles = new Map<string, WordStyle>();
  const sxml = await zip.file('word/styles.xml')?.async('string');
  if (sxml) {
    const sdoc = new DOMParser().parseFromString(sxml, 'application/xml');
    for (const st of Array.from(sdoc.getElementsByTagNameNS(W, 'style'))) {
      const id = attr(st, 'styleId');
      if (!id) continue;
      const ppr = child(st, 'pPr');
      const ind = child(ppr, 'ind');
      const left = attr(ind, 'left') ?? attr(ind, 'start');
      const before = attr(child(ppr, 'spacing'), 'before');
      styles.set(id, {
        name: attr(child(st, 'name'), 'val') ?? id,
        basedOn: attr(child(st, 'basedOn'), 'val') ?? undefined,
        left: left !== null ? Number(left) || 0 : undefined,
        center: attr(child(ppr, 'jc'), 'val') === 'center' ? true : undefined,
        before: before !== null ? Number(before) || 0 : undefined,
      });
    }
  }
  const resolve = (id: string | null, depth = 0): WordStyle => {
    const st = id ? styles.get(id) : undefined;
    if (!st || depth > 8) return { name: '' };
    const base = resolve(st.basedOn ?? null, depth + 1);
    return { name: st.name, left: st.left ?? base.left, center: st.center ?? base.center, before: st.before ?? base.before };
  };
  // Nom de style reconnu → retrait type d'un scénario (en fraction de la largeur de page).
  const byName = (name: string): Partial<SourceLine> => {
    const n = name.toLowerCase();
    if (/character|personnage|^nom/.test(n)) return { x0: 0.38 };
    if (/parenth|didascal/.test(n)) return { x0: 0.3 };
    if (/dialog|r[ée]plique/.test(n)) return { x0: 0.22 };
    return {};
  };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: SourceLine[] = [];
  let gap = true;
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let text = '';
    for (const n of Array.from(p.getElementsByTagNameNS(W, '*'))) {
      if (n.localName === 't') text += n.textContent ?? '';
      // Tabulation ou retour posés dans le texte (pas les taquets de tabulation du paragraphe).
      else if (n.localName === 'tab' && n.parentElement?.localName === 'r') text += ' ';
      else if ((n.localName === 'br' || n.localName === 'cr') && n.parentElement?.localName === 'r') text += '\n';
    }
    if (!text.trim()) {
      gap = true;
      continue;
    }
    const ppr = pPrOf(p);
    const style = resolve(attr(child(ppr, 'pStyle'), 'val'));
    const ind = child(ppr, 'ind');
    const directLeft = attr(ind, 'left') ?? attr(ind, 'start');
    const left = directLeft !== null ? Number(directLeft) || 0 : (style.left ?? 0);
    const jc = attr(child(ppr, 'jc'), 'val');
    const before = Number(attr(child(ppr, 'spacing'), 'before') ?? style.before ?? 0) || 0;
    const named = byName(style.name);
    // Un retour à la ligne forcé dans le paragraphe (Maj + Entrée) sépare deux lignes du même bloc.
    text.split('\n').forEach((line, k) => {
      if (!line.trim()) return;
      out.push({
        text: line.trim(),
        center: k === 0 && (jc === 'center' || (jc === null && !!style.center)),
        x0: named.x0 ?? Math.min(0.7, left / 9600),
        gapBefore: k === 0 && (gap || before >= 180),
      });
    });
    gap = false;
  }
  return out;
}

/** Le texte est-il déjà du Fountain (en-têtes, blancs entre paragraphes) ? Alors il est gardé tel quel. */
function looksLikeFountain(text: string): boolean {
  const headings = (text.match(/^(?:\.(?!\.)\S|(?:INT|EXT|EST|I\/E)[./\s])/gim) ?? []).length;
  const blanks = (text.match(/\n\s*\n/g) ?? []).length;
  return headings > 0 && blanks >= Math.max(2, headings);
}

/** Numéros de scène écrits dans les en-têtes (« 12. INT. GARE - JOUR 12 », « #12# ») : l'application numérote elle-même. */
const stripSceneNumbers = (t: string) =>
  t.replace(/^[ \t]*\d+[A-Z]?[.)-]?[ \t]+((?:INT|EXT|EST|I\/E)[.\s/].*?)(?:[ \t]+\d+[A-Z]?\.?)?(?:[ \t]*#[^#\n]*#)?[ \t]*$/gim, '$1').replace(/^((?:INT|EXT|EST|I\/E)[.\s/].*?)[ \t]*#[^#\n]*#[ \t]*$/gim, '$1');
const normalize = (t: string) => splitLongActions(stripSceneNumbers(t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(DEMO_WATERMARK, (m) => (m.endsWith('\n') ? '\n' : ''))));

/** Lit un scénario (Final Draft, Fountain, PDF, Word, Markdown ou texte) et le convertit en Fountain. */
export async function readScenarioFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.fountain') || name.endsWith('.spmd')) return normalize(await file.text());
  // Final Draft : le type de chaque paragraphe est écrit dans le fichier, rien à deviner.
  if (name.endsWith('.fdx')) return normalize(fdxToFountain(await file.text()));
  if (name.endsWith('.pdf')) return normalize(linesToFountain(await pdfLines(await file.arrayBuffer())));
  if (name.endsWith('.docx')) return normalize(linesToFountain(await docxLines(await file.arrayBuffer())));
  if (name.endsWith('.doc')) throw new Error('Format .doc ancien : enregistrez-le en .docx ou en PDF.');
  const text = normalize(await file.text());
  const md = name.endsWith('.md') || name.endsWith('.markdown');
  if (!md && looksLikeFountain(text)) return text;
  return normalize(linesToFountain(textToLines(md ? stripMarkdown(text) : text)));
}
