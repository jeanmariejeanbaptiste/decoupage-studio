/**
 * Conversion d'un scénario mis en page (PDF, Word, Markdown, texte) en Fountain.
 * Indices utilisés : en-têtes INT./EXT., répliques centrées ou en retrait, nom du personnage
 * en capitales au-dessus des répliques, parenthèses, transitions.
 */
export interface SourceLine {
  text: string;
  /** Retrait gauche relatif à la largeur de page (0 à 1). */
  x0?: number;
  /** Ligne centrée dans la page. */
  center?: boolean;
  /** Espace vertical marqué avant la ligne (paragraphe). */
  gapBefore?: boolean;
}

const HEADING = /^(?:\d+[A-Z]?[.)]?\s+)?((?:INT|EXT|EST|I\/E|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT)[.\s][^]*?)(?:\s+\d+[A-Z]?\.?)?$/i;
const TRANSITION = /^(?:[A-ZÀ-Ü' ]+ (?:TO|À)\s*:|FONDU (?:AU NOIR|ENCHAÎNÉ|AU BLANC)|CUT TO|COUPE(?: FRANCHE)?|ENCHAÎNÉ|FADE (?:IN|OUT|TO BLACK))[.:]?$/;
const PAGE_NOISE = /^(?:\d+\.?|page \d+(?: \/ \d+)?|\(?(?:suite|cont(?:'|’)?d|more|à suivre)\)?)$/i;

const isUpper = (s: string) => /\p{L}/u.test(s) && s === s.toLocaleUpperCase('fr');
const cueText = (s: string) => s.replace(/\(.*?\)/g, '').trim();

export function stripMarkdown(md: string): string {
  return md
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
        .replace(/^\s*[-*+]\s+/, ''),
    )
    .join('\n');
}

export function textToLines(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  let gap = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) {
      gap = true;
      continue;
    }
    const lead = raw.length - raw.trimStart().length;
    out.push({ text: raw.trim(), x0: Math.min(0.6, lead / 80), gapBefore: gap });
    gap = false;
  }
  return out;
}

/** Retrait des actions : le plus fréquent parmi les lignes non centrées. */
function baseIndent(lines: SourceLine[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) if (!l.center) counts.set(Math.round((l.x0 ?? 0) * 50), (counts.get(Math.round((l.x0 ?? 0) * 50)) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best ? best[0] / 50 : 0;
}

const isHeadingLine = (t: string) => HEADING.test(t) && /^(?:\d+[A-Z]?[.)]?\s+)?(int|ext|est|i\/e)/i.test(t);

/**
 * Page de garde reconnue avant la première séquence : titre, « écrit par » et auteur, d'après,
 * date, coordonnées. Rendue en clés Fountain ; rien si le début ressemble déjà à du texte de film.
 */
export function detectTitlePage(lines: readonly SourceLine[]): { title: Record<string, string>; used: number } | null {
  const first = lines.findIndex((l) => isHeadingLine(l.text.trim()));
  const head = (first < 0 ? lines.slice(0, 12) : lines.slice(0, first)).map((l) => l.text.trim()).filter(Boolean);
  if (!head.length || head.length > 16 || head.some((t) => t.length > 90 || TRANSITION.test(t))) return null;
  // Un début de scénario sans en-tête (action longue, répliques) n'est pas une page de garde.
  if (first < 0 && head.some((t) => t.length > 60)) return null;
  const title: Record<string, string> = {};
  const contact: string[] = [];
  const source: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const t = head[i];
    if (!title.Title && !/^(écrit|ecrit|scénario|scenario|written|un film|d['’]après|based)/i.test(t)) {
      title.Title = t;
      continue;
    }
    if (/^(écrit|ecrit|scénario|scenario|written|un film de|réalisé|realise)/i.test(t) && !title.Credit) {
      const m = /^(.*?\b(?:par|de|by))\s+(.+)$/i.exec(t);
      if (m) {
        title.Credit = m[1];
        title.Author = m[2];
      } else {
        title.Credit = t;
        if (head[i + 1] && !title.Author) title.Author = head[++i];
      }
      continue;
    }
    if (/^(d['’]après|based on|adapté)/i.test(t)) source.push(t);
    else if (/\b(19|20)\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|^(version|v\d|draft|brouillon)/i.test(t) && !/@/.test(t) && !title['Draft date']) title['Draft date'] = t;
    else if (/@|\+?\d[\d .-]{7,}|\b(rue|avenue|bd|boulevard|chemin|place)\b|\b\d{5}\b/i.test(t)) contact.push(t);
    else if (!title.Author && title.Credit) title.Author = t;
    else source.push(t);
  }
  if (!title.Title) return null;
  if (contact.length) title.Contact = contact.join('\n');
  if (source.length) title.Source = source.join('\n');
  return { title, used: first < 0 ? head.length : first };
}

/** Bloc de page de garde Fountain (« Clé: valeur », lignes suivantes en retrait). */
function titleBlock(title: Record<string, string>): string {
  return Object.entries(title)
    .map(([k, v]) => {
      const [firstLine, ...rest] = v.split('\n');
      return rest.length ? `${k}:\n${[firstLine, ...rest].map((x) => `    ${x}`).join('\n')}` : `${k}: ${firstLine}`;
    })
    .join('\n');
}

export function linesToFountain(input: SourceLine[]): string {
  const all = input.filter((l) => l.text.trim() && !PAGE_NOISE.test(l.text.trim()));
  const tp = detectTitlePage(all);
  const lines = tp ? all.slice(tp.used) : all;
  const base = baseIndent(lines);
  const indented = (l: SourceLine, by: number) => !!l.center || (l.x0 ?? 0) > base + by;
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const t = l.text.trim();
    const next = lines[i + 1];
    const h = HEADING.exec(t);
    if (h && isUpper(t.replace(/\d/g, '')) !== false && /^(?:\d+[A-Z]?[.)]?\s+)?(int|ext|est|i\/e)/i.test(t)) {
      blocks.push(h[1].trim().toLocaleUpperCase('fr'));
      i++;
      continue;
    }
    if (isUpper(t) && TRANSITION.test(t)) {
      blocks.push(`> ${t}`);
      i++;
      continue;
    }
    const cue = cueText(t);
    const looksCue =
      isUpper(cue) &&
      cue.length > 0 &&
      cue.length <= 38 &&
      !/[.!?;]$/.test(cue) &&
      next !== undefined &&
      !next.gapBefore &&
      !isUpper(next.text.trim().replace(/^\(.*\)$/, 'x')) &&
      (indented(l, 0.15) || base === 0 || !indented(next, -1));
    if (looksCue && (indented(l, 0.15) || (!l.center && (l.x0 ?? 0) === base && base === 0))) {
      const speech: string[] = [`@${t.replace(/^@/, '')}`];
      i++;
      let para: string[] = [];
      const flush = () => {
        if (para.length) speech.push(para.join(' '));
        para = [];
      };
      while (i < lines.length) {
        const d = lines[i];
        const dt = d.text.trim();
        if (d.gapBefore && i > 0) break;
        if (HEADING.test(dt) && /^(?:\d+[A-Z]?[.)]?\s+)?(int|ext|est|i\/e)/i.test(dt)) break;
        if (base > 0 && !indented(d, 0.05)) break;
        if (/^\(.*\)$/.test(dt)) {
          flush();
          speech.push(dt);
        } else para.push(dt);
        i++;
      }
      flush();
      blocks.push(speech.join('\n'));
      continue;
    }
    // Action : lignes consécutives réunies en paragraphe.
    const para = [t];
    i++;
    while (i < lines.length && !lines[i].gapBefore) {
      const a = lines[i].text.trim();
      if (HEADING.test(a) || (isUpper(cueText(a)) && cueText(a).length <= 38 && indented(lines[i], 0.15))) break;
      para.push(a);
      i++;
    }
    blocks.push(para.join(' ').replace(/^([A-ZÀ-Ü])/, '$1'));
  }
  return `${tp ? `${titleBlock(tp.title)}\n\n` : ''}${blocks.join('\n\n')}\n`;
}

/** Texte coupé en morceaux d'au plus `max` signes : entre deux phrases, sinon entre deux mots. */
function chunks(text: string, max: number): string[] {
  const parts = (text.match(/[^.!?…]+(?:[.!?…]+["»”’)]*\s*|$)/g) ?? [text]).flatMap((sn) => {
    if (sn.length <= max) return [sn];
    const words: string[] = [];
    let cur = '';
    for (const w of sn.split(/(?<=\s)/)) {
      if (cur && cur.length + w.length > max) {
        words.push(cur);
        cur = '';
      }
      cur += w;
    }
    return cur ? [...words, cur] : words;
  });
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > max) {
      out.push(cur.trim());
      cur = '';
    }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Paragraphe plus long qu'une page : coupé comme le ferait un logiciel d'écriture (sinon, à l'écran, il
 * déborderait de sa feuille). Action : entre deux phrases (≈ 2 000 signes) ; réplique : en plusieurs
 * répliques du même personnage, la suite marquée « (SUITE) ».
 */
export function splitLongActions(source: string, max = 2000): string {
  return source
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n');
      const first = lines[0].trim();
      const isCue = lines.length > 1 && (/^@/.test(first) || (/[A-ZÀ-Ü]/.test(first) && first === first.toLocaleUpperCase('fr') && !/^(INT|EXT|EST|I\/E)[.\s]/i.test(first)));
      if (isCue) {
        const body = lines.slice(1).join(' ');
        if (body.length <= max * 0.6) return para;
        // Réplique trop longue : 35 signes par ligne, environ 50 lignes par page.
        const cue = first.replace(/\s*\((?:SUITE|CONT'D)\)\s*$/i, '');
        return chunks(body, Math.round(max * 0.6))
          .map((c, i) => `${i ? `${cue} (SUITE)` : first}\n${c}`)
          .join('\n\n');
      }
      if (para.length <= max || /^(?:[A-Za-z ]+:|#|=|~|>|\[\[|\/\*)/.test(first)) return para;
      return chunks(para.replace(/\n/g, ' '), max).join('\n\n');
    })
    .join('\n\n');
}
