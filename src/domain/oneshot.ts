import { newId } from './factory';
import { formatTc } from './timecode';
import { renderTokens } from './tokens';
import type { ColumnKey, ID, OneShotBeat, ProjectDoc } from './types';

/** Colonnes portées par les temps d'un plan-séquence (une ligne par temps dans la cellule). */
export const BEAT_COLUMNS: readonly ColumnKey[] = ['subject', 'value', 'angle', 'movement'];

export function isOneShot(doc: ProjectDoc, shotId: ID): boolean {
  return !!doc.shots[shotId]?.oneShot;
}

/** Transforme un plan en plan-séquence (le premier temps reprend le cadrage du plan), ou l'inverse. */
export function toggleOneShot(doc: ProjectDoc, shotId: ID): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  if (shot.oneShot) {
    const first = shot.oneShot.beats[0];
    if (first) Object.assign(shot, { value: first.value, subject: first.subject });
    delete shot.oneShot;
    return;
  }
  shot.oneShot = {
    beats: [
      { id: newId(), value: shot.value, subject: shot.subject, angle: renderTokens(shot.angle), movement: renderTokens(shot.movement, shot.movementSep) },
      { id: newId(), value: '', subject: '', angle: '', movement: '' },
    ],
  };
}

export function addBeat(doc: ProjectDoc, shotId: ID, after?: number): void {
  const beats = doc.shots[shotId]?.oneShot?.beats;
  if (!beats) return;
  const at = after === undefined ? beats.length : after + 1;
  beats.splice(at, 0, { id: newId(), value: '', subject: '', angle: '', movement: '' });
}

export function updateBeat(doc: ProjectDoc, shotId: ID, beatId: ID, patch: Partial<OneShotBeat>): void {
  const beat = doc.shots[shotId]?.oneShot?.beats.find((b) => b.id === beatId);
  if (beat) Object.assign(beat, patch);
}

export function removeBeat(doc: ProjectDoc, shotId: ID, beatId: ID): void {
  const os = doc.shots[shotId]?.oneShot;
  if (os && os.beats.length > 1) os.beats = os.beats.filter((b) => b.id !== beatId);
}

export function moveBeat(doc: ProjectDoc, shotId: ID, beatId: ID, delta: -1 | 1): void {
  const beats = doc.shots[shotId]?.oneShot?.beats;
  if (!beats) return;
  const i = beats.findIndex((b) => b.id === beatId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= beats.length) return;
  [beats[i], beats[j]] = [beats[j], beats[i]];
}

export interface BeatWindow {
  /** Le temps commence au plus tôt / au plus tard (s depuis le début du plan). */
  startMin: number;
  startMax: number;
  endMin: number;
  endMax: number;
}

export interface OneShotTiming {
  beats: BeatWindow[];
  min: number;
  max: number;
  /** Durée la plus probable et écart-type, chaque temps variant uniformément dans sa fourchette. */
  expected: number;
  sd: number;
}

/**
 * Minutage d'un plan-séquence : les fourchettes s'additionnent (bornes), et la dispersion se calcule
 * comme une somme de lois uniformes indépendantes : E = Σ (a+b)/2, σ = √Σ (b−a)²/12.
 * Un temps sans durée compte 0 ; un temps avec une seule borne est supposé fixe.
 */
export function oneShotTiming(beats: readonly OneShotBeat[]): OneShotTiming {
  let min = 0;
  let max = 0;
  let expected = 0;
  let variance = 0;
  const out: BeatWindow[] = [];
  for (const b of beats) {
    const a = b.minSec ?? b.maxSec ?? 0;
    const z = Math.max(a, b.maxSec ?? b.minSec ?? 0);
    out.push({ startMin: min, startMax: max, endMin: min + a, endMax: max + z });
    min += a;
    max += z;
    expected += (a + z) / 2;
    variance += (z - a) ** 2 / 12;
  }
  return { beats: out, min, max, expected, sd: Math.sqrt(variance) };
}

/** « 1:20 – 1:45 (≈ 1:32 ± 0:07) », ou une durée fixe. */
export function formatOneShotDuration(t: OneShotTiming): string {
  if (t.max === 0) return '';
  if (t.min === t.max) return formatTc(t.min);
  return `${formatTc(t.min)} – ${formatTc(t.max)} (≈ ${formatTc(Math.round(t.expected))} ± ${formatTc(Math.round(t.sd))})`;
}

/** Texte d'une colonne de plan-séquence : une ligne par temps, numérotée T1, T2… */
export function beatColumnText(beats: readonly OneShotBeat[], col: ColumnKey, label: (v: string) => string = (v) => v): string {
  return beats
    .map((b, i) => {
      const v = col === 'value' ? label(b.value) : col === 'subject' ? b.subject : col === 'angle' ? b.angle : b.movement;
      return `T${i + 1} ${v || '—'}`;
    })
    .join('\n');
}
