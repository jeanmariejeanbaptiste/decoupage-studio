/**
 * Ajustement léger des largeurs de colonnes à l'export : quand un mot ne déborde que d'une ou deux
 * lettres (« Secrétair / e »), sa colonne emprunte un peu de place aux colonnes qui en ont de reste
 * (leur texte tient sur une ligne sans remplir la largeur). Un débordement de trois lettres ou plus
 * garde son retour à la ligne : on ne bouscule pas la mise en page pour si peu de gain.
 */
export interface ColumnMeasure {
  key: string;
  /** Largeur actuelle (px). */
  width: number;
  /** Place manquante pour qu'aucun mot ne soit coupé à une ou deux lettres de sa fin (px), 0 sinon. */
  deficit: number;
  /** Place inoccupée, prêtable sans faire passer de texte à la ligne (px). */
  slack: number;
}

export function nudgeWidths(cols: readonly ColumnMeasure[]): Record<string, number> {
  const width: Record<string, number> = Object.fromEntries(cols.map((c) => [c.key, c.width]));
  const slack: Record<string, number> = Object.fromEntries(cols.map((c) => [c.key, Math.max(0, c.slack)]));
  // Les plus petits manques d'abord : ce sont ceux qu'on peut le plus sûrement combler.
  for (const need of [...cols].filter((c) => c.deficit > 0).sort((a, b) => a.deficit - b.deficit)) {
    const donors = cols.filter((c) => c.key !== need.key && slack[c.key] > 0 && !(c.deficit > 0));
    const available = donors.reduce((n, c) => n + slack[c.key], 0);
    if (available < need.deficit) continue;
    for (const d of donors) {
      const take = (need.deficit * slack[d.key]) / available;
      slack[d.key] -= take;
      width[d.key] -= take;
    }
    width[need.key] += need.deficit;
  }
  return width;
}

/**
 * Manque d'une colonne pour un mot : nul si le mot tient ; sinon la place qui manque, mais seulement
 * si la partie qui déborde fait au plus `maxTail` lettres.
 */
export function wordDeficit(prefixWidths: readonly number[], room: number, maxTail = 2): number {
  const total = prefixWidths[prefixWidths.length - 1] ?? 0;
  if (total <= room) return 0;
  const fitting = prefixWidths.filter((w) => w <= room).length;
  const tail = prefixWidths.length - fitting;
  return tail <= maxTail ? total - room : 0;
}
