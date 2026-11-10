import { tcLast } from './columns';
import type { CheckCode, Issue } from './lint';
import { sequenceNumber, shotCode } from './numbering';
import type { ColumnKey, ID, ProjectDoc } from './types';

/**
 * Où mène un avertissement des vérifications : la page et l'endroit exact.
 * - `grid` : le découpage, sur le plan (cellules sélectionnées de `cols[0]` à la dernière) ou,
 *   sans plan, sur la séquence ;
 * - `registry` : le registre des séquences, sur la ligne de la séquence (durées estimée et calculée).
 */
export type CheckTarget =
  | { page: 'grid'; sequenceId: ID; shotId?: ID; cols: ColumnKey[] }
  | { page: 'registry'; tab: 'sequences'; sequenceId: ID };

type ShotCheck = Exclude<CheckCode, 'empty-sequence' | 'estimate-gap'>;

/** Colonnes de la grille où se règle chaque contrôle de plan, par ordre de préférence. */
const SHOT_COLUMNS: Readonly<Record<ShotCheck, readonly ColumnKey[]>> = {
  'zoom-focal': ['focal', 'movement'],
  'missing-value': ['value'],
  'missing-subject': ['subject'],
  'doc-open-wide': ['value'],
  'doc-close-wide': ['value'],
  drone: ['movement'],
  'stabilizer-safety': ['movement'],
  // Saute : toutes les colonnes comparées, d'un bloc.
  'jump-cut': ['subject', 'value', 'angle', 'movement'],
};

/** Plan visé : celui de l'avertissement ; pour un institutionnel à un seul plan d'illustration, ce plan-là. */
function targetShot(doc: ProjectDoc, issue: Issue): ID | undefined {
  if (issue.shotId) return doc.shots[issue.shotId] ? issue.shotId : undefined;
  if (issue.code !== 'doc-close-wide') return undefined;
  return doc.sequences[issue.sequenceId]?.shotIds.filter((id) => doc.shots[id] && !doc.shots[id].interview).at(-1);
}

export function checkTarget(doc: ProjectDoc, issue: Issue): CheckTarget {
  const sequenceId = issue.sequenceId;
  if (issue.code === 'estimate-gap') return { page: 'registry', tab: 'sequences', sequenceId };
  const shotId = issue.code === 'empty-sequence' ? undefined : targetShot(doc, issue);
  if (!shotId) return { page: 'grid', sequenceId, cols: [] };
  const shown = tcLast(doc.project.settings.gridColumns);
  const wanted = SHOT_COLUMNS[issue.code as ShotCheck];
  let cols = issue.code === 'jump-cut' ? shown.filter((c) => wanted.includes(c)) : wanted.filter((c) => shown.includes(c)).slice(0, 1);
  // Colonne masquée : la première cellule modifiable du plan, pour que la ligne reste sélectionnée.
  if (!cols.length) cols = [shown.find((c) => c !== 'sequence' && c !== 'number') ?? shown[0]];
  return { page: 'grid', sequenceId, shotId, cols };
}

/** Repère affiché sur la ligne : numéro du plan (« 2.3 ») ou de la séquence (« 2 »). */
export function checkPlace(doc: ProjectDoc, issue: Issue): string {
  const shotId = issue.code === 'empty-sequence' || issue.code === 'estimate-gap' ? undefined : targetShot(doc, issue);
  return shotId ? shotCode(doc, shotId) : String(sequenceNumber(doc, issue.sequenceId));
}
