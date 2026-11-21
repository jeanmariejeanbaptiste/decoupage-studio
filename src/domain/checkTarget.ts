import { isEditable } from './cells';
import { tcLast } from './columns';
import { groupChecks, type CheckCode, type Issue } from './lint';
import { sequenceNumber, shotCode } from './numbering';
import { BEAT_COLUMNS } from './oneshot';
import type { ColumnKey, ID, ProjectDoc } from './types';

/**
 * Où mène un avertissement des vérifications : la page et l'endroit exact.
 * - `grid` : le découpage. Avec `shotId`, le plan (jusqu'à `lastShotId` pour une série) : les
 *   cellules de `cols` sont sélectionnées ; `cols` vide (colonne masquée) : la ligne entière. Sans
 *   plan : la séquence elle-même (séquence sans plan). `edit` : une seule cellule à remplir, ouverte
 *   en saisie comme par un double-clic.
 * - `seq-head` : l'en-tête de la séquence dans le découpage, sa durée estimée en saisie.
 * - `interview` : un plan d'interview (institutionnel) se règle dans sa fiche, sur sa caméra.
 */
export type CheckTarget =
  | { page: 'grid'; sequenceId: ID; shotId?: ID; lastShotId?: ID; cols: ColumnKey[]; edit?: true }
  | { page: 'seq-head'; sequenceId: ID; field: 'estimate' }
  | { page: 'interview'; sequenceId: ID; shotId: ID; subjectId: ID; setupId: ID; cameraId: ID; field?: InterviewField };

/** Champ d'une caméra de la fiche d'interview. */
export type InterviewField = 'value' | 'angle' | 'focal';

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
  'angle-conflict': ['angle'],
  // Saute : toutes les colonnes comparées, d'un bloc.
  'jump-cut': ['subject', 'value', 'angle', 'movement'],
};

/** Champ de la fiche d'interview qui porte le contrôle (le sujet vient du nom de l'intervenant). */
const INTERVIEW_FIELDS: Partial<Record<CheckCode, InterviewField>> = {
  'missing-value': 'value',
  'doc-open-wide': 'value',
  'doc-close-wide': 'value',
  'angle-conflict': 'angle',
  'zoom-focal': 'focal',
};

/** Plan visé : celui de l'avertissement ; pour un institutionnel à un seul plan d'illustration, ce plan-là. */
function targetShot(doc: ProjectDoc, issue: Issue): ID | undefined {
  if (issue.shotId) return doc.shots[issue.shotId] ? issue.shotId : undefined;
  if (issue.code !== 'doc-close-wide') return undefined;
  return doc.sequences[issue.sequenceId]?.shotIds.filter((id) => doc.shots[id] && !doc.shots[id].interview).at(-1);
}

export function checkTarget(doc: ProjectDoc, issue: Issue): CheckTarget {
  const sequenceId = issue.sequenceId;
  // Écart de durée : l'en-tête de la séquence, où la durée estimée se corrige.
  if (issue.code === 'estimate-gap') return { page: 'seq-head', sequenceId, field: 'estimate' };
  const shotId = issue.code === 'empty-sequence' ? undefined : targetShot(doc, issue);
  if (!shotId) return { page: 'grid', sequenceId, cols: [] };
  // Plan d'interview : il se règle dans sa fiche, pas dans la grille (qui y renvoie toute saisie).
  const link = doc.shots[shotId].interview;
  if (link && doc.project.format === 'institutionnel') {
    const field = INTERVIEW_FIELDS[issue.code];
    return { page: 'interview', sequenceId, shotId, ...link, ...(field ? { field } : {}) };
  }
  const shown = tcLast(doc.project.settings.gridColumns);
  const wanted = SHOT_COLUMNS[issue.code as ShotCheck];
  // Saute : les colonnes comparées dans l'ordre de la grille ; sinon la première visible. Aucune
  // visible (colonne masquée) : la ligne entière plutôt qu'une cellule sans rapport.
  const cols = issue.code === 'jump-cut' ? shown.filter((c) => wanted.includes(c)) : wanted.filter((c) => shown.includes(c)).slice(0, 1);
  // Une seule cellule à remplir : ouverte en saisie. Pas pour un rappel (rien n'y manque), ni pour une
  // cellule qui ne s'écrit pas ici (temps d'un plan-séquence, réglés dans son éditeur ; plan d'interview).
  const shot = doc.shots[shotId];
  const edit = issue.level === 'warn' && cols.length === 1 && isEditable(cols[0]) && !shot.interview && !(shot.oneShot && BEAT_COLUMNS.includes(cols[0]));
  return { page: 'grid', sequenceId, shotId, cols, ...(edit ? { edit: true as const } : {}) };
}

/** Repère affiché sur la ligne : numéro du plan (« 2.3 ») ou de la séquence (« 2 »). */
export function checkPlace(doc: ProjectDoc, issue: Issue): string {
  const shotId = issue.code === 'empty-sequence' || issue.code === 'estimate-gap' ? undefined : targetShot(doc, issue);
  return shotId ? shotCode(doc, shotId) : String(sequenceNumber(doc, issue.sequenceId));
}

/**
 * Nom de la séquence sur une ligne : son libellé ; sans libellé (import), INT/EXT et décor ; sinon
 * rien (la ligne montre alors un tiret estompé, comme la grille).
 */
export function sequenceName(doc: ProjectDoc, seqId: ID): string {
  const seq = doc.sequences[seqId];
  if (!seq) return '';
  if (seq.label.trim()) return seq.label.trim().toUpperCase();
  const decor = seq.decorId ? doc.decors[seq.decorId]?.name?.trim() : '';
  return [seq.intExt, decor].filter(Boolean).join(' ').toUpperCase();
}

/** Une ligne de la page des vérifications : un avertissement, ou une série de sautes. */
export interface CheckRow {
  key: string;
  issues: Issue[];
  /** Repère : « 2.3 », « 2 », ou « 4.1 – 4.6 » pour une série. */
  place: string;
  detail?: string;
  target: CheckTarget;
}

/** Plan qui précède celui-ci dans sa séquence. */
function previousShot(doc: ProjectDoc, shotId: ID): ID | undefined {
  const ids = doc.sequences[doc.shots[shotId]?.sequenceId ?? '']?.shotIds ?? [];
  const i = ids.indexOf(shotId);
  return i > 0 ? ids[i - 1] : undefined;
}

/**
 * Lignes d'un groupe de contrôles. Les sautes consécutives d'une séquence forment une seule série
 * (« 4.1 – 4.6 », 6 plans) : plutôt que cinq lignes « identique au plan précédent ».
 */
export function checkRows(doc: ProjectDoc, issues: readonly Issue[]): CheckRow[] {
  const rows: CheckRow[] = [];
  let run: { first: ID; last: ID; issues: Issue[] } | null = null;
  const flush = () => {
    if (!run) return;
    const r = run;
    run = null;
    const base = checkTarget(doc, r.issues[0]);
    const target: CheckTarget = base.page === 'grid' ? { page: 'grid', sequenceId: base.sequenceId, shotId: r.first, lastShotId: r.last, cols: base.cols } : base;
    const n = r.issues.length + 1;
    rows.push({ key: r.issues[0].id, issues: r.issues, place: `${shotCode(doc, r.first)}\u2009–\u2009${shotCode(doc, r.last)}`, detail: `${n} plans`, target });
  };
  for (const issue of issues) {
    const prev = issue.code === 'jump-cut' && issue.shotId && doc.shots[issue.shotId] ? previousShot(doc, issue.shotId) : undefined;
    if (prev) {
      if (run && run.last === prev) {
        run.issues.push(issue);
        run.last = issue.shotId!;
      } else {
        flush();
        run = { first: prev, last: issue.shotId!, issues: [issue] };
      }
      continue;
    }
    flush();
    rows.push({ key: issue.id, issues: [issue], place: checkPlace(doc, issue), detail: issue.detail, target: checkTarget(doc, issue) });
  }
  flush();
  return rows;
}

/** Nombre de lignes de la page des vérifications (une série de sautes compte pour une) : le compteur du menu. */
export function checkLineCount(doc: ProjectDoc, issues: readonly Issue[]): number {
  return groupChecks(issues).reduce((n, g) => n + checkRows(doc, g.issues).length, 0);
}
