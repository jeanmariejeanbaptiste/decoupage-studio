/** Minuscules, sans accents, espaces réduits. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Forme canonique d'un terme de cadre pour la comparaison avec le vocabulaire. */
export function canon(s: string): string {
  return fold(s)
    .replace(/\btrav(?:e)?l(?:l)?ing\b/g, 'trav')
    .replace(/\./g, ' ')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clé de comparaison pour la fusion : sans casse ni espaces superflus. */
export function mergeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function capitalizeFirst(s: string): string {
  const i = s.search(/\p{L}/u);
  if (i !== 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function countWords(s: string | undefined): number {
  if (!s) return 0;
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
