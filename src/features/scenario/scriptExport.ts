/**
 * Exports du scénario au gabarit du modèle (KIT Scenarist, A4, Courier Prime 12 pt) : PDF en texte
 * (police intégrée, texte sélectionnable), images A4 et document Word. Les trois dessinent les
 * mêmes lignes, calculées une seule fois par `layoutScript`.
 */
import regularUrl from '../../assets/fonts/courier-prime/CourierPrime-Regular.ttf?url';
import boldUrl from '../../assets/fonts/courier-prime/CourierPrime-Bold.ttf?url';
import italicUrl from '../../assets/fonts/courier-prime/CourierPrime-Italic.ttf?url';
import boldItalicUrl from '../../assets/fonts/courier-prime/CourierPrime-BoldItalic.ttf?url';
import { blocksFromSource, headingNumbers, isEmptyBlock, parseTitlePage, type BlockType, type SBlock } from '../../domain/screenplay';
import { NOT_PRINTED, SCRIPT_COLUMNS, SCRIPT_PAGE, blankLinesBefore, layoutScript, parseEmphasis, printLines, printable, titlePageLines, titlePrintLines, type PrintLine, type Run } from '../../domain/scriptLayout';

export type Face = 'regular' | 'bold' | 'italic' | 'boldItalic';
const URLS: Record<Face, string> = { regular: regularUrl, bold: boldUrl, italic: italicUrl, boldItalic: boldItalicUrl };
const faceOf = (r: Run): Face => (r.bold && r.italic ? 'boldItalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'regular');

let fontBytes: Promise<Record<Face, ArrayBuffer>> | null = null;
/** Fichiers de la police (servis avec l'application, chargés une fois). */
export function loadFontBytes(): Promise<Record<Face, ArrayBuffer>> {
  fontBytes ??= Promise.all(
    (Object.keys(URLS) as Face[]).map(async (k) => {
      const res = await fetch(URLS[k]);
      if (!res.ok) throw new Error('Police Courier Prime introuvable.');
      return [k, await res.arrayBuffer()] as const;
    }),
  ).then((e) => Object.fromEntries(e) as Record<Face, ArrayBuffer>);
  fontBytes.catch(() => (fontBytes = null));
  return fontBytes;
}

export interface ScriptMeta {
  title: string;
  author?: string;
}

/** Pages à imprimer : la page de titre d'abord (si elle existe), puis les pages du scénario. */
function printedPages(source: string): { pages: PrintLine[][]; title?: Record<string, string> } {
  const { blocks } = blocksFromSource(source);
  const layout = layoutScript(blocks);
  const title = layout.title && Object.values(layout.title).some((v) => v.trim()) ? layout.title : undefined;
  const body = layout.pages.filter((p) => p.lines.length).map(printLines);
  return { pages: [...(title ? [titlePrintLines(title)] : []), ...(body.length ? body : [[]])], title };
}

const UNDERLINE = { offset: 1.9, thickness: 0.6 };

/** PDF texte, A4 : chaque ligne à sa place exacte, police intégrée (sous-ensemble). */
export async function scriptPdf(source: string, meta: ScriptMeta): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }, bytes] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), loadFontBytes()]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = Object.fromEntries(await Promise.all((Object.keys(bytes) as Face[]).map(async (k) => [k, await pdf.embedFont(bytes[k], { subset: true })] as const))) as Record<Face, Awaited<ReturnType<typeof pdf.embedFont>>>;
  const { w, h, fontSize, cw } = SCRIPT_PAGE;
  const black = rgb(0, 0, 0);
  const { pages, title } = printedPages(source);
  for (const lines of pages) {
    const page = pdf.addPage([w, h]);
    for (const line of lines) {
      let x = line.x;
      for (const r of line.runs) {
        if (r.text.trim()) page.drawText(r.text, { x, y: h - line.y, size: fontSize, font: fonts[faceOf(r)], color: black });
        if (r.underline && r.text.length) page.drawLine({ start: { x, y: h - line.y - UNDERLINE.offset }, end: { x: x + r.text.length * cw, y: h - line.y - UNDERLINE.offset }, thickness: UNDERLINE.thickness, color: black });
        x += r.text.length * cw;
      }
    }
  }
  pdf.setTitle(meta.title || title?.Title || 'Scénario');
  if (meta.author || title?.Author) pdf.setAuthor((meta.author || title?.Author || '').replace(/\n/g, ', '));
  pdf.setCreator('Découpage Studio');
  pdf.setProducer('Découpage Studio');
  pdf.setLanguage('fr-FR');
  const out = await pdf.save();
  return new Blob([out], { type: 'application/pdf' });
}

let facesReady: Promise<void> | null = null;
const CANVAS_FAMILY = 'DS Courier Prime';
/** La même police pour le dessin des images (indépendante des polices de l'interface). */
function loadCanvasFaces(): Promise<void> {
  facesReady ??= loadFontBytes().then(async (bytes) => {
    const specs: Array<[Face, string, string]> = [
      ['regular', '400', 'normal'],
      ['bold', '700', 'normal'],
      ['italic', '400', 'italic'],
      ['boldItalic', '700', 'italic'],
    ];
    for (const [k, weight, style] of specs) {
      const face = new FontFace(CANVAS_FAMILY, bytes[k].slice(0), { weight, style });
      await face.load();
      document.fonts.add(face);
    }
  });
  facesReady.catch(() => (facesReady = null));
  return facesReady;
}

/** Une image par page A4 (240 points par pouce), mêmes positions que le PDF. */
export async function scriptCanvases(source: string): Promise<HTMLCanvasElement[]> {
  await loadCanvasFaces();
  const k = (2.5 * 96) / 72;
  const { w, h, fontSize, cw } = SCRIPT_PAGE;
  return printedPages(source).pages.map((lines) => {
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    ctx.textBaseline = 'alphabetic';
    for (const line of lines) {
      let x = line.x;
      for (const r of line.runs) {
        ctx.font = `${r.italic ? 'italic ' : ''}${r.bold ? 700 : 400} ${fontSize * k}px "${CANVAS_FAMILY}"`;
        // Grille fixe : chaque caractère à sa colonne, quel que soit l'arrondi du moteur de rendu.
        [...r.text].forEach((ch, i) => ch !== ' ' && ctx.fillText(ch, (x + i * cw) * k, line.y * k));
        if (r.underline && r.text.length) {
          ctx.lineWidth = UNDERLINE.thickness * k;
          ctx.beginPath();
          ctx.moveTo(x * k, (line.y + UNDERLINE.offset) * k);
          ctx.lineTo((x + r.text.length * cw) * k, (line.y + UNDERLINE.offset) * k);
          ctx.stroke();
        }
        x += r.text.length * cw;
      }
    }
    return c;
  });
}

// --- Word (.docx) ---------------------------------------------------------------------------------

/** Points → vingtièmes de point (unité de Word). */
export const tw = (pt: number) => Math.round(pt * 20);
export const xmlEsc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
export const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const STYLE_ID: Partial<Record<BlockType, string>> = {
  heading: 'Sequence',
  action: 'Action',
  character: 'Personnage',
  parenthetical: 'Didascalie',
  dialogue: 'Replique',
  transition: 'Transition',
  centered: 'Centre',
};
const STYLE_NAME: Record<string, string> = { Sequence: 'Séquence', Action: 'Action', Personnage: 'Personnage', Didascalie: 'Didascalie', Replique: 'Réplique', Transition: 'Transition', Centre: 'Centré', Titre: 'Page de garde' };

function styleXml(id: string, t: BlockType | 'titre'): string {
  const { cw, right, lineH } = SCRIPT_PAGE;
  const col = t === 'titre' ? SCRIPT_COLUMNS.title : SCRIPT_COLUMNS[t];
  const left = col.x - SCRIPT_COLUMNS.action.x;
  // Largeur de colonne : le nombre de caractères du modèle, plus une marge d'arrondi.
  const width = col.chars * cw + 0.5;
  const rightInd = Math.max(0, right - col.x - width);
  const jc = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left';
  const keepNext = t === 'heading' || t === 'character' || t === 'parenthetical' || t === 'transition';
  return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${STYLE_NAME[id]}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:keepLines/><w:spacing w:before="0" w:after="0" w:line="${tw(lineH)}" w:lineRule="exact"/><w:ind w:left="${tw(left)}" w:right="${tw(rightInd)}"/><w:jc w:val="${jc}"/></w:pPr>${col.upper ? '<w:rPr><w:caps/></w:rPr>' : ''}</w:style>`;
}

/** Morceaux de texte Word (gras, italique, souligné). */
function runsXml(text: string): string {
  return text
    .split('\n')
    .map((line, i) =>
      (i ? '<w:r><w:br/></w:r>' : '') +
      parseEmphasis(printable(line))
        .map((r) => `<w:r>${r.bold || r.italic || r.underline ? `<w:rPr>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}${r.underline ? '<w:u w:val="single"/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`)
        .join(''),
    )
    .join('');
}

/** Clé d'obscurcissement d'une police intégrée (ECMA-376, §17.8.1) : les 32 premiers octets passés au XOR. */
function obfuscate(font: ArrayBuffer, guid: string): Uint8Array {
  const pos = [35, 33, 31, 29, 27, 25, 22, 20, 17, 15, 12, 10, 7, 5, 3, 1];
  const key = pos.map((p) => parseInt(guid.slice(p, p + 2), 16));
  const out = new Uint8Array(font.slice(0));
  for (let i = 0; i < 32; i++) out[i] ^= key[i % 16];
  return out;
}

const guid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
};

/**
 * Document Word du scénario : styles nommés (Séquence, Action, Personnage, Réplique…), A4,
 * Courier Prime intégrée, numéro de page en haut à droite à partir de la deuxième page.
 */
export async function scriptDocx(source: string, meta: ScriptMeta): Promise<Blob> {
  const bytes = await loadFontBytes();
  const { blocks } = blocksFromSource(source);
  const numbers = headingNumbers(blocks);
  const { lineH, w, h, right, pageNumberBaseline, firstBaseline } = SCRIPT_PAGE;
  const printed = blocks.filter((b) => b.type !== 'title' && !NOT_PRINTED.has(b.type) && (b.type === 'pagebreak' || !isEmptyBlock(b)));
  const paras: string[] = [];
  let prev: BlockType | undefined;
  let breakBefore = false;
  printed.forEach((b: SBlock, i) => {
    if (b.type === 'pagebreak') {
      breakBefore = paras.length > 0;
      prev = undefined;
      return;
    }
    const id = STYLE_ID[b.type] ?? 'Action';
    const before = blankLinesBefore(prev, b.type) * lineH;
    const next = printed[i + 1];
    const inGroup = (b.type === 'dialogue' || b.type === 'parenthetical') && next && (next.type === 'dialogue' || next.type === 'parenthetical');
    const ppr = `<w:pPr><w:pStyle w:val="${id}"/>${inGroup ? '<w:keepNext/>' : ''}${breakBefore ? '<w:pageBreakBefore/>' : ''}${before ? `<w:spacing w:before="${tw(before)}"/>` : ''}${b.type === 'heading' && numbers.has(b.id) ? `<w:tabs><w:tab w:val="right" w:pos="${tw(SCRIPT_PAGE.sceneNumberRight - SCRIPT_COLUMNS.action.x)}"/><w:tab w:val="left" w:pos="0"/></w:tabs><w:ind w:left="0" w:hanging="${tw(72)}"/>` : ''}</w:pPr>`;
    // Numéro de séquence dans la marge, aligné à droite comme dans le modèle.
    const num = b.type === 'heading' && numbers.has(b.id) ? `<w:r><w:tab/><w:t>${numbers.get(b.id)}.</w:t></w:r><w:r><w:tab/></w:r>` : '';
    paras.push(`<w:p>${ppr}${num}${runsXml(b.text)}</w:p>`);
    breakBefore = false;
    prev = b.type;
  });
  if (!paras.length) paras.push('<w:p><w:pPr><w:pStyle w:val="Action"/></w:pPr></w:p>');

  const tb = blocks.find((b) => b.type === 'title');
  const title = tb ? parseTitlePage(tb.text) : {};
  const hasTitle = Object.values(title).some((v) => v.trim());
  // Marges : première ligne de base et 58 lignes par page, comme le modèle.
  const top = firstBaseline - lineH * 0.8;
  const bottom = h - top - lineH * 58.2;
  const pageSetup = (first: boolean) =>
    `<w:pgSz w:w="${tw(w)}" w:h="${tw(h)}"/><w:pgMar w:top="${tw(top)}" w:right="${tw(w - right)}" w:bottom="${tw(bottom)}" w:left="${tw(SCRIPT_COLUMNS.action.x)}" w:header="${tw(pageNumberBaseline - lineH * 0.8)}" w:footer="${tw(28)}" w:gutter="0"/>${first ? '' : '<w:pgNumType w:start="1"/><w:titlePg/>'}`;
  const titleParas: string[] = [];
  if (hasTitle) {
    // Mêmes lignes que le PDF : chaque ligne à son rang, l'écart rendu par l'espace avant.
    let row = -1;
    const lines = titlePageLines(title);
    for (const l of lines) {
      const before = (l.row - row - 1) * lineH;
      row = l.row;
      const last = l === lines[lines.length - 1];
      titleParas.push(`<w:p><w:pPr><w:pStyle w:val="${l.align === 'center' ? 'Titre' : 'Action'}"/>${before ? `<w:spacing w:before="${tw(before)}"/>` : ''}${last ? `<w:sectPr>${pageSetup(true)}</w:sectPr>` : ''}</w:pPr>${runsXml(l.text)}</w:p>`);
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${titleParas.join('')}${paras.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:headerReference w:type="first" r:id="rIdHeaderFirst"/>${pageSetup(false)}</w:sectPr></w:body></w:document>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Action"/><w:jc w:val="right"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>.</w:t></w:r></w:p></w:hdr>`;
  const headerFirst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Action"/></w:pPr></w:p></w:hdr>`;
  const font = 'w:ascii="Courier Prime" w:hAnsi="Courier Prime" w:cs="Courier Prime" w:eastAsia="Courier Prime"';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts ${font}/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${tw(lineH)}" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:widowControl w:val="0"/></w:pPr><w:rPr><w:rFonts ${font}/><w:sz w:val="24"/></w:rPr></w:style>${(Object.entries(STYLE_ID) as Array<[BlockType, string]>).map(([t, id]) => styleXml(id, t)).join('')}${styleXml('Titre', 'titre')}</w:styles>`;
  return docxPackage({
    document,
    styles,
    headers: { rIdHeader: header, rIdHeaderFirst: headerFirst },
    font: { name: 'Courier Prime', alt: 'Courier New', family: 'modern', fixed: true, faces: { embedRegular: bytes.regular, embedBold: bytes.bold, embedItalic: bytes.italic, embedBoldItalic: bytes.boldItalic } },
    title: meta.title || title.Title || 'Scénario',
    author: (meta.author || title.Author || '').replace(/\n/g, ', '),
  });
}

export type DocxEmbed = 'embedRegular' | 'embedBold' | 'embedItalic' | 'embedBoldItalic';

export interface DocxParts {
  /** `word/document.xml`. */
  document: string;
  /** `word/styles.xml`. */
  styles: string;
  /** En-têtes, par identifiant de relation (`rIdHeader` → `header1.xml`…). */
  headers?: Record<string, string>;
  /** Pieds de page, de même (`footer1.xml`…). */
  footers?: Record<string, string>;
  /** Police intégrée (obscurcie, ECMA-376). */
  font: { name: string; alt: string; family: 'modern' | 'swiss' | 'roman'; fixed?: boolean; faces: Partial<Record<DocxEmbed, ArrayBuffer>> };
  title: string;
  author?: string;
}

/** Paquet .docx : types de contenu, relations, propriétés, réglages, table des polices et polices intégrées. */
export async function docxPackage(p: DocxParts): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const headers = Object.entries(p.headers ?? {});
  const footers = Object.entries(p.footers ?? {});
  const faces = (Object.entries(p.font.faces) as Array<[DocxEmbed, ArrayBuffer]>).filter(([, b]) => b);
  const keys = faces.map(() => guid());
  const fontTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts ${W_NS}><w:font w:name="${xmlEsc(p.font.name)}"><w:altName w:val="${xmlEsc(p.font.alt)}"/><w:family w:val="${p.font.family}"/><w:pitch w:val="${p.font.fixed ? 'fixed' : 'variable'}"/>${faces.map(([tag], i) => `<w:${tag} r:id="rIdFont${i + 1}" w:fontKey="${keys[i]}"/>`).join('')}</w:font></w:fonts>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W_NS}><w:embedTrueTypeFonts/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const headerType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
  const footerType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>${headers.map((_h, i) => `<Override PartName="/word/header${i + 1}.xml" ContentType="${headerType}"/>`).join('')}${footers.map((_f, i) => `<Override PartName="/word/footer${i + 1}.xml" ContentType="${footerType}"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(p.title)}</dc:title><dc:creator>${xmlEsc(p.author ?? '')}</dc:creator><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('word/document.xml', p.document);
  zip.file('word/styles.xml', p.styles);
  zip.file('word/settings.xml', settings);
  zip.file('word/fontTable.xml', fontTable);
  headers.forEach(([, xml], i) => zip.file(`word/header${i + 1}.xml`, xml));
  footers.forEach(([, xml], i) => zip.file(`word/footer${i + 1}.xml`, xml));
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>${headers.map(([id], i) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header${i + 1}.xml"/>`).join('')}${footers.map(([id], i) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer${i + 1}.xml"/>`).join('')}</Relationships>`);
  zip.file('word/_rels/fontTable.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${faces.map((_e, i) => `<Relationship Id="rIdFont${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${i + 1}.odttf"/>`).join('')}</Relationships>`);
  faces.forEach(([, bytes], i) => zip.file(`word/fonts/font${i + 1}.odttf`, obfuscate(bytes, keys[i])));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
