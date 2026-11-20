import { editableText, setCellText } from './cells';
import { COLUMN_DEFS, columnMenuLabel } from './columns';
import { parseFocalInput } from './focal';
import { sequenceNumber } from './numbering';
import { canon } from './text';
import { parseTokens } from './tokens';
import type { ActionBlock, ColumnKey, ID, ProjectDoc, Shot, ShotRule } from './types';

/**
 * Règles « si… alors… » du découpage.
 *
 * Une règle ne remplit qu'une cellule VIDE : ce qui est tapé l'emporte toujours. Quand plusieurs
 * règles visent la même cellule, la plus précise gagne (séquence avant projet, condition avant valeur
 * par défaut), puis la plus récente. Les valeurs ainsi prévues s'affichent en gris dans le tableau et
 * s'impriment comme des valeurs normales.
 */

/** Colonnes qu'une règle peut lire ou remplir. */
export const RULE_COLUMNS: readonly ColumnKey[] = ['subject', 'value', 'angle', 'movement', 'focal', 'aperture', 'sound', 'light', 'notes'];

const TOKENS: readonly ColumnKey[] = ['angle', 'movement'];

function same(col: ColumnKey, cell: string, wanted: string): boolean {
  if (!cell.trim() || !wanted.trim()) return false;
  if (TOKENS.includes(col)) {
    const have = parseTokens(cell).tokens.map(canon);
    return parseTokens(wanted).tokens.map(canon).every((t) => have.includes(t));
  }
  if (col === 'focal') return parseFocalInput(cell) !== undefined && parseFocalInput(cell) === parseFocalInput(wanted);
  return canon(cell) === canon(wanted);
}

const weight = (r: ShotRule) => (r.seqId ? 2 : 0) + (r.when ? 1 : 0);

/** Règle qui remplit cette cellule (vide) de ce plan, s'il y en a une. */
export function ruleFor(doc: ProjectDoc, shot: Shot, col: ColumnKey): ShotRule | undefined {
  const rules = doc.rules;
  if (!rules?.length || shot.oneShot || shot.interview) return undefined;
  if (editableText(doc, shot.id, col).trim()) return undefined;
  let best: ShotRule | undefined;
  rules.forEach((r) => {
    if (r.off || r.then.col !== col || !r.then.value.trim()) return;
    if (r.seqId && r.seqId !== shot.sequenceId) return;
    if (r.when && !same(r.when.col, editableText(doc, shot.id, r.when.col), r.when.value)) return;
    if (!best || weight(r) >= weight(best)) best = r;
  });
  return best;
}

export interface Effective {
  shot: Shot;
  block: ActionBlock | undefined;
  /** Colonnes remplies par une règle, et laquelle. */
  ruled: Map<ColumnKey, ShotRule>;
}

const cache = new WeakMap<ProjectDoc, Map<ID, Effective>>();

/** Le plan tel qu'il se lit : ses valeurs, complétées par les règles. */
export function effectiveShot(doc: ProjectDoc, shot: Shot): Effective {
  const block = doc.blocks[shot.actionBlockId];
  if (!doc.rules?.length) return { shot, block, ruled: new Map() };
  let byDoc = cache.get(doc);
  if (!byDoc) cache.set(doc, (byDoc = new Map()));
  const hit = byDoc.get(shot.id);
  if (hit && hit.shot.id === shot.id) return hit;
  const ruled = new Map<ColumnKey, ShotRule>();
  for (const col of RULE_COLUMNS) {
    const r = ruleFor(doc, shot, col);
    if (r) ruled.set(col, r);
  }
  let out: Effective = { shot, block, ruled };
  if (ruled.size) {
    // Copie du plan (et de son bloc) dans un document éphémère : les règles s'y écrivent comme une saisie.
    const s2: Shot = structuredClone(shot);
    const b2 = block ? structuredClone(block) : undefined;
    // Le document est figé : la copie se superpose (propriété propre), sans toucher à l'original.
    const over = <T,>(base: Record<ID, T>, id: ID, v: T): Record<ID, T> =>
      Object.defineProperty(Object.create(base) as Record<ID, T>, id, { value: v, writable: true, enumerable: true, configurable: true });
    const tmp: ProjectDoc = { ...doc, shots: over(doc.shots, shot.id, s2), blocks: b2 ? over(doc.blocks, b2.id, b2) : doc.blocks };
    for (const [col, r] of ruled) setCellText(tmp, shot.id, col, r.then.value);
    out = { shot: s2, block: b2, ruled };
  }
  byDoc.set(shot.id, out);
  return out;
}

/** La règle en une ligne : « Si Valeur = Insert, alors Focale = 100mm (séquence 3) ». */
export function ruleSentence(doc: ProjectDoc, r: ShotRule): string {
  const col = (c: ColumnKey) => (COLUMN_DEFS[c] ? columnMenuLabel(c) : c);
  const head = r.when ? `Si ${col(r.when.col)} = ${r.when.value}, alors` : 'Par défaut,';
  const scope = r.seqId && doc.sequences[r.seqId] ? ` (séquence ${sequenceNumber(doc, r.seqId)})` : '';
  return `${head} ${col(r.then.col)} = ${r.then.value}${scope}`;
}
