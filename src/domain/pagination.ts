import type { ColumnKey } from './types';
import type { MergeMap, MergeSpan } from './merge';

/** Morceau d'une séquence posé sur une page : lignes [from, to[. */
export interface PageSlice {
  seq: number;
  from: number;
  to: number;
}

/**
 * Répartit les séquences sur des pages de hauteur `pageH`, sans jamais couper une ligne.
 * Une séquence tient entière sur une page si possible ; sinon elle est découpée, de préférence
 * là où aucune fusion ne la traverse (`cuttable[i]` : on peut couper avant la ligne i).
 * `gap` = hauteur du filet entre séquences ; `firstOffset` = place prise par le titre en page 1.
 */
export function paginate(rowHeights: number[][], pageH: number, opts: { gap?: number; firstOffset?: number; cuttable?: boolean[][] } = {}): PageSlice[][] {
  const gap = opts.gap ?? 0;
  const pages: PageSlice[][] = [[]];
  let used = opts.firstOffset ?? 0;
  const newPage = () => {
    pages.push([]);
    used = 0;
  };
  rowHeights.forEach((rows, seq) => {
    const total = rows.reduce((a, b) => a + b, 0) + gap;
    if (used > 0 && used + total > pageH && total <= pageH) newPage();
    let from = 0;
    while (from < rows.length || (rows.length === 0 && from === 0)) {
      if (rows.length === 0) {
        if (used > 0 && used + gap > pageH) newPage();
        pages[pages.length - 1].push({ seq, from: 0, to: 0 });
        used += gap;
        break;
      }
      // Combien de lignes tiennent dans la place restante ?
      let h = 0;
      let to = from;
      while (to < rows.length && used + h + rows[to] + (to === rows.length - 1 ? gap : 0) <= pageH) h += rows[to++];
      if (to === from) {
        if (used > 0) {
          newPage();
          continue;
        }
        to = from + 1; // ligne plus haute qu'une page : on la pose seule
      } else if (to < rows.length) {
        // Recule jusqu'à une coupure propre, si elle laisse au moins une ligne.
        const cut = opts.cuttable?.[seq];
        let k = to;
        while (cut && k > from + 1 && !cut[k]) k--;
        if (cut && cut[k]) to = k;
      }
      pages[pages.length - 1].push({ seq, from, to });
      used += rows.slice(from, to).reduce((a, b) => a + b, 0) + (to === rows.length ? gap : 0);
      from = to;
      if (from < rows.length) newPage();
    }
  });
  return pages.filter((p) => p.length);
}

/** Fusions restreintes aux lignes [from, to[, renumérotées depuis 0 (la valeur est répétée en haut de page). */
export function sliceMerges(merges: MergeMap, columns: readonly ColumnKey[], from: number, to: number): MergeMap {
  const out: MergeMap = new Map();
  for (const c of columns) {
    const list: MergeSpan[] = [];
    for (const m of merges.get(c) ?? []) {
      const a = Math.max(m.startRow, from);
      const b = Math.min(m.startRow + m.span, to);
      if (a < b) list.push({ ...m, startRow: a - from, span: b - a });
    }
    out.set(c, list);
  }
  return out;
}

/** Lignes avant lesquelles on peut couper sans traverser de fusion. */
export function cleanCuts(merges: MergeMap, columns: readonly ColumnKey[], rows: number): boolean[] {
  const ok = Array.from({ length: rows + 1 }, () => true);
  for (const c of columns) for (const m of merges.get(c) ?? []) for (let i = m.startRow + 1; i < m.startRow + m.span; i++) ok[i] = false;
  return ok;
}
