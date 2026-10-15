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

export function linesToFountain(input: SourceLine[]): string {
  const lines = input.filter((l) => l.text.trim() && !PAGE_NOISE.test(l.text.trim()));
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
  return `${blocks.join('\n\n')}\n`;
}
