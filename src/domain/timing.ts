import { countWords } from './text';
import { formatRange, formatTc, unionLength } from './timecode';
import type { ActionBlock, ID, ProjectDoc, ProjectSettings, TrackRange } from './types';

export interface BlockTiming {
  durationSec: number;
  manual: boolean;
  /** Plage affichée (cumulée en mode cumulatif, piste en mode piste). */
  range: TrackRange;
  label: string;
}

export interface SequenceTiming {
  durationSec: number;
  manual: boolean;
  range: TrackRange;
  label: string;
  estimatedSec?: number;
  gap?: Gap;
}

export interface Gap {
  sec: number;
  /** Écart relatif (calculé − estimé) / estimé, en %. */
  pct: number;
  level: 'ok' | 'warn' | 'bad';
}

export interface Timing {
  blocks: Map<ID, BlockTiming>;
  sequences: Map<ID, SequenceTiming>;
  totalSec: number;
  totalEstimatedSec: number;
  totalGap?: Gap;
  /** Mode piste : taux de couverture de la piste en %, plages fusionnées. */
  coveragePct?: number;
  trackSec?: number;
}

/** Durée calculée d'un bloc d'action (§6.2). */
export function blockDuration(block: Pick<ActionBlock, 'text' | 'dialogue' | 'overrideSec'>, settings: ProjectSettings): number {
  if (block.overrideSec !== undefined) return Math.max(0, Math.round(block.overrideSec));
  const raw =
    countWords(block.text) / settings.actionWordsPerSecond + countWords(block.dialogue) / settings.dialogueWordsPerSecond;
  return Math.round(Math.max(settings.minActionSeconds, raw));
}

/** Aperçu des réglages : « ce texte de 12 mots = 0:06 ». */
export function previewDuration(text: string, settings: ProjectSettings, asDialogue = false): { words: number; sec: number } {
  const block = asDialogue ? { text: '', dialogue: text } : { text };
  return { words: countWords(text), sec: blockDuration(block, settings) };
}

export function gapLevel(pct: number): Gap['level'] {
  const a = Math.abs(pct);
  if (a <= 10) return 'ok';
  if (a <= 25) return 'warn';
  return 'bad';
}

export function computeGap(calculated: number, estimated: number | undefined): Gap | undefined {
  if (estimated === undefined || estimated <= 0) return undefined;
  const sec = calculated - estimated;
  const pct = (sec / estimated) * 100;
  return { sec, pct, level: gapLevel(pct) };
}

/** Blocs d'action d'une séquence dans l'ordre d'apparition de leurs plans. */
export function orderedBlockIds(doc: ProjectDoc, seqId: ID): ID[] {
  const seq = doc.sequences[seqId];
  if (!seq) return [];
  const out: ID[] = [];
  for (const shotId of seq.shotIds) {
    const b = doc.shots[shotId]?.actionBlockId;
    if (b && doc.blocks[b] && !out.includes(b)) out.push(b);
  }
  return out;
}

function trackBounds(r: TrackRange | undefined, trackSec: number): [number, number] | undefined {
  if (!r) return undefined;
  if (r.all) return [0, trackSec];
  if (r.in !== undefined && r.out !== undefined) return [r.in, r.out];
  return undefined;
}

/** Minutage complet du projet (§6). Une action couverte par plusieurs plans n'est comptée qu'une fois. */
export function computeTiming(doc: ProjectDoc): Timing {
  const settings = doc.project.settings;
  const blocks = new Map<ID, BlockTiming>();
  const sequences = new Map<ID, SequenceTiming>();
  let totalEstimatedSec = 0;
  let anyEstimate = false;

  if (settings.tcMode === 'piste') {
    const allOuts: number[] = [];
    for (const b of Object.values(doc.blocks)) if (b.tc?.out !== undefined) allOuts.push(b.tc.out);
    const trackSec = settings.audioTrack?.durationSec ?? Math.max(0, ...allOuts);
    const everyRange: Array<[number, number]> = [];
    for (const seqId of doc.project.sequenceIds) {
      const seq = doc.sequences[seqId];
      if (!seq) continue;
      const ranges: Array<[number, number]> = [];
      for (const bId of orderedBlockIds(doc, seqId)) {
        const b = doc.blocks[bId];
        const bounds = trackBounds(b.tc, trackSec);
        if (bounds) ranges.push(bounds);
        blocks.set(bId, {
          durationSec: bounds ? bounds[1] - bounds[0] : 0,
          manual: true,
          range: b.tc ?? {},
          label: formatRange(b.tc),
        });
      }
      everyRange.push(...ranges);
      const durationSec = unionLength(ranges);
      const all = seq.shotIds.length > 0 && orderedBlockIds(doc, seqId).every((id) => doc.blocks[id].tc?.all);
      const range: TrackRange = all
        ? { all: true }
        : ranges.length
          ? { in: Math.min(...ranges.map((r) => r[0])), out: Math.max(...ranges.map((r) => r[1])) }
          : {};
      if (seq.estimatedSec !== undefined) {
        totalEstimatedSec += seq.estimatedSec;
        anyEstimate = true;
      }
      sequences.set(seqId, {
        durationSec,
        manual: false,
        range,
        label: formatRange(range),
        estimatedSec: seq.estimatedSec,
        gap: computeGap(durationSec, seq.estimatedSec),
      });
    }
    const covered = unionLength(everyRange);
    return {
      blocks,
      sequences,
      totalSec: trackSec,
      totalEstimatedSec,
      coveragePct: trackSec > 0 ? Math.min(100, (covered / trackSec) * 100) : 0,
      trackSec,
    };
  }

  let cursor = 0;
  for (const seqId of doc.project.sequenceIds) {
    const seq = doc.sequences[seqId];
    if (!seq) continue;
    const start = cursor;
    let blockCursor = cursor;
    let sum = 0;
    for (const bId of orderedBlockIds(doc, seqId)) {
      const b = doc.blocks[bId];
      const d = blockDuration(b, settings);
      const range = { in: blockCursor, out: blockCursor + d };
      blocks.set(bId, { durationSec: d, manual: b.overrideSec !== undefined, range, label: formatRange(range) });
      blockCursor += d;
      sum += d;
    }
    const manual = settings.tcGranularity === 'sequence' && seq.overrideSec !== undefined;
    const durationSec = manual ? Math.round(seq.overrideSec ?? 0) : sum;
    const range = { in: start, out: start + durationSec };
    cursor += durationSec;
    if (seq.estimatedSec !== undefined) {
      totalEstimatedSec += seq.estimatedSec;
      anyEstimate = true;
    }
    sequences.set(seqId, {
      durationSec,
      manual,
      range,
      label: formatRange(range),
      estimatedSec: seq.estimatedSec,
      gap: computeGap(durationSec, seq.estimatedSec),
    });
  }
  return {
    blocks,
    sequences,
    totalSec: cursor,
    totalEstimatedSec,
    totalGap: anyEstimate ? computeGap(cursor, totalEstimatedSec) : undefined,
  };
}

/** Libellé TC d'une ligne (plan) selon le mode et la granularité. */
export function shotTcLabel(doc: ProjectDoc, timing: Timing, shotId: ID): string {
  const shot = doc.shots[shotId];
  if (!shot) return '';
  const s = doc.project.settings;
  if (s.tcMode === 'cumulatif' && s.tcGranularity === 'sequence') return timing.sequences.get(shot.sequenceId)?.label ?? '';
  return timing.blocks.get(shot.actionBlockId)?.label ?? '';
}

export function formatGap(g: Gap): string {
  const sign = g.sec > 0 ? '+' : g.sec < 0 ? '−' : '±';
  return `${sign}${formatTc(Math.abs(g.sec))} (${sign}${Math.abs(Math.round(g.pct))} %)`;
}
