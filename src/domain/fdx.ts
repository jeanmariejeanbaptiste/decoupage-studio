/**
 * Final Draft (.fdx) : lecture et écriture. Le format garde le type exact de chaque paragraphe
 * (personnage, réplique, didascalie…), là où un PDF ou un Word demandent de le deviner.
 * Final Draft, KIT Scenarist, Highland, WriterDuet, Fade In et Yamdu l'exportent.
 */
import { headingNumbers, isEmptyBlock, parseTitlePage, serialize, setTitlePage, type BlockType, type SBlock, type ScriptDoc } from './screenplay';
import { isOutlinePhrase } from './outline';
import { parseEmphasis, type Run } from './scriptLayout';

export interface FdxParagraph {
  type: BlockType;
  text: string;
}

export interface FdxScript {
  paragraphs: FdxParagraph[];
  /** Page de titre, en clés Fountain (Title, Credit, Author, Source, Draft date, Contact). */
  title: Record<string, string>;
}

const TYPES: Record<string, BlockType> = {
  'scene heading': 'heading',
  action: 'action',
  general: 'action',
  shot: 'action',
  'cast list': 'action',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  lyrics: 'dialogue',
  transition: 'transition',
  'new act': 'centered',
  'end of act': 'centered',
  'outline body': 'synopsis',
};

const typeOf = (t: string | null): BlockType => {
  const k = (t ?? '').trim().toLowerCase();
  if (/^outline \d/.test(k)) return 'section';
  return TYPES[k] ?? 'action';
};

const childrenNamed = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);

/** Texte d'un paragraphe, avec gras, italique et souligné en marques Fountain. */
function paragraphText(p: Element): string {
  const runs: Array<{ text: string; marks: string }> = [];
  for (const t of childrenNamed(p, 'Text')) {
    const text = (t.textContent ?? '').replace(/\t/g, ' ').replace(/\r\n?/g, '\n');
    if (!text) continue;
    const style = (t.getAttribute('Style') ?? '').toLowerCase().split('+');
    const marks = (style.includes('bold') ? '**' : '') + (style.includes('italic') ? '*' : '') + (style.includes('underline') ? '_' : '');
    const last = runs[runs.length - 1];
    if (last && last.marks === marks) last.text += text;
    else runs.push({ text, marks });
  }
  return runs
    .map(({ text, marks }) => {
      if (!marks || !text.trim()) return text;
      // Les espaces restent hors des marques : « **mot** » et non « **mot **».
      const lead = /^\s*/.exec(text)![0];
      const trail = /\s*$/.exec(text)![0];
      const core = text.slice(lead.length, text.length - trail.length);
      const close = marks.split('').reverse().join('');
      return `${lead}${marks}${core}${close}${trail}`;
    })
    .join('');
}

/** Page de titre de Final Draft (paragraphes libres) : titre, crédit, auteurs, contact et date devinés. */
function readTitlePage(tp: Element | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tp) return out;
  const content = childrenNamed(tp, 'Content')[0] ?? tp;
  const paras = Array.from(content.getElementsByTagName('Paragraph')).map((p) => ({
    text: paragraphText(p).replace(/[*_]/g, '').trim(),
    align: (p.getAttribute('Alignment') ?? 'Left').toLowerCase(),
  }));
  const centered = paras.filter((p) => p.text && p.align === 'center');
  const others = paras.filter((p) => p.text && p.align !== 'center');
  let i = 0;
  if (centered[i]) out.Title = centered[i++].text;
  const credit = /^(written|screenplay|teleplay|story|by\b|écrit|ecrit|scénario|scenario|un film|d['’]après|adapt)/i;
  if (centered[i] && credit.test(centered[i].text) && !/^d['’]après/i.test(centered[i].text)) out.Credit = centered[i++].text;
  const authors: string[] = [];
  while (centered[i] && !/^(d['’]après|based on|from)\b/i.test(centered[i].text)) authors.push(centered[i++].text);
  if (authors.length) out.Author = authors.join('\n');
  const source = centered.slice(i).map((p) => p.text);
  if (source.length) out.Source = source.join('\n');
  const date = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december|draft|version|révision|revision)\b/i;
  const dates = others.filter((p) => date.test(p.text) && p.text.length < 40);
  const contact = others.filter((p) => !dates.includes(p));
  if (dates.length) out['Draft date'] = dates.map((p) => p.text).join('\n');
  if (contact.length) out.Contact = contact.map((p) => p.text).join('\n');
  return out;
}

/** Lit un fichier Final Draft. */
export function parseFdx(xml: string): FdxScript {
  const dom = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml');
  const root = dom.documentElement;
  if (!root || root.localName !== 'FinalDraft' || dom.getElementsByTagName('parsererror').length) throw new Error('Fichier Final Draft illisible.');
  const content = childrenNamed(root, 'Content')[0];
  const paragraphs: FdxParagraph[] = [];
  const add = (p: Element) => {
    const type = typeOf(p.getAttribute('Type'));
    if (p.getAttribute('StartsNewPage') === 'Yes' && paragraphs.length) paragraphs.push({ type: 'pagebreak', text: '' });
    let text = paragraphText(p);
    // Un seul paragraphe par ligne, sauf l'action et la réplique qui gardent leurs retours.
    if (type !== 'action' && type !== 'dialogue') text = text.replace(/\s*\n\s*/g, ' ');
    text = text.replace(/[^\S\n]+$/gm, '').replace(/^\n+|\n+$/g, '');
    if (!text.trim()) return;
    paragraphs.push({ type, text });
    // Résumé de la scène (Final Draft) : la phrase du séquencier, ligne « = » sous l'en-tête.
    if (type === 'heading') {
      const summary = childrenNamed(p, 'SceneProperties')
        .flatMap((sp) => childrenNamed(sp, 'Summary'))
        .flatMap((sm) => childrenNamed(sm, 'Paragraph'))
        .map((sp) => paragraphText(sp).replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
      if (summary) paragraphs.push({ type: 'synopsis', text: summary });
    }
  };
  for (const el of content ? Array.from(content.children) : []) {
    if (el.localName === 'Paragraph') add(el);
    // Répliques simultanées : lues l'une après l'autre.
    else if (el.localName === 'DualDialogue') childrenNamed(el, 'Paragraph').forEach(add);
  }
  return { paragraphs, title: readTitlePage(childrenNamed(root, 'TitlePage')[0]) };
}

let seq = 0;

/** Convertit un fichier Final Draft en Fountain (la source de l'outil). */
export function fdxToFountain(xml: string): string {
  const { paragraphs, title } = parseFdx(xml);
  const blocks: SBlock[] = paragraphs.map((p) => ({ id: `fdx${++seq}`, type: p.type, text: p.text }));
  let doc: ScriptDoc = { blocks, trail: '\n' };
  if (Object.keys(title).length) doc = setTitlePage(doc, title);
  return serialize(doc).source;
}

const xmlEsc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const FDX_TYPE: Partial<Record<BlockType, string>> = {
  heading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  centered: 'Action',
};

/** Morceaux de texte Final Draft : l'emphase Fountain devient leur style. */
function fdxRuns(text: string): string {
  const runs: Run[] = text.split('\n').flatMap((line, i) => [...(i ? [{ text: '\n' }] : []), ...parseEmphasis(line)]);
  const body = runs
    .map((r) => {
      const style = [r.bold ? 'Bold' : '', r.italic ? 'Italic' : '', r.underline ? 'Underline' : ''].filter(Boolean).join('+');
      return `<Text${style ? ` Style="${style}"` : ''}>${xmlEsc(r.text)}</Text>`;
    })
    .join('');
  return body || '<Text></Text>';
}

/** Paragraphe Final Draft ; `inner` se place avant le texte (propriétés de la scène). */
function fdxParagraph(type: string, text: string, attrs = '', inner = ''): string {
  return `    <Paragraph${attrs} Type="${type}">${inner}${fdxRuns(text)}</Paragraph>`;
}

/** Écrit le scénario au format Final Draft (A4, numéros de séquence de l'outil). */
export function scriptToFdx(blocks: readonly SBlock[]): string {
  const numbers = headingNumbers(blocks);
  const out: string[] = [];
  let newPage = false;
  blocks.forEach((b, i) => {
    if (b.type === 'pagebreak') {
      newPage = out.length > 0;
      return;
    }
    const type = FDX_TYPE[b.type];
    if (!type || isEmptyBlock(b)) return;
    let attrs = '';
    if (b.type === 'heading' && numbers.has(b.id)) attrs += ` Number="${numbers.get(b.id)}"`;
    if (b.type === 'centered') attrs += ' Alignment="Center"';
    if (newPage) attrs += ' StartsNewPage="Yes"';
    newPage = false;
    const text = b.type === 'heading' || b.type === 'character' || b.type === 'transition' ? b.text.toLocaleUpperCase('fr') : b.text;
    // La phrase du séquencier devient le résumé de la scène (sa note ne passe pas).
    let k = i + 1;
    while (b.type === 'heading' && k < blocks.length && blocks[k].type !== 'synopsis' && (blocks[k].type === 'note' || isEmptyBlock(blocks[k]))) k++;
    const phrase = b.type === 'heading' && isOutlinePhrase(blocks, k) ? blocks[k].text.trim() : '';
    out.push(fdxParagraph(type, text, attrs, phrase ? `<SceneProperties><Summary><Paragraph Type="General">${fdxRuns(phrase)}</Paragraph></Summary></SceneProperties>` : ''));
  });
  const tb = blocks.find((b) => b.type === 'title');
  const title = tb ? parseTitlePage(tb.text) : {};
  const tp: string[] = [];
  const centered = (t: string) => tp.push(fdxParagraph('General', t, ' Alignment="Center"'));
  const blank = (n: number) => {
    for (let k = 0; k < n; k++) tp.push('      <Paragraph Type="General"><Text></Text></Paragraph>');
  };
  if (Object.values(title).some((v) => v.trim())) {
    blank(18);
    if (title.Title) centered(title.Title.toLocaleUpperCase('fr'));
    blank(2);
    if (title.Credit) centered(title.Credit);
    blank(1);
    for (const a of (title.Author ?? '').split('\n').filter(Boolean)) centered(a);
    if (title.Source) {
      blank(2);
      for (const l of title.Source.split('\n').filter(Boolean)) centered(l);
    }
    blank(12);
    for (const l of [...(title.Contact ?? '').split('\n'), ...(title['Draft date'] ?? '').split('\n')].filter(Boolean)) tp.push(fdxParagraph('General', l));
  }
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    '  <Content>',
    ...out,
    '  </Content>',
    ...(tp.length ? ['  <TitlePage>', '    <Content>', ...tp.map((l) => `  ${l}`), '    </Content>', '  </TitlePage>'] : []),
    '  <PageLayout BackgroundColor="#FFFFFFFFFFFF" BottomMargin="72" BreakDialogueAndActionAtSentences="Yes" DocumentLeading="Normal" FooterMargin="36" ForegroundColor="#000000000000" HeaderMargin="36" TopMargin="72" UsesSmartQuotes="Yes">',
    '    <PageSize Height="11.69" Width="8.26"/>',
    '  </PageLayout>',
    '</FinalDraft>',
    '',
  ].join('\n');
}
