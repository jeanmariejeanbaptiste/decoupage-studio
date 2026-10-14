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

export function parseFocalInput(s: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  return n > 0 ? n : undefined;
}
