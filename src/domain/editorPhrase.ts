/**
 * La phrase du séquencier dans l'éditeur de scénario : le résumé « = » placé sous un en-tête
 * (`isOutlinePhrase`) n'est pas montré sur la feuille. Ces fonctions pures règlent ce qui le
 * contourne : curseur, jonction de deux blocs, Entrée en fin d'en-tête. Rien n'y est jamais perdu.
 */
import { isOutlinePhrase } from './outline';
import { isEmptyBlock, mergeWithNext, mergeWithPrevious, splitBlock, type Caret, type Edit, type SBlock, type ScriptDoc } from './screenplay';

/** Blocs cachés de l'éditeur : les phrases des séquences. */
export function outlinePhraseIds(blocks: readonly SBlock[]): Set<string> {
  const out = new Set<string>();
  blocks.forEach((b, i) => {
    if (b.type === 'synopsis' && isOutlinePhrase(blocks, i)) out.add(b.id);
  });
  return out;
}

/** Rang du bloc visible le plus proche de `i` dans un sens (`i` exclu), ou -1. */
export function visibleIndex(blocks: readonly SBlock[], i: number, dir: 1 | -1, hidden: ReadonlySet<string>): number {
  for (let k = i + dir; k >= 0 && k < blocks.length; k += dir) if (!hidden.has(blocks[k].id)) return k;
  return -1;
}

/** Un curseur posé dans un bloc caché va au bloc visible voisin (dans le sens du déplacement, sinon l'autre). */
export function visibleCaret(blocks: readonly SBlock[], c: Caret, hidden: ReadonlySet<string>, dir: 1 | -1 = 1): Caret {
  if (!hidden.has(c.id)) return c;
  const i = blocks.findIndex((b) => b.id === c.id);
  if (i < 0) return c;
  for (const d of [dir, -dir as 1 | -1]) {
    const k = visibleIndex(blocks, i, d, hidden);
    if (k >= 0) return { id: blocks[k].id, offset: d === 1 ? 0 : blocks[k].text.length };
  }
  return c;
}

/**
 * Retour arrière en début de bloc : le bloc rejoint le bloc visible qui le précède. Les blocs cachés
 * d'entre les deux sont mis de côté pendant la jonction, puis rendus à leur place (après le bloc
 * précédent s'il reste, sinon avant celui-ci).
 */
export function mergeBackwardVisible(doc: ScriptDoc, id: string, hidden: ReadonlySet<string>): Edit | null {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i <= 0) return null;
  const j = visibleIndex(doc.blocks, i, -1, hidden);
  if (j < 0) return null;
  if (j === i - 1) return mergeWithPrevious(doc, id);
  const kept = doc.blocks.slice(j + 1, i);
  const r = mergeWithPrevious({ ...doc, blocks: [...doc.blocks.slice(0, j + 1), ...doc.blocks.slice(i)] }, id);
  if (!r) return null;
  const blocks = r.doc.blocks.slice();
  const prevAt = blocks.findIndex((b) => b.id === doc.blocks[j].id);
  const at = prevAt >= 0 ? prevAt + 1 : Math.max(0, blocks.findIndex((b) => b.id === id));
  blocks.splice(at, 0, ...kept);
  return { doc: { ...r.doc, blocks }, caret: r.caret };
}

/** Suppr en fin de bloc : le bloc visible suivant rejoint celui-ci, par-dessus les blocs cachés. */
export function mergeForwardVisible(doc: ScriptDoc, id: string, hidden: ReadonlySet<string>): Edit | null {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const k = visibleIndex(doc.blocks, i, 1, hidden);
  if (k < 0) return null;
  if (k === i + 1) return mergeWithNext(doc, id);
  return mergeBackwardVisible(doc, doc.blocks[k].id, hidden);
}

/** Phrase de la séquence que ce bloc ouvre (en-tête, puis notes ou lignes vides) : son rang, ou -1. */
function phraseAfter(blocks: readonly SBlock[], i: number): number {
  for (let k = i + 1; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.type === 'note' || isEmptyBlock(b)) continue;
    return b.type === 'synopsis' && isOutlinePhrase(blocks, k) ? k : -1;
  }
  return -1;
}

/**
 * Entrée : comme `splitBlock` ; en fin d'en-tête, le nouveau bloc vient après la phrase (écrit entre
 * les deux, il ferait de la phrase un simple résumé).
 */
export function splitPastPhrase(doc: ScriptDoc, c: Caret): Edit {
  const r = splitBlock(doc, c);
  const i = r.doc.blocks.findIndex((b) => b.id === c.id);
  const b = r.doc.blocks[i];
  if (!b || b.type !== 'heading' || r.caret.id === c.id) return r;
  const ci = r.doc.blocks.findIndex((x) => x.id === r.caret.id);
  const created = r.doc.blocks[ci];
  if (ci !== i + 1 || !created || !isEmptyBlock(created)) return r;
  const p = phraseAfter(r.doc.blocks, ci);
  if (p < 0) return r;
  const blocks = r.doc.blocks.slice();
  blocks.splice(ci, 1);
  blocks.splice(p, 0, created);
  return { doc: { ...r.doc, blocks }, caret: r.caret };
}
