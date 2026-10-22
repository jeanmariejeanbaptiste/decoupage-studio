import type { Focal, Sensor } from './types';

export const SENSOR_CROP: Readonly<Record<Exclude<Sensor, 'custom'>, number>> = { FF: 1, S35: 1.5, APSC: 1.6, M43: 2 };

/** Rendu « 50mm » ou « 24 → 70mm » (zoom). */
export function formatFocal(f: Focal, zoom: boolean): string {
  if (zoom && f.from !== undefined && f.to !== undefined) return `${f.from} → ${f.to}mm`;
  if (f.from !== undefined) return `${f.from}mm`;
  if (zoom && f.to !== undefined) return `→ ${f.to}mm`;
  return '';
}

/** Angle de champ horizontal en degrés (capteur 36 mm de large × facteur de recadrage). */
export function horizontalFov(focalMm: number, crop = 1): number {
  return (2 * Math.atan(36 / (2 * focalMm * crop)) * 180) / Math.PI;
}

/** Angle de champ diagonal (diagonale plein format ≈ 43,27 mm). */
export function diagonalFov(focalMm: number, crop = 1): number {
  return (2 * Math.atan(Math.hypot(36, 24) / (2 * focalMm * crop)) * 180) / Math.PI;
}

export function fullFrameEquivalent(focalMm: number, crop: number): number {
  return Math.round(focalMm * crop * 10) / 10;
}

/** Lit une ouverture : « f/2.8 », « f2,8 », « T2.1 », « 2.8 ». */
export function parseAperture(s: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  return n >= 0.7 && n <= 64 ? n : undefined;
}

/** « f/2,8 ». */
export const formatAperture = (n: number | undefined) => (n ? `f/${String(n).replace('.', ',')}` : '');

export function parseFocalInput(s: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  return n > 0 ? n : undefined;
}

const SENSOR_NAMES: Readonly<Record<Sensor, string>> = { FF: 'plein format', S35: 'Super 35', APSC: 'APS-C', M43: 'Micro 4/3', custom: 'capteur personnalisé' };

/** Info-bulle de focale : angle de champ horizontal et diagonal, équivalent plein format (§5.4). */
export function focalTooltip(f: Focal, sensor: Sensor, crop: number): string {
  const lines: string[] = [];
  for (const mm of [f.from, f.to].filter((x): x is number => x !== undefined)) {
    const h = horizontalFov(mm, crop).toFixed(1).replace('.', ',');
    const d = diagonalFov(mm, crop).toFixed(1).replace('.', ',');
    let line = `${mm} mm : angle horizontal ${h}° · diagonal ${d}° (${SENSOR_NAMES[sensor]})`;
    if (crop !== 1) line += ` · équivalent plein format ${String(fullFrameEquivalent(mm, crop)).replace('.', ',')} mm (× ${String(crop).replace('.', ',')})`;
    lines.push(line);
  }
  return lines.join('\n');
}
