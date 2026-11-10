/**
 * Commandes de la grille, partagées par le clavier, la barre d'outils et la palette.
 */
import { isEditable, editableText, setCellText } from '../../domain/cells';
import { recognizeCharacters } from '../../domain/characters';
import { shotCode, sequenceHeading } from '../../domain/numbering';
import {
  addCharacter,
  addSequence,
  addShot,
  addShotAfter,
  consecutiveRun,
  deleteSequence,
  deleteShot,
  duplicateShot,
  interviewGroupOf,
  linkAction,
  moveSequence,
  moveShot,
  moveShotTo,
  unlinkAction, detachAction,
} from '../../domain/ops';
import type { ColumnKey, ID, ProjectDoc } from '../../domain/types';
import { detectInText } from '../../domain/breakdown';
import { shotsFromSequenceText } from '../../domain/scriptToShot';
import { fold } from '../../domain/text';
import { mutateDoc, undo, useProjectStore } from '../../store/projectStore';
import { useUi, type CellPos } from '../../store/uiStore';
import { ask } from '../../ui/dialogStore';

const doc = (): ProjectDoc | null => useProjectStore.getState().doc;
const ui = () => useUi.getState();

export function rowOfShot(d: ProjectDoc, shotId: ID): number {
  let row = 0;
  for (const seqId of d.project.sequenceIds) {
    const seq = d.sequences[seqId];
    if (!seq) continue;
    const i = seq.shotIds.indexOf(shotId);
    if (i >= 0) return row + i;
    row += seq.shotIds.length;
  }
  return -1;
}

export function shotAtRow(d: ProjectDoc, row: number): ID | undefined {
  let r = row;
  for (const seqId of d.project.sequenceIds) {
    const seq = d.sequences[seqId];
    if (!seq) continue;
    if (r < seq.shotIds.length) return seq.shotIds[r];
    r -= seq.shotIds.length;
  }
  return undefined;
}

function select(shotId: ID | undefined, col?: ColumnKey) {
  const d = doc();
  if (!d || !shotId) return;
  const row = rowOfShot(d, shotId);
  if (row < 0) return;
  const c = col ?? ui().selection?.focus.col ?? 'subject';
  ui().setSelection({ row, col: c });
}

export function currentShotId(): ID | undefined {
  const d = doc();
  const sel = ui().selection;
  if (!d || !sel) return undefined;
  return shotAtRow(d, sel.focus.row);
}

/** Plans couverts par la sélection courante (lignes). */
export function selectedShotIds(): ID[] {
  const d = doc();
  const sel = ui().selection;
  if (!d || !sel) return [];
  const r0 = Math.min(sel.anchor.row, sel.focus.row);
  const r1 = Math.max(sel.anchor.row, sel.focus.row);
  const out: ID[] = [];
  for (let r = r0; r <= r1; r++) {
    const id = shotAtRow(d, r);
    if (id) out.push(id);
  }
  return out;
}

export function commitCell(shotId: ID, col: ColumnKey, text: string): boolean {
  const d = doc();
  if (!d) return false;
  if (editableText(d, shotId, col) === text) return true;
  const ok = mutateDoc((x) => setCellText(x, shotId, col, text)) ?? false;
  if (!ok) {
    ui().toast({ message: 'Saisie non reconnue : la cellule n’a pas été modifiée.', tone: 'warn' });
    return false;
  }
  if (col === 'subject') proposeCharacter(text);
  return true;
}

/**
 * « Créer le personnage “X” ? » — proposition non bloquante (§4.1), seulement pour ce qui ressemble à
 * un nom de personne (« Léa », « Jean-Pierre » ; pas « Hall de gare », « Valise » ni « Main de Léa »).
 */
function proposeCharacter(subject: string) {
  const d = doc();
  if (!d) return;
  const names = subject
    .split(/\s*(?:,|\+|&|\bet\b)\s*/)
    .map((n) => n.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => {
    if (name.length > 32 || /\d/.test(name)) return false;
    const words = name.split(/\s+/);
    if (words.length > 3 || words.some((w) => !/^\p{Lu}/u.test(w))) return false;
    if (Object.keys(detectInText(name)).length) return false;
    if (Object.values(d.decors).some((x) => fold(x.name) === fold(name))) return false;
    return !recognizeCharacters(name, Object.values(d.characters)).length;
  });
  if (unknown.length !== 1) return;
  const name = unknown[0];
  ui().toast({
    message: `« ${name} » n’est pas dans la base des personnages.`,
    actionLabel: `Créer le personnage`,
    action: () => mutateDoc((x) => addCharacter(x, { name })),
  });
}

export function newShotBelow(): void {
  const d = doc();
  if (!d) return;
  const cur = currentShotId();
  if (!cur) {
    const seqId = d.project.sequenceIds.at(-1);
    if (!seqId) return newSequenceAfter();
    // Dernière séquence encore vide (scénario importé) : son premier plan.
    const id = mutateDoc((x) => {
      const last = x.sequences[seqId].shotIds.at(-1);
      return last ? addShotAfter(x, last) : addShot(x, seqId);
    });
    return select(id, 'subject');
  }
  const id = mutateDoc((x) => addShotAfter(x, cur));
  select(id, 'subject');
}

export function newSequenceAfter(): void {
  const d = doc();
  if (!d) return;
  const cur = currentShotId();
  const seqId = cur ? d.shots[cur]?.sequenceId : undefined;
  const index = seqId ? d.project.sequenceIds.indexOf(seqId) + 1 : d.project.sequenceIds.length;
  const newSeq = mutateDoc((x) => addSequence(x, index));
  const first = newSeq ? useProjectStore.getState().doc?.sequences[newSeq]?.shotIds[0] : undefined;
  select(first, 'sequence');
}

/** Insère un plan juste sous ce plan (bouton entre les lignes). */
export function insertShotAfter(shotId: ID): void {
  select(mutateDoc((x) => addShotAfter(x, shotId)), 'subject');
}

/** Insère un plan en tête ou en fin de séquence (lignes « + plan »). */
export function insertShotAt(seqId: ID, index: number): void {
  select(mutateDoc((x) => addShot(x, seqId, { index })), 'subject');
}

/** La grille reprend le focus (après un bouton qui disparaît) : la saisie peut commencer aussitôt. */
function focusGrid() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="grid"]')?.focus({ preventScroll: true }));
}

/** Premier plan d'une séquence vide. */
export function addFirstShot(seqId: ID): void {
  insertShotAt(seqId, 0);
  focusGrid();
}

/** Plans d'une séquence créés d'un coup depuis son texte (un par paragraphe d'action et par réplique). */
export function shotsFromText(seqId: ID): void {
  const d = doc();
  if (!d) return;
  const dialogueShown = d.project.settings.gridColumns.includes('dialogue');
  const ids = mutateDoc((x) => shotsFromSequenceText(x, seqId, { dialogueShown }));
  select(ids?.[0], 'subject');
  focusGrid();
}

/** Insère une séquence à cette position (bouton entre les séquences). */
export function insertSequenceAt(index: number): void {
  const newSeq = mutateDoc((x) => addSequence(x, index));
  select(newSeq ? useProjectStore.getState().doc?.sequences[newSeq]?.shotIds[0] : undefined, 'sequence');
}

export function duplicateCurrent(): void {
  const cur = currentShotId();
  if (!cur) return;
  select(mutateDoc((x) => duplicateShot(x, cur)));
}

export function deleteCurrentShots(): void {
  const d = doc();
  const ids = selectedShotIds();
  if (!d || ids.length === 0) return;
  const row = ui().selection?.focus.row ?? 0;
  mutateDoc((x) => ids.forEach((id) => deleteShot(x, id)));
  const after = doc();
  if (after) {
    const total = after.project.sequenceIds.reduce((n, s) => n + (after.sequences[s]?.shotIds.length ?? 0), 0);
    const col = ui().selection?.focus.col ?? 'subject';
    ui().setSelection(total ? { row: Math.min(row, total - 1), col } : null);
  }
}

/** Supprime un plan précis (bouton de la ligne), annulable. */
export function deleteShotById(shotId: ID): void {
  const d = doc();
  if (!d?.shots[shotId]) return;
  mutateDoc((x) => deleteShot(x, shotId));
}

/** Seuil à partir duquel la suppression d'une séquence demande une confirmation renforcée. */
export const BIG_SEQUENCE = 10;

export async function deleteSequenceOf(shotId?: ID, seqIdArg?: ID): Promise<void> {
  const d = doc();
  const id = shotId ?? currentShotId();
  const seqId = seqIdArg ?? (id ? d?.shots[id]?.sequenceId : undefined);
  if (!d || !seqId) return;
  const n = d.sequences[seqId].shotIds.length;
  // Garde-fou seulement pour les séquences volumineuses ; sinon suppression directe, annulable.
  if (n >= BIG_SEQUENCE) {
    const label = d.sequences[seqId].label.trim();
    const res = await ask({
      title: `Supprimer la séquence ${d.project.sequenceIds.indexOf(seqId) + 1}${label ? `, ${label.toUpperCase()}` : ''} ?`,
      body: `${n} plans seront supprimés. L’opération reste annulable (⌘Z).`,
      confirmLabel: 'Supprimer la séquence',
      danger: true,
      checkbox: `Oui, je supprime ces ${n} plans`,
    });
    if (!res.ok) return;
    if (!res.checked) {
      ui().toast({ message: 'Suppression annulée : cochez la case pour confirmer.', tone: 'warn' });
      return;
    }
  }
  // La sélection reste à la même hauteur : premier plan de la séquence qui prend la place.
  const order = d.project.sequenceIds;
  const i = order.indexOf(seqId);
  mutateDoc((x) => deleteSequence(x, seqId));
  const after = doc();
  const next = after ? (after.project.sequenceIds[i] ?? after.project.sequenceIds[i - 1]) : undefined;
  const shot = next ? after?.sequences[next]?.shotIds[0] : undefined;
  ui().setSelection(after && shot ? { row: rowOfShot(after, shot), col: 'subject' } : null);
}

export function moveCurrentShot(delta: -1 | 1): void {
  const d = doc();
  const cur = currentShotId();
  if (!d || !cur) return;
  const seq = d.sequences[d.shots[cur].sequenceId];
  // Un cadre d'interview se déplace d'un bloc, et un plan voisin le franchit d'un seul pas.
  const own = interviewGroupOf(d, cur).filter((id) => seq.shotIds.includes(id));
  const i = seq.shotIds.indexOf(delta < 0 ? own[0] : own[own.length - 1]);
  let j = i + delta;
  if (j < 0 || j >= seq.shotIds.length) return;
  const near = interviewGroupOf(d, seq.shotIds[j]).filter((id) => seq.shotIds.includes(id));
  if (own.length === 1 && near.length > 1) j = seq.shotIds.indexOf(delta < 0 ? near[0] : near[near.length - 1]);
  const splits = mutateDoc((x) => moveShot(x, cur, seq.id, j)) ?? 0;
  select(cur);
  if (splits) notifySplit(splits);
}

export function notifySplit(n: number) {
  ui().toast({
    message: n > 1 ? `${n} actions liées ont été scindées.` : 'L’action liée a été scindée en deux.',
    actionLabel: 'Annuler',
    action: undo,
  });
}

export function moveCurrentSequence(delta: -1 | 1): void {
  const d = doc();
  const cur = currentShotId();
  if (!d || !cur) return;
  const seqId = d.shots[cur].sequenceId;
  const i = d.project.sequenceIds.indexOf(seqId);
  const j = i + delta;
  if (j < 0 || j >= d.project.sequenceIds.length) return;
  mutateDoc((x) => moveSequence(x, seqId, j));
  select(cur);
}

/** Déplacement par glisser-déposer, avec garde-fou entre séquences (§4.5). */
/** Dépose un plan glissé ; `among` : la place est comptée parmi les plans qui restent dans la séquence. */
export async function dropShot(shotId: ID, toSeqId: ID, toIndex: number, among = false): Promise<void> {
  const d = doc();
  if (!d) return;
  const shot = d.shots[shotId];
  if (!shot) return;
  if (shot.sequenceId !== toSeqId && !ui().skipCrossSequenceConfirm) {
    const res = await ask({
      title: `Déplacer le plan ${shotCode(d, shotId)} vers la séquence ${sequenceHeading(d, toSeqId)} ?`,
      body: 'Son action liée sera détachée.',
      confirmLabel: 'Déplacer',
      checkbox: 'Ne plus demander pour cette session',
    });
    if (!res.ok) return;
    if (res.checked) ui().set({ skipCrossSequenceConfirm: true });
  }
  const splits = mutateDoc((x) => (among ? moveShotTo : moveShot)(x, shotId, toSeqId, toIndex)) ?? 0;
  select(shotId);
  if (splits) notifySplit(splits);
}

/** Plans sélectionnés hors caméras d'interview (leur action commune suit la fiche, elle ne se lie ni ne se délie). */
function linkableIds(d: ProjectDoc): ID[] {
  return selectedShotIds().filter((id) => !d.shots[id]?.interview);
}

export function linkSelection(): void {
  const d = doc();
  if (!d) return;
  const all = selectedShotIds();
  const ids = linkableIds(d);
  if (all.length && !ids.length) return;
  if (ids.length < 2 || !consecutiveRun(d, ids)) {
    ui().toast({ message: 'Sélectionnez au moins deux plans consécutifs d’une même séquence.', tone: 'warn' });
    return;
  }
  mutateDoc((x) => linkAction(x, ids));
}

/** « Délier » : une action entièrement sélectionnée est déliée ; sinon seuls les plans sélectionnés s'en détachent. */
export function unlinkSelection(): void {
  const d = doc();
  const ids = d ? linkableIds(d) : [];
  if (ids.length === 0) return;
  mutateDoc((x) => {
    const picked = new Set(ids);
    const whole: ID[] = [];
    for (const id of ids) {
      const shot = x.shots[id];
      if (!shot) continue;
      const sharing = x.sequences[shot.sequenceId].shotIds.filter((o) => x.shots[o]?.actionBlockId === shot.actionBlockId);
      if (sharing.every((o) => picked.has(o))) whole.push(id);
      else detachAction(x, id);
    }
    if (whole.length) unlinkAction(x, whole);
  });
}

/** ⌘⇧↓ : recopie la première cellule de la sélection vers le bas. */
export function fillDown(): void {
  const d = doc();
  const sel = ui().selection;
  if (!d || !sel) return;
  const col = sel.anchor.col;
  if (!isEditable(col)) return;
  const ids = selectedShotIds();
  if (ids.length < 2) return;
  const text = editableText(d, ids[0], col);
  mutateDoc((x) => ids.slice(1).forEach((id) => setCellText(x, id, col, text)));
}

export function clearSelection(cols: readonly ColumnKey[]): void {
  const ids = selectedShotIds();
  const editable = cols.filter((c) => isEditable(c) && c !== 'sequence');
  if (!ids.length || !editable.length) return;
  mutateDoc((x) => ids.forEach((id) => editable.forEach((c) => setCellText(x, id, c, ''))));
}

/** Colle une matrice TSV à partir de la cellule active, en créant les plans manquants. */
export function pasteMatrix(matrix: string[][], start: CellPos, columns: readonly ColumnKey[]): void {
  const d = doc();
  if (!d || matrix.length === 0) return;
  const startShot = shotAtRow(d, start.row);
  if (!startShot) return;
  const c0 = columns.indexOf(start.col);
  mutateDoc((x) => {
    // Comme dans un tableur : les lignes collées suivent l'ordre de la grille, séquence après
    // séquence ; au-delà du dernier plan, de nouveaux plans s'ajoutent à la fin de la dernière séquence.
    const order = x.project.sequenceIds.flatMap((id) => x.sequences[id]?.shotIds ?? []);
    let idx = order.indexOf(startShot);
    for (const line of matrix) {
      if (idx >= order.length) order.push(addShotAfter(x, order[order.length - 1]));
      const shotId = order[idx];
      line.forEach((cell, j) => {
        const col = columns[c0 + j];
        if (col && isEditable(col)) setCellText(x, shotId, col, cell);
      });
      idx++;
    }
  });
}
