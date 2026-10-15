/**
 * Commandes de la grille, partagées par le clavier, la barre d'outils et la palette.
 */
import { isEditable, editableText, setCellText } from '../../domain/cells';
import { recognizeCharacters } from '../../domain/characters';
import { shotCode, sequenceHeading } from '../../domain/numbering';
import {
  addCharacter,
  addSequence,
  addShotAfter,
  consecutiveRun,
  deleteSequence,
  deleteShot,
  duplicateShot,
  linkAction,
  moveSequence,
  moveShot,
  unlinkAction,
} from '../../domain/ops';
import type { ColumnKey, ID, ProjectDoc } from '../../domain/types';
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

/** « Créer le personnage “X” ? » — proposition non bloquante (§4.1). */
function proposeCharacter(subject: string) {
  const d = doc();
  const name = subject.trim();
  if (!d || !name || name.length > 32) return;
  if (recognizeCharacters(name, Object.values(d.characters)).length) return;
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
    const id = mutateDoc((x) => {
      const last = x.sequences[seqId].shotIds.at(-1);
      return last ? addShotAfter(x, last) : undefined;
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

export function duplicateCurrent(): void {
  const cur = currentShotId();
  if (!cur) return;
  select(mutateDoc((x) => duplicateShot(x, cur)));
}

export function deleteCurrentShots(): void {
  const d = doc();
  const ids = selectedShotIds();
  if (!d || ids.length === 0) return;
  const label = ids.length === 1 ? `Plan ${shotCode(d, ids[0])} supprimé` : `${ids.length} plans supprimés`;
  const row = ui().selection?.focus.row ?? 0;
  mutateDoc((x) => ids.forEach((id) => deleteShot(x, id)));
  const after = doc();
  if (after) {
    const total = after.project.sequenceIds.reduce((n, s) => n + (after.sequences[s]?.shotIds.length ?? 0), 0);
    const col = ui().selection?.focus.col ?? 'subject';
    ui().setSelection(total ? { row: Math.min(row, total - 1), col } : null);
  }
  ui().toast({ message: label, actionLabel: 'Annuler', action: undo });
}

/** Supprime un plan précis (bouton de la ligne), annulable. */
export function deleteShotById(shotId: ID): void {
  const d = doc();
  if (!d?.shots[shotId]) return;
  const label = `Plan ${shotCode(d, shotId)} supprimé`;
  mutateDoc((x) => deleteShot(x, shotId));
  ui().toast({ message: label, actionLabel: 'Annuler', action: undo });
}

/** Seuil à partir duquel la suppression d'une séquence demande une confirmation renforcée. */
export const BIG_SEQUENCE = 10;

export async function deleteSequenceOf(shotId?: ID, seqIdArg?: ID): Promise<void> {
  const d = doc();
  const id = shotId ?? currentShotId();
  const seqId = seqIdArg ?? (id ? d?.shots[id]?.sequenceId : undefined);
  if (!d || !seqId) return;
  const n = d.sequences[seqId].shotIds.length;
  const res = await ask({
    title: `Supprimer la séquence ${sequenceHeading(d, seqId)} ?`,
    body: `${n} plan${n > 1 ? 's' : ''} ser${n > 1 ? 'ont' : 'a'} supprimé${n > 1 ? 's' : ''}. L’opération reste annulable (⌘Z).`,
    confirmLabel: 'Supprimer la séquence',
    danger: true,
    checkbox: n >= BIG_SEQUENCE ? `Oui, je supprime ces ${n} plans` : undefined,
  });
  if (!res.ok) return;
  if (n >= BIG_SEQUENCE && !res.checked) {
    ui().toast({ message: 'Suppression annulée : cochez la case pour confirmer.', tone: 'warn' });
    return;
  }
  mutateDoc((x) => deleteSequence(x, seqId));
  ui().setSelection(null);
  ui().toast({ message: 'Séquence supprimée', actionLabel: 'Annuler', action: undo });
}

export function moveCurrentShot(delta: -1 | 1): void {
  const d = doc();
  const cur = currentShotId();
  if (!d || !cur) return;
  const seq = d.sequences[d.shots[cur].sequenceId];
  const i = seq.shotIds.indexOf(cur);
  const j = i + delta;
  if (j < 0 || j >= seq.shotIds.length) return;
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
export async function dropShot(shotId: ID, toSeqId: ID, toIndex: number): Promise<void> {
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
  const splits = mutateDoc((x) => moveShot(x, shotId, toSeqId, toIndex)) ?? 0;
  select(shotId);
  if (splits) notifySplit(splits);
}

export function linkSelection(): void {
  const d = doc();
  const ids = selectedShotIds();
  if (!d) return;
  if (ids.length < 2 || !consecutiveRun(d, ids)) {
    ui().toast({ message: 'Sélectionnez au moins deux plans consécutifs d’une même séquence.', tone: 'warn' });
    return;
  }
  mutateDoc((x) => linkAction(x, ids));
  ui().toast({ message: `Action liée sur ${ids.length} plans.`, actionLabel: 'Annuler', action: undo });
}

export function unlinkSelection(): void {
  const ids = selectedShotIds();
  if (ids.length === 0) return;
  mutateDoc((x) => unlinkAction(x, ids));
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
    const seq = x.sequences[x.shots[startShot].sequenceId];
    let idx = seq.shotIds.indexOf(startShot);
    for (const line of matrix) {
      if (idx >= seq.shotIds.length) addShotAfter(x, seq.shotIds[seq.shotIds.length - 1]);
      const shotId = seq.shotIds[idx];
      line.forEach((cell, j) => {
        const col = columns[c0 + j];
        if (col && isEditable(col)) setCellText(x, shotId, col, cell);
      });
      idx++;
    }
  });
  ui().toast({ message: `${matrix.length} ligne${matrix.length > 1 ? 's' : ''} collée${matrix.length > 1 ? 's' : ''}.`, actionLabel: 'Annuler', action: undo });
}
