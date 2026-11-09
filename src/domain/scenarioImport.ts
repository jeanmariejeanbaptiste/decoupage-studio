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
  /** Page du document d'origine (PDF), à partir de 1. */
  page?: number;
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

/** Ouverture du film : la page de garde s'arrête avant (« FADE IN: », « OUVERTURE AU NOIR »…). */
const OPENING = /^(?:FADE IN|FONDU (?:D['’]OUVERTURE|AU NOIR|ENCHAÎNÉ)|OUVERTURE(?: AU NOIR| EN FONDU)?|NOIR)\s*[.:]?$/i;
const CREDIT = /^(écrit|ecrit|scénario|scenario|written|screenplay|un film|réalisé|realise|réalisation|d['’]après|based|adapt|story by|histoire|auteur|par\b|by\b)/i;
const DATE = /\b(19|20)\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|^(version|v\d|draft|brouillon|révision|revision|copie|tirage)/i;
const CONTACT = /@|\+?\d[\d .-]{7,}|\b(rue|avenue|bd|boulevard|chemin|place|allée|street|road)\b|\b\d{5}\b|©|tous droits|all rights|sacd|wga|agent|production/i;

/**
 * Page de garde reconnue au début d'un scénario importé. Chacun fait la sienne : plutôt qu'une forme
 * attendue, des indices s'additionnent — la première page d'un PDF sans séquence, une ouverture
 * (« FADE IN: ») qui la suit, un titre court, des crédits (« écrit par »…), une date ou une version,
 * des coordonnées, des lignes centrées, une page peu dense — et d'autres l'écartent : de la prose,
 * des répliques (un début de film dont on a oublié l'en-tête n'est pas une page de garde).
 * Rendue en clés Fountain.
 */
export function detectTitlePage(lines: readonly SourceLine[]): { title: Record<string, string>; used: number } | null {
  const text = (l: SourceLine | undefined) => (l?.text ?? '').trim();
  const firstHeading = lines.findIndex((l) => isHeadingLine(text(l)));
  // Zone examinée : la première page d'un PDF si aucune séquence n'y commence, sinon ce qui précède la première séquence.
  let end = firstHeading >= 0 ? firstHeading : Math.min(lines.length, 14);
  let pageBased = false;
  if (lines[0]?.page !== undefined) {
    const p2 = lines.findIndex((l) => (l.page ?? 1) > (lines[0].page ?? 1));
    if (p2 > 0 && (firstHeading < 0 || firstHeading >= p2)) {
      end = Math.min(end, p2);
      pageBased = true;
    }
  }
  // Le film commence à son ouverture (ou à une transition) : la page de garde s'arrête avant.
  let opened = false;
  for (let i = 0; i < end; i++)
    if (OPENING.test(text(lines[i])) || TRANSITION.test(text(lines[i]))) {
      end = i;
      opened = true;
      break;
    }
  const zone = lines.slice(0, end).filter((l) => text(l));
  if (!zone.length) return null;
  const head = zone.map(text);

  let score = 0;
  if (pageBased) score += 2;
  if (opened) score += 2;
  if (head.some((h) => CREDIT.test(h))) score += 2;
  if (head.some((h) => DATE.test(h))) score += 1;
  if (head.some((h) => CONTACT.test(h))) score += 1;
  if (zone.filter((l) => l.center).length * 2 >= zone.length && zone.some((l) => l.center)) score += 1;
  if (head.length <= 12) score += 1;
  const lead = head[0];
  if (lead.length <= 60 && !/[.!?…]$/.test(lead) && (lead === lead.toLocaleUpperCase('fr') || zone[0].center)) score += 1;
  // Ce qui ressemble au film lui-même.
  if (head.some((h) => h.length > 120)) score -= 3;
  if (!pageBased && head.length > 25) score -= 2;
  const cue = (i: number) => {
    const h = head[i];
    const next = head[i + 1];
    return !!next && h.length <= 30 && /\p{Lu}/u.test(h) && h === h.toLocaleUpperCase('fr') && !CREDIT.test(h) && !DATE.test(h) && /\p{Ll}/u.test(next) && /[.!?…]$/.test(next) && !CREDIT.test(next);
  };
  const cues = head.filter((_, i) => cue(i)).length;
  if (cues >= 2) score -= 3;
  else if (cues === 1 && !pageBased) score -= 1;
  if (score < (pageBased ? 3 : 4)) return null;

  const title: Record<string, string> = {};
  const contact: string[] = [];
  const source: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const t = head[i];
    if (!title.Title && !CREDIT.test(t) && !DATE.test(t) && !CONTACT.test(t)) {
      title.Title = t;
      continue;
    }
    if (/^(écrit|ecrit|scénario|scenario|written|screenplay|un film de|réalisé|realise|réalisation|story by|histoire|auteur|par\b|by\b)/i.test(t) && !title.Credit) {
      const m = /^(.*?\b(?:par|de|by))\s+(.+)$/i.exec(t);
      if (m) {
        title.Credit = m[1];
        title.Author = m[2];
      } else {
        title.Credit = t;
        if (head[i + 1] && !title.Author && !CONTACT.test(head[i + 1]) && !DATE.test(head[i + 1])) title.Author = head[++i];
      }
      continue;
    }
    if (/^(d['’]après|based on|adapt)/i.test(t)) source.push(t);
    else if (DATE.test(t) && !/@/.test(t) && !title['Draft date']) title['Draft date'] = t;
    else if (CONTACT.test(t)) contact.push(t);
    else if (!title.Author && title.Credit) title.Author = t;
    else source.push(t);
  }
  if (!title.Title) return null;
  if (contact.length) title.Contact = contact.join('\n');
  if (source.length) title.Source = source.join('\n');
  return { title, used: end };
}

/**
 * Page de garde restée dans le texte (scénario importé avant cette détection) : les blocs qui précèdent
 * la première séquence sont relus avec les mêmes indices. Renvoie les champs et les blocs à retirer.
 */
export function titleFromBlocks(blocks: ReadonlyArray<{ id: string; type: string; text: string }>): { title: Record<string, string>; ids: string[] } | null {
  if (blocks.some((b) => b.type === 'title')) return null;
  const lines: SourceLine[] = [];
  const owner: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading') break;
    for (const line of b.text.split('\n')) {
      if (!line.trim()) continue;
      lines.push({ text: line, center: b.type === 'centered' || b.type === 'character' });
      owner.push(b.id);
    }
  }
  const r = detectTitlePage(lines);
  if (!r) return null;
  const ids = [...new Set(owner.slice(0, r.used))].filter((id) => owner.lastIndexOf(id) < r.used);
  return ids.length ? { title: r.title, ids } : null;
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
