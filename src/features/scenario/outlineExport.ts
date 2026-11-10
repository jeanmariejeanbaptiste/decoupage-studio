/**
 * Exports du séquencier : PDF texte (pdf-lib, Inter intégrée, mise en page `layoutOutline`) et
 * document Word (même contenu, styles nommés, paquet de `scriptExport`). Pas de boîte de dialogue.
 */
import regularUrl from '../../assets/fonts/inter/Inter-Regular.ttf?url';
import mediumUrl from '../../assets/fonts/inter/Inter-Medium.ttf?url';
import semiboldUrl from '../../assets/fonts/inter/Inter-SemiBold.ttf?url';
import { mmss } from '../../domain/chronometry';
import { outlineMeasures, outlineOf, plotName, plotsOf, type OutlineSequence } from '../../domain/outline';
import { OUTLINE_PAGE, layoutOutline, type OutlineWeight } from '../../domain/outlineLayout';
import { stepLabel } from '../../domain/truby';
import type { ProjectDoc } from '../../domain/types';
import { activeVersion } from '../../domain/versions';
import { downloadBlob } from '../../store/persistence';
import { W_NS, docxPackage, tw, xmlEsc } from './scriptExport';

export interface OutlineExportOptions {
  /** Liste : ordre du récit, toutes intrigues. Par intrigue : une section par intrigue retenue. */
  order: 'list' | 'plots';
  /** Par intrigue : intrigues retenues, dans l'ordre voulu (absent : toutes). */
  plots?: string[];
}

const URLS: Record<OutlineWeight, string> = { 400: regularUrl, 500: mediumUrl, 600: semiboldUrl };

let interBytes: Promise<Record<OutlineWeight, ArrayBuffer>> | null = null;
/** Inter (Regular, Medium, SemiBold), servie avec l'application et chargée une fois. */
function loadInterBytes(): Promise<Record<OutlineWeight, ArrayBuffer>> {
  interBytes ??= Promise.all(
    ([400, 500, 600] as const).map(async (k) => {
      const res = await fetch(URLS[k]);
      if (!res.ok) throw new Error('Police Inter introuvable.');
      return [k, await res.arrayBuffer()] as const;
    }),
  ).then((e) => Object.fromEntries(e) as Record<OutlineWeight, ArrayBuffer>);
  interBytes.catch(() => (interBytes = null));
  return interBytes;
}

/** Nom de fichier : titre du projet puis « séquencier », sans accents ni signes. */
export function outlineFileBase(doc: Pick<ProjectDoc, 'project'>): string {
  const base = `${doc.project.title || 'projet'} séquencier`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return base || 'sequencier';
}

const today = () => new Date().toLocaleDateString('fr-FR');
const versionOf = (doc: ProjectDoc) => activeVersion(doc)?.name ?? doc.project.version;

// --- PDF ----------------------------------------------------------------------------------------

export async function outlinePdf(doc: ProjectDoc, opts: OutlineExportOptions): Promise<Blob> {
  const [{ PDFDocument, rgb, setCharacterSpacing }, { default: fontkit }, bytes] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), loadInterBytes()]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = Object.fromEntries(await Promise.all(([400, 500, 600] as const).map(async (k) => [k, await pdf.embedFont(bytes[k], { subset: true })] as const))) as Record<
    OutlineWeight,
    Awaited<ReturnType<typeof pdf.embedFont>>
  >;
  const ink = rgb(0.07, 0.07, 0.07);
  const gray = rgb(0.42, 0.42, 0.42);
  const rule = rgb(0.82, 0.82, 0.82);
  const pages = layoutOutline(doc, {
    order: opts.order,
    plots: opts.plots,
    date: today(),
    measure: (text, size, weight) => fonts[weight].widthOfTextAtSize(text, size),
  });
  const { w, h } = OUTLINE_PAGE;
  for (const p of pages) {
    const page = pdf.addPage([w, h]);
    for (const e of p.elements) {
      if (e.kind === 'rule') {
        page.drawLine({ start: { x: e.x, y: h - e.y }, end: { x: e.x + e.width, y: h - e.y }, thickness: 0.5, color: rule });
        continue;
      }
      if (e.tracking) page.pushOperators(setCharacterSpacing(e.tracking));
      page.drawText(e.text, { x: e.x, y: h - e.y, size: e.size, font: fonts[e.weight], color: e.gray ? gray : ink });
      if (e.tracking) page.pushOperators(setCharacterSpacing(0));
    }
  }
  const title = doc.project.title || 'Sans titre';
  pdf.setTitle(`${title} — Séquencier`);
  pdf.setCreator('Découpage Studio');
  pdf.setProducer('Découpage Studio');
  pdf.setLanguage('fr-FR');
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

export async function exportOutlinePdf(doc: ProjectDoc, opts: OutlineExportOptions = { order: 'list' }): Promise<void> {
  downloadBlob(await outlinePdf(doc, opts), `${outlineFileBase(doc)}.pdf`);
}

// --- Word ---------------------------------------------------------------------------------------

/** Contenu du séquencier dans l'ordre demandé (mêmes règles que `layoutOutline`). */
type Row =
  | { kind: 'section'; title: string; count: string }
  | { kind: 'part'; title: string }
  | { kind: 'entry'; it: OutlineSequence; right: string; attrs: string };

function outlineRows(doc: ProjectDoc, opts: OutlineExportOptions): Row[] {
  const items = outlineOf(doc.scenario ?? '');
  const m = outlineMeasures(doc);
  const declared = plotsOf(doc);
  const sequences = items.filter((x): x is OutlineSequence => x.kind === 'sequence');
  const entry = (it: OutlineSequence, withPlot: boolean): Row => {
    const me = m.byN.get(it.n);
    const attrs = [it.step !== undefined ? stepLabel(it.step) : '', withPlot ? plotName(doc, it.plot) : ''].filter(Boolean).join(' · ');
    return { kind: 'entry', it, right: me ? `p. ${me.page} · ${mmss(me.sec)}` : '', attrs };
  };
  const rows: Row[] = [];
  if (opts.order === 'list') {
    const several = declared.length > 1 || sequences.some((x) => x.plot !== declared[0]?.key);
    for (const it of items) rows.push(it.kind === 'part' ? { kind: 'part', title: it.title } : entry(it, several));
    return rows;
  }
  const used = [...new Set(sequences.map((x) => x.plot))];
  const all = [...declared.map((p) => p.key), ...used.filter((k) => !declared.some((p) => p.key === k)).sort()];
  for (const key of opts.plots ? opts.plots.filter((k) => all.includes(k)) : all) {
    const own = sequences.filter((x) => x.plot === key);
    const total = own.reduce((t, x) => t + (m.byN.get(x.n)?.sec ?? 0), 0);
    rows.push({ kind: 'section', title: plotName(doc, key), count: `${own.length} · ${mmss(total)}` });
    let part: string | undefined;
    let shown: string | undefined;
    for (const it of items) {
      if (it.kind === 'part') {
        part = it.title;
        continue;
      }
      if (it.plot !== key) continue;
      if (part !== undefined && part !== shown) {
        rows.push({ kind: 'part', title: part });
        shown = part;
      }
      rows.push(entry(it, false));
    }
  }
  return rows;
}

const INK = '111111';
const GRAY = '6B6B6B';
const RULE = 'D1D1D1';
const run = (text: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
const grayRun = (text: string) => run(text, `<w:b w:val="0"/><w:caps w:val="0"/><w:color w:val="${GRAY}"/><w:sz w:val="20"/>`);

export async function outlineDocx(doc: ProjectDoc, opts: OutlineExportOptions): Promise<Blob> {
  const bytes = await loadInterBytes();
  const P = OUTLINE_PAGE;
  const textW = P.right - P.left;
  const paras: string[] = [];
  const p = (style: string, body: string, ppr = '') => paras.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/>${ppr}</w:pPr>${body}</w:p>`);
  const title = doc.project.title || 'Sans titre';
  const version = versionOf(doc);
  p('Titre', run(title));
  if (version) p('Version', run(version));
  const logline = doc.research?.logline?.trim();
  if (logline) p('Logline', run(logline));
  const rightTab = `<w:tabs><w:tab w:val="right" w:pos="${tw(textW)}"/></w:tabs>`;
  const entryTabs = `<w:tabs><w:tab w:val="left" w:pos="${tw(P.indent)}"/><w:tab w:val="right" w:pos="${tw(textW)}"/></w:tabs>`;
  for (const r of outlineRows(doc, opts)) {
    if (r.kind === 'section') p('Intrigue', `${run(r.title)}<w:r><w:tab/></w:r>${grayRun(r.count)}`, rightTab);
    else if (r.kind === 'part') p('Partie', run(r.title));
    else {
      p('Entree', `${run(String(r.it.n))}<w:r><w:tab/></w:r>${run(r.it.heading)}${r.right ? `<w:r><w:tab/></w:r>${grayRun(r.right)}` : ''}`, entryTabs);
      if (r.it.phrase.trim()) p('Phrase', run(r.it.phrase.trim()));
      if (r.attrs) p('Attributs', run(r.attrs));
    }
  }
  const field = (code: string, shown: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(shown)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const footText = ['Séquencier', version, today()].filter(Boolean).join(' · ');
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Pied"/></w:pPr>${run(`${footText} · page `)}${field('PAGE', '1')}${run(' / ')}${field('NUMPAGES', '1')}</w:p></w:ftr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${paras.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${tw(P.w)}" w:h="${tw(P.h)}"/><w:pgMar w:top="${tw(P.top)}" w:right="${tw(P.w - P.right)}" w:bottom="${tw(P.h - P.bottom)}" w:left="${tw(P.left)}" w:header="${tw(28)}" w:footer="${tw(P.h - P.footerBaseline - 6)}" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const font = 'w:ascii="Inter" w:hAnsi="Inter" w:cs="Inter" w:eastAsia="Inter"';
  const half = (pt: number) => Math.round(pt * 2);
  const style = (id: string, name: string, o: { size: number; bold?: boolean; gray?: boolean; caps?: boolean; spacing?: number; before?: number; after?: number; indent?: number; hanging?: boolean; keepNext?: boolean; border?: boolean }) =>
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${o.keepNext ? '<w:keepNext/>' : ''}<w:keepLines/>${
      o.border ? `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="3" w:color="${RULE}"/></w:pBdr>` : ''
    }<w:spacing w:before="${tw(o.before ?? 0)}" w:after="${tw(o.after ?? 0)}" w:line="${tw(o.size * 1.4)}" w:lineRule="atLeast"/>${o.indent ? `<w:ind w:left="${tw(o.indent)}"${o.hanging ? ` w:hanging="${tw(o.indent)}"` : ''}/>` : ''}</w:pPr><w:rPr>${o.bold ? '<w:b/>' : ''}${o.caps ? '<w:caps/>' : ''}${o.spacing ? `<w:spacing w:val="${tw(o.spacing)}"/>` : ''}<w:color w:val="${o.gray ? GRAY : INK}"/><w:sz w:val="${half(o.size)}"/><w:szCs w:val="${half(o.size)}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts ${font}/><w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts ${font}/></w:rPr></w:style>${[
    style('Titre', 'Titre du séquencier', { size: 16, bold: true }),
    style('Version', 'Version', { size: 10, gray: true, before: 2 }),
    style('Logline', 'Logline', { size: 10.5, before: 6, after: 6 }),
    style('Intrigue', 'Intrigue', { size: 12, bold: true, before: 22, after: 8, keepNext: true, border: true }),
    style('Partie', 'Partie', { size: 9, bold: true, gray: true, caps: true, spacing: 0.9, before: 14, after: 6, keepNext: true, border: true }),
    style('Entree', 'Séquence', { size: 10, bold: true, caps: true, before: 10, indent: P.indent, hanging: true, keepNext: true }),
    style('Phrase', 'Phrase', { size: 10.5, before: 2, indent: P.indent, keepNext: true }),
    style('Attributs', 'Étape et intrigue', { size: 8.5, gray: true, before: 1, indent: P.indent }),
    style('Pied', 'Pied de page', { size: 8, gray: true }),
  ].join('')}</w:styles>`;
  return docxPackage({
    document,
    styles,
    footers: { rIdFooter: footer },
    font: { name: 'Inter', alt: 'Arial', family: 'swiss', faces: { embedRegular: bytes[400], embedBold: bytes[600] } },
    title: `${title} — Séquencier`,
  });
}

export async function exportOutlineDocx(doc: ProjectDoc, opts: OutlineExportOptions = { order: 'list' }): Promise<void> {
  downloadBlob(await outlineDocx(doc, opts), `${outlineFileBase(doc)}.docx`);
}
