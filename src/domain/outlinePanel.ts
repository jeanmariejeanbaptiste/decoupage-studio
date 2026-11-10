/**
 * Onglet Séquences du panneau de Texte : lignes (parties et séquences) lues dans le texte, et
 * séquence retrouvée au moment d'écrire sa phrase (le texte a pu changer entre-temps).
 */
import { outlineOf, outlineSequences } from './outline';

export type PanelRow =
  | { kind: 'part'; key: string; title: string }
  | {
      kind: 'sequence';
      key: string;
      n: number;
      heading: string;
      phrase: string;
      page?: number;
      /** Rang parmi les séquences de même en-tête (pour la retrouver si les numéros ont bougé). */
      rank: number;
    };

/** Lignes du panneau : intertitres de partie et séquences, dans l'ordre du texte, avec la page imprimée. */
export function panelRows(source: string, pageOf: (n: number) => number | undefined = () => undefined): PanelRow[] {
  const seen = new Map<string, number>();
  return outlineOf(source).map((it, k): PanelRow => {
    if (it.kind === 'part') return { kind: 'part', key: `p${k}:${it.start}`, title: it.title };
    const page = pageOf(it.n);
    const heading = it.heading.toLocaleUpperCase('fr');
    const rank = seen.get(heading) ?? 0;
    seen.set(heading, rank + 1);
    return { kind: 'sequence', key: `s${it.n}`, n: it.n, heading, phrase: it.phrase, rank, ...(page !== undefined ? { page } : {}) };
  });
}

/**
 * Numéro, dans `source`, de la séquence affichée sous le numéro `n` avec cet en-tête (au rang `rank`
 * parmi celles qui le partagent) : le même si rien n'a bougé ; sinon celle de même en-tête et de même
 * rang, ou à défaut la plus proche ; `undefined` si l'en-tête a disparu.
 */
export function findSequence(source: string, n: number, heading: string, rank?: number): number | undefined {
  const key = heading.toLocaleUpperCase('fr');
  const same = outlineSequences(source).filter((x) => x.heading.toLocaleUpperCase('fr') === key);
  if (same.some((x) => x.n === n)) return n;
  if (rank !== undefined && same[rank]) return same[rank].n;
  return same.sort((a, b) => Math.abs(a.n - n) - Math.abs(b.n - n))[0]?.n;
}
