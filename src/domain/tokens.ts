import { capitalizeFirst, mergeKey } from './text';

export type TokenSep = ', ' | ' + ';

/** Découpe une saisie libre en jetons, en mémorisant le séparateur dominant. */
export function parseTokens(input: string): { tokens: string[]; sep: TokenSep } {
  const sep: TokenSep = input.includes('+') && !input.includes(',') ? ' + ' : ', ';
  const tokens = input
    .split(/[,+]/)
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0);
  return { tokens, sep };
}

/** Rendu d'export : jetons joints, majuscule initiale (« 3/4 Face, Hauteur regard »). */
export function renderTokens(tokens: readonly string[], sep: TokenSep = ', '): string {
  const clean = tokens.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  return capitalizeFirst(clean.join(sep));
}

export function tokensKey(tokens: readonly string[]): string {
  return tokens.map(mergeKey).join('|');
}

export function addToken(tokens: readonly string[], token: string): string[] {
  const t = token.replace(/\s+/g, ' ').trim();
  if (!t) return [...tokens];
  if (tokens.some((x) => mergeKey(x) === mergeKey(t))) return [...tokens];
  return [...tokens, t];
}

export function removeTokenAt(tokens: readonly string[], index: number): string[] {
  return tokens.filter((_, i) => i !== index);
}
