/**
 * Texte mis en forme de la note d'intention : un HTML réduit (paragraphes, titres, citation,
 * listes, gras, italique, souligné, barré, indice, exposant, police, corps, surlignage gris,
 * alignement, interligne, retrait, images du projet, sauts de page). Tout ce qui sort de cette
 * liste est retiré à l'enregistrement : la note reste propre, sûre et exportable.
 */

/** Styles de paragraphe proposés, et leur balise. */
export const PARAGRAPH_STYLES = [
  { key: 'p', label: 'Normal' },
  { key: 'h1', label: 'Titre' },
  { key: 'h4', label: 'Sous-titre' },
  { key: 'h2', label: 'Titre 1' },
  { key: 'h3', label: 'Titre 2' },
  { key: 'blockquote', label: 'Citation' },
] as const;
export type ParagraphStyle = (typeof PARAGRAPH_STYLES)[number]['key'];

/** Polices proposées (servies avec l'application). */
export const RICH_FONTS = [
  { family: 'Inter Variable', label: 'Inter' },
  { family: 'Source Serif 4', label: 'Source Serif' },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond' },
  { family: 'Courier Prime', label: 'Courier Prime' },
] as const;

/** Corps proposés, en points. */
export const RICH_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48] as const;

/** Interlignes proposés. */
export const LINE_SPACINGS = [1, 1.15, 1.5, 2] as const;

/** Retrait d'un cran (comme Word : 1,25 cm). */
export const INDENT_STEP_CM = 1.25;

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL', 'LI']);
const INLINE: Record<string, string> = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', SUB: 'sub', SUP: 'sup' };
const ALIGN = /^(left|center|right|justify)$/;
/** Balises dont rien ne passe (en-tête d'un document collé, scripts, objets, balises Office vides). */
const SKIP = new Set(['SCRIPT', 'STYLE', 'TITLE', 'META', 'LINK', 'HEAD', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'XML', 'O:P']);
const skipped = (el: Element) => SKIP.has(el.tagName.toUpperCase());
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, li, div, table, hr';

/** Un tableau collé : une ligne par rangée, cellules séparées par un point médian. */
function tableRows(table: Element): string[] {
  return Array.from((table as HTMLTableElement).rows ?? [])
    .map((tr) =>
      Array.from(tr.cells)
        .map((td) => cleanInline(td).replace(/^(<br>)+|(<br>)+$/g, ''))
        .filter((c) => c.replace(/<br>/g, '').trim())
        .join(' · '),
    )
    .filter(Boolean);
}

const escText = (s: string) => s.replace(/\u200b/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** Corps d'un ancien `<font size>` (1 à 7) en points. */
const FONT_SIZE_PT: Record<string, number> = { '1': 8, '2': 10, '3': 12, '4': 14, '5': 18, '6': 24, '7': 36 };

function fontFamilyOk(f: string): string | null {
  const name = f.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const known = RICH_FONTS.find((x) => x.family.toLowerCase() === name.toLowerCase() || x.label.toLowerCase() === name.toLowerCase());
  return known ? known.family : null;
}

function sizeOk(v: string): string | null {
  const m = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(v.trim());
  if (!m) return null;
  const pt = m[2] === 'px' ? (Number(m[1]) * 72) / 96 : Number(m[1]);
  return pt >= 6 && pt <= 96 ? `${Math.round(pt * 10) / 10}pt` : null;
}

/** Surlignage : toujours le même gris (la charte n'a pas de couleur). */
const HIGHLIGHT = 'rgba(17, 19, 24, 0.12)';

function blockStyle(el: Element): string {
  const st = (el as HTMLElement).style;
  const out: string[] = [];
  if (st?.textAlign && ALIGN.test(st.textAlign)) out.push(`text-align: ${st.textAlign}`);
  const lh = Number(st?.lineHeight);
  if (lh >= 0.8 && lh <= 3) out.push(`line-height: ${lh}`);
  const ml = /^(\d+(?:\.\d+)?)cm$/.exec(st?.marginLeft ?? '');
  if (ml && Number(ml[1]) > 0 && Number(ml[1]) <= 15) out.push(`margin-left: ${ml[1]}cm`);
  return out.join('; ');
}

function inlineStyle(el: Element): string {
  const st = (el as HTMLElement).style;
  const out: string[] = [];
  const fam = st?.fontFamily ? fontFamilyOk(st.fontFamily) : el.tagName === 'FONT' && el.getAttribute('face') ? fontFamilyOk(el.getAttribute('face')!) : null;
  if (fam) out.push(`font-family: '${fam}'`);
  const size = st?.fontSize ? sizeOk(st.fontSize) : el.tagName === 'FONT' && el.getAttribute('size') ? `${FONT_SIZE_PT[el.getAttribute('size')!] ?? 12}pt` : null;
  if (size) out.push(`font-size: ${size}`);
  if (st?.backgroundColor && st.backgroundColor !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(st.backgroundColor)) out.push(`background-color: ${HIGHLIGHT}`);
  return out.join('; ');
}

/** Marques portées par le style d'un élément en ligne (collage) : b, i, u, s, de l'intérieur vers l'extérieur. */
function inlineMarks(el: Element): string[] {
  const st = (el as HTMLElement).style;
  const out: string[] = [];
  const deco = `${st?.textDecoration ?? ''} ${st?.textDecorationLine ?? ''}`;
  if (/line-through/.test(deco)) out.push('s');
  if (/underline/.test(deco)) out.push('u');
  if (st?.fontStyle === 'italic') out.push('i');
  if (/bold|[6-9]00/.test(st?.fontWeight ?? '')) out.push('b');
  return out;
}

function cleanInline(node: Node): string {
  let out = '';
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType === 3) {
      out += escText(c.nodeValue ?? '');
      continue;
    }
    if (c.nodeType !== 1) continue;
    const el = c as Element;
    const tag = el.tagName;
    if (tag === 'BR') {
      out += '<br>';
      continue;
    }
    if (tag === 'IMG') {
      out += cleanImage(el);
      continue;
    }
    if (skipped(el)) continue;
    if (tag === 'TABLE') {
      const rows = tableRows(el).join('<br>');
      out += rows ? `${out && !out.endsWith('<br>') ? '<br>' : ''}${rows}` : '';
      continue;
    }
    const inner = cleanInline(el);
    // Gras « normal » (Google Docs enveloppe tout son texte dans un tel <b>) : transparent.
    if ((tag === 'B' || tag === 'STRONG') && /^(normal|[1-5]00)$/.test((el as HTMLElement).style?.fontWeight ?? '')) out += inner;
    else if (INLINE[tag]) out += inner ? `<${INLINE[tag]}>${inner}</${INLINE[tag]}>` : '';
    else if (tag === 'SPAN' || tag === 'FONT' || tag === 'MARK') {
      const style = tag === 'MARK' ? `background-color: ${HIGHLIGHT}` : inlineStyle(el);
      // Gras, italique, souligné et barré portés par un style : ramenés aux balises de la note.
      const marks = tag === 'MARK' ? '' : inlineMarks(el);
      let body = inner;
      for (const m of marks) body = `<${m}>${body}</${m}>`;
      out += style && inner ? `<span style="${style}">${body}</span>` : inner ? body : '';
    } else if (BLOCKS.has(tag) || tag === 'DIV') out += inner ? `${out && !out.endsWith('<br>') ? '<br>' : ''}${inner}` : '';
    else out += inner;
  }
  return out;
}

function cleanImage(el: Element): string {
  const key = el.getAttribute('data-blob');
  if (!key || !/^[\w:.-]+$/.test(key)) return '';
  const w = /^(\d+(?:\.\d+)?)%$/.exec((el as HTMLElement).style?.width ?? '');
  const alt = el.getAttribute('alt') ?? '';
  return `<img data-blob="${escAttr(key)}" alt="${escAttr(alt)}"${w ? ` style="width: ${Math.min(100, Math.max(5, Number(w[1])))}%"` : ''}>`;
}

function cleanBlocks(node: Node): string {
  let out = '';
  let loose = '';
  const flush = () => {
    if (loose.replace(/<br>/g, '').trim()) out += `<p>${loose}</p>`;
    loose = '';
  };
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType === 3) {
      if ((c.nodeValue ?? '').trim()) loose += escText(c.nodeValue ?? '');
      continue;
    }
    if (c.nodeType !== 1) continue;
    const el = c as Element;
    const tag = el.tagName;
    if (tag === 'HR') {
      flush();
      if (el.classList.contains('page-break')) out += '<hr class="page-break">';
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      flush();
      const items = Array.from(el.children)
        .filter((li) => li.tagName === 'LI')
        .map((li) => {
          const nested = Array.from(li.children).filter((x) => x.tagName === 'UL' || x.tagName === 'OL');
          const own = li.cloneNode(true) as Element;
          own.querySelectorAll(':scope > ul, :scope > ol').forEach((x) => x.remove());
          const st = blockStyle(li);
          return `<li${st ? ` style="${st}"` : ''}>${cleanInline(own) || '<br>'}${nested.map((n) => cleanBlocks({ childNodes: [n] } as unknown as Node)).join('')}</li>`;
        });
      if (items.length) out += `<${tag.toLowerCase()}>${items.join('')}</${tag.toLowerCase()}>`;
      continue;
    }
    if (skipped(el)) continue;
    if (tag === 'TABLE') {
      flush();
      for (const row of tableRows(el)) out += `<p>${row}</p>`;
      continue;
    }
    if (BLOCKS.has(tag) || tag === 'DIV' || /^H[56]$/.test(tag)) {
      flush();
      // Un bloc qui en contient d'autres (copier-coller) : ses blocs sont repris un par un.
      if (Array.from(el.children).some((x) => BLOCKS.has(x.tagName) || x.tagName === 'DIV' || x.tagName === 'HR' || x.tagName === 'TABLE')) {
        out += cleanBlocks(el);
        continue;
      }
      const t = tag === 'DIV' || tag === 'LI' ? 'p' : /^H[56]$/.test(tag) ? 'h3' : tag.toLowerCase();
      const st = blockStyle(el);
      const inner = cleanInline(el);
      out += `<${t}${st ? ` style="${st}"` : ''}>${inner || '<br>'}</${t}>`;
      continue;
    }
    if (tag === 'IMG') {
      flush();
      const img = cleanImage(el);
      if (img) out += `<p>${img}</p>`;
      continue;
    }
    // Élément en ligne qui contient des blocs (collage de Google Docs) : ses blocs restent des blocs.
    if (el.querySelector(BLOCK_SELECTOR)) {
      flush();
      out += cleanBlocks(el);
      continue;
    }
    loose += cleanInline({ childNodes: [el] } as unknown as Node);
  }
  flush();
  return out;
}

/** HTML de la note nettoyé : seules les balises, styles et images prévus restent. */
export function sanitizeRich(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return cleanBlocks(doc.body);
}

/** Texte brut de la note (paragraphes séparés par une ligne vide, puces conservées). */
export function richToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const parts: string[] = [];
  const walk = (el: Element, prefix = '') => {
    for (const c of Array.from(el.children)) {
      if (c.tagName === 'UL' || c.tagName === 'OL') {
        Array.from(c.children).forEach((li, i) => {
          const own = li.cloneNode(true) as Element;
          own.querySelectorAll('ul, ol').forEach((x) => x.remove());
          parts.push(`${prefix}${c.tagName === 'OL' ? `${i + 1}.` : '•'} ${textOf(own)}`.trimEnd());
          // Seules les sous-listes : le texte de la puce (gras, italique…) est déjà repris.
          for (const sub of Array.from(li.children)) if (sub.tagName === 'UL' || sub.tagName === 'OL') walk({ children: [sub] } as unknown as Element, `${prefix}  `);
        });
      } else if (c.tagName !== 'HR') {
        const t = textOf(c);
        if (t.trim()) parts.push(t);
      }
    }
  };
  walk(doc.body);
  return parts.join('\n\n');
}

function textOf(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) out += c.nodeValue ?? '';
      else if ((c as Element).tagName === 'BR') out += '\n';
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(el);
  return out.replace(/\u00a0/g, ' ');
}

/** Ancienne note en texte brut : un paragraphe par bloc séparé d'une ligne vide, retours gardés. */
export function textToRich(text: string): string {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/^\n+|\n+$/g, ''));
  return paras.filter((p) => p.trim()).map((p) => `<p>${escText(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Clés des images du projet posées dans la note. */
export function richImageKeys(html: string | undefined): string[] {
  return [...(html ?? '').matchAll(/data-blob="([^"]+)"/g)].map((m) => m[1]);
}
