import { detachAction } from './ops';
import { newId } from './factory';
import { formatTc } from './timecode';
import { renderTokens } from './tokens';
import type { SubLine } from './merge';
import type { ColumnKey, ID, OneShotBeat, ProjectDoc } from './types';

/** Colonnes portées par les temps d'un plan-séquence (une ligne par temps dans la cellule). */
export const BEAT_COLUMNS: readonly ColumnKey[] = ['subject', 'value', 'angle', 'movement', 'focal'];

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
  // Un plan-séquence porte sa propre action : il ne partage rien avec ses voisins.
  detachAction(doc, shotId);
  shot.oneShot = {
    beats: [
      { id: newId(), value: shot.value, subject: shot.subject, angle: renderTokens(shot.angle), movement: renderTokens(shot.movement, shot.movementSep), focal: shot.focal.from },
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

/** Déplace un temps à une nouvelle position (glisser-déposer). */
export function reorderBeat(doc: ProjectDoc, shotId: ID, beatId: ID, to: number): void {
  const beats = doc.shots[shotId]?.oneShot?.beats;
  if (!beats) return;
  const i = beats.findIndex((b) => b.id === beatId);
  if (i < 0 || to < 0 || to >= beats.length || i === to) return;
  const [b] = beats.splice(i, 1);
  beats.splice(to, 0, b);
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

/** Liaisons usuelles entre deux temps (proposées, la saisie reste libre). */
export const BRIDGE_PRESETS: readonly string[] = [
  'Panoramique gauche',
  'Panoramique droite',
  'Panoramique vertical',
  'Travelling latéral',
  'Travelling avant',
  'Travelling arrière',
  'Travelling circulaire',
  'Suivi du personnage',
  'Zoom avant',
  'Zoom arrière',
  'Bascule de point',
  'Recadrage',
  'Le sujet entre dans le champ',
  'Le sujet sort du champ',
];

/** Une liaison est attendue quand le sujet change d'un temps à l'autre. */
export const needsBridge = (a: OneShotBeat, b: OneShotBeat) => !!a.subject && !!b.subject && a.subject.trim() !== b.subject.trim();

/** Texte d'une colonne de plan-séquence : une ligne par temps, numérotée T1, T2… */
export function beatColumnText(beats: readonly OneShotBeat[], col: ColumnKey, label: (v: string) => string = (v) => v): string {
  return beats
    .map((b, i) => {
      const v = col === 'value' ? label(b.value) : col === 'subject' ? b.subject : col === 'angle' ? b.angle : col === 'focal' ? (b.focal ? `${b.focal}mm` : '') : b.movement;
      const line = `T${i + 1} ${v || '—'}`;
      return col === 'movement' && b.bridge && i + 1 < beats.length ? `${line}\n  ↳ ${b.bridge} → T${i + 2}` : line;
    })
    .join('\n');
}

/** Sous-lignes d'un plan-séquence : un temps par ligne, la liaison vers le suivant dans la colonne Mouvement. */
export function beatSubLines(beats: readonly OneShotBeat[], label: (v: string) => string = (v) => v): SubLine[] {
  return beats.flatMap((b, i) => {
    const line: SubLine = {
      tag: `T${i + 1}`,
      cells: { subject: b.subject, value: label(b.value), angle: b.angle, movement: b.movement, focal: b.focal ? `${b.focal}mm` : '' },
    };
    return b.bridge && i + 1 < beats.length ? [line, { tag: '↳', bridge: true, cells: { movement: b.bridge } }] : [line];
  });
}

/** Ce qui change entre deux temps consécutifs, pour l'équipe technique (en clair). */
export interface BeatTransition {
  from: number;
  to: number;
  notes: string[];
}

/**
 * Analyse des transitions d'un plan-séquence : resserrement ou élargissement du cadre (et comment :
 * zoom si la focale change, sinon déplacement de la caméra), changement de sujet, d'angle, de
 * mouvement, et déplacement mesuré de la caméra si sa position est placée temps par temps au plan au sol.
 */
export function beatTransitions(
  beats: readonly OneShotBeat[],
  rank: (value: string) => number,
  cameraAt?: (beat: number) => { x: number; y: number } | undefined,
): BeatTransition[] {
  const out: BeatTransition[] = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beats[i];
    const b = beats[i + 1];
    const notes: string[] = [];
    const ra = rank(a.value);
    const rb = rank(b.value);
    const zoom = a.focal && b.focal && a.focal !== b.focal;
    if (a.bridge) notes.push(`Liaison : ${a.bridge}`);
    else if (needsBridge(a, b)) notes.push('Liaison à préciser (panoramique, travelling, bascule de point…)');
    if (ra >= 0 && rb >= 0 && ra !== rb) {
      const how = zoom ? `zoom ${a.focal} → ${b.focal} mm` : 'la caméra ' + (rb > ra ? 'se rapproche' : 's’éloigne') + ' (focale inchangée)';
      notes.push(`Cadre ${rb > ra ? 'plus serré' : 'plus large'} (${a.value || '?'} → ${b.value || '?'}) : ${how}`);
    } else if (zoom) notes.push(`Focale ${a.focal} → ${b.focal} mm`);
    if (a.subject && b.subject && a.subject !== b.subject) notes.push(`Changement de sujet : ${a.subject} → ${b.subject}`);
    if (a.angle && b.angle && a.angle !== b.angle) notes.push(`Angle : ${a.angle} → ${b.angle}`);
    if (b.movement && b.movement !== a.movement) notes.push(`Mouvement : ${b.movement}`);
    const pa = cameraAt?.(i + 1);
    const pb = cameraAt?.(i + 2);
    if (pa && pb) {
      const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (d > 5) {
        const ang = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
        const dir = ['vers la droite', 'vers le bas du plan', 'vers la gauche', 'vers le haut du plan'][Math.round(((ang + 360) % 360) / 90) % 4];
        notes.push(`Déplacement caméra ≈ ${Math.round(d / 20)} carreaux ${dir}`);
      }
    }
    if (!notes.length) notes.push('Continuité : même cadrage, la scène évolue devant la caméra');
    out.push({ from: i + 1, to: i + 2, notes });
  }
  return out;
}
