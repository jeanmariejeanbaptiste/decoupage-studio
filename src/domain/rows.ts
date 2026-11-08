import { computeMerges, type MergeMap, type MergeRow } from './merge';
import { formatAperture, formatFocal } from './focal';
import { deduceEquipment } from './equipment';
import { sequenceHeading, shotNumberLabel } from './numbering';
import { formatTc } from './timecode';
import { shotTcLabel, type Timing, shotOwnSec } from './timing';
import { renderTokens } from './tokens';
import { isZoom, valueLabel } from './vocabulary';
import { BEAT_COLUMNS, beatColumnText, beatSubLines, formatOneShotDuration, oneShotTiming } from './oneshot';
import type { ColumnKey, ID, ProjectDoc, Shot } from './types';

/** Valeur affichée (et exportée) d'une cellule. */
export function cellText(doc: ProjectDoc, timing: Timing, shot: Shot, col: ColumnKey, index: number): string {
  const block = doc.blocks[shot.actionBlockId];
  const settings = doc.project.settings;
  const beats = shot.oneShot?.beats;
  if (beats) {
    if (BEAT_COLUMNS.includes(col)) return beatColumnText(beats, col, (v) => valueLabel(v, settings.labelStyle));
    if (col === 'action') {
      const cues = beats.map((b, i) => (b.cue ? `T${i + 1} : ${b.cue}` : '')).filter(Boolean);
      const dur = formatOneShotDuration(oneShotTiming(beats));
      return [block?.text ?? '', cues.length ? `Repères — ${cues.join(' · ')}` : '', dur ? `Durée : ${dur}` : ''].filter(Boolean).join('\n');
    }
  }
  switch (col) {
    case 'sequence':
      return sequenceHeading(doc, shot.sequenceId);
    case 'number':
      return shotNumberLabel(doc, shot.id) || String(index + 1);
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
    case 'aperture':
      return formatAperture(shot.aperture);
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
  return shotOwnSec(doc, timing, shot.id);
}

/** Texte d'une cellule à l'export : un mouvement de caméra laissé vide s'écrit « Fixe ». */
export function exportCellText(doc: ProjectDoc, timing: Timing, shot: Shot, col: ColumnKey, index: number): string {
  const text = cellText(doc, timing, shot, col, index);
  // Institutionnel : le créneau de tournage accompagne le nom de la séquence.
  const slot = doc.sequences[shot.sequenceId]?.slot;
  if (col === 'sequence' && slot && doc.project.format === 'institutionnel') return `${text}\n${slot}`;
  return col === 'movement' && !text.trim() && !shot.oneShot ? 'Fixe' : text;
}

export function buildSequenceRows(doc: ProjectDoc, timing: Timing, seqId: ID, columns: readonly ColumnKey[], forExport = false): MergeRow[] {
  const text = forExport ? exportCellText : cellText;
  const seq = doc.sequences[seqId];
  if (!seq) return [];
  const shots = seq.shotIds.map((id) => doc.shots[id]).filter((s): s is Shot => !!s);
  return shots.map((shot, i) => {
    const row: MergeRow = {
      shotId: shot.id,
      blockId: shot.actionBlockId,
      mergeBreak: shot.mergeBreak,
      isolated: !!shot.oneShot,
      lines: shot.oneShot ? beatSubLines(shot.oneShot.beats, (v) => valueLabel(v, doc.project.settings.labelStyle)) : undefined,
      cells: Object.fromEntries(columns.map((c) => [c, text(doc, timing, shot, c, i)])),
    };
    // Plan d'interview : une ligne par caméra ; aucune fusion ne franchit son cadre.
    if (shot.interview) row.group = shot.interview.setupId;
    return row;
  });
}


export function sequenceMerges(
  doc: ProjectDoc,
  timing: Timing,
  seqId: ID,
  columns: readonly ColumnKey[],
  noMerge = false,
  forExport = false,
): { rows: MergeRow[]; merges: MergeMap } {
  const rows = buildSequenceRows(doc, timing, seqId, columns, forExport);
  const s = doc.project.settings;
  return { rows, merges: computeMerges(rows, columns, { neverMerge: s.neverMerge, tcMode: s.tcMode, tcGranularity: s.tcGranularity, noMerge }) };
}
