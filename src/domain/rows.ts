import { computeMerges, type MergeMap, type MergeRow } from './merge';
import { formatFocal } from './focal';
import { deduceEquipment } from './equipment';
import { sequenceHeading } from './numbering';
import { formatTc } from './timecode';
import { shotTcLabel, type Timing } from './timing';
import { renderTokens } from './tokens';
import { isZoom, valueLabel } from './vocabulary';
import type { ColumnKey, ID, ProjectDoc, Shot } from './types';

/** Valeur affichée (et exportée) d'une cellule. */
export function cellText(doc: ProjectDoc, timing: Timing, shot: Shot, col: ColumnKey, index: number): string {
  const block = doc.blocks[shot.actionBlockId];
  const settings = doc.project.settings;
  switch (col) {
    case 'sequence':
      return sequenceHeading(doc, shot.sequenceId);
    case 'number':
      return String(index + 1);
    case 'subject':
      return shot.subject;
    case 'value':
      return valueLabel(shot.value, settings.labelStyle);
    case 'angle':
      return renderTokens(shot.angle);
    case 'movement':
      return renderTokens(shot.movement, shot.movementSep);
    case 'focal':
      return formatFocal(shot.focal, isZoom(shot.movement));
    case 'action':
      return block?.text ?? '';
    case 'tc':
      return shotTcLabel(doc, timing, shot.id);
    case 'characters':
      return shot.characterIds.map((id) => doc.characters[id]?.name).filter(Boolean).join(', ');
    case 'dialogue':
      return block?.dialogue ?? '';
    case 'sound':
      return shot.sound ?? '';
    case 'light':
      return shot.light ?? '';
    case 'grip':
      return deduceEquipment(shot)
        .filter((i) => i.category === 'Machinerie')
        .map((i) => i.label)
        .join(', ');
    case 'shotDuration':
      return formatTc(shotDurationSec(doc, timing, shot));
    case 'shootingDay':
      return shot.shootingDay !== undefined ? `J${shot.shootingDay}` : '';
    case 'status':
      return shot.status;
    case 'notes':
      return shot.notes ?? '';
  }
}

/** Durée indicative d'un plan : durée de son action répartie entre les plans qui la couvrent. */
export function shotDurationSec(doc: ProjectDoc, timing: Timing, shot: Shot): number {
  const seq = doc.sequences[shot.sequenceId];
  const n = seq?.shotIds.filter((id) => doc.shots[id]?.actionBlockId === shot.actionBlockId).length ?? 1;
  return (timing.blocks.get(shot.actionBlockId)?.durationSec ?? 0) / Math.max(1, n);
}

export function buildSequenceRows(doc: ProjectDoc, timing: Timing, seqId: ID, columns: readonly ColumnKey[]): MergeRow[] {
  const seq = doc.sequences[seqId];
  if (!seq) return [];
  return seq.shotIds
    .map((id) => doc.shots[id])
    .filter((s): s is Shot => !!s)
    .map((shot, i) => ({
      shotId: shot.id,
      blockId: shot.actionBlockId,
      mergeBreak: shot.mergeBreak,
      cells: Object.fromEntries(columns.map((c) => [c, cellText(doc, timing, shot, c, i)])),
    }));
}

export function sequenceMerges(doc: ProjectDoc, timing: Timing, seqId: ID, columns: readonly ColumnKey[]): { rows: MergeRow[]; merges: MergeMap } {
  const rows = buildSequenceRows(doc, timing, seqId, columns);
  const s = doc.project.settings;
  return { rows, merges: computeMerges(rows, columns, { neverMerge: s.neverMerge, tcMode: s.tcMode, tcGranularity: s.tcGranularity }) };
}
