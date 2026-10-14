/** Pics (valeur absolue maximale) d'un signal, regroupés en `buckets` colonnes, normalisés à 1. */
export function computePeaks(data: Float32Array, buckets: number): number[] {
  const n = Math.max(1, Math.floor(buckets));
  const size = data.length / n;
  const peaks = new Array<number>(n).fill(0);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let p = 0;
    for (let j = start; j < end && j < data.length; j++) {
      const v = Math.abs(data[j]);
      if (v > p) p = v;
    }
    peaks[i] = p;
    if (p > max) max = p;
  }
  return max > 0 ? peaks.map((p) => p / max) : peaks;
}

/** Position horizontale (0..width) → seconde entière de la piste. */
export function xToSec(x: number, width: number, durationSec: number): number {
  if (width <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, x / width)) * durationSec);
}

export function secToX(sec: number, width: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return (Math.max(0, Math.min(durationSec, sec)) / durationSec) * width;
}

/** Plage ordonnée à partir de deux positions de glissement (au moins une seconde). */
export function dragRange(a: number, b: number, durationSec: number): { in: number; out: number } {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo >= 1) return { in: lo, out: hi };
  return { in: lo, out: Math.min(durationSec, lo + 1) };
}

/** Graduations « jolies » pour une durée (toutes les 5, 10, 15, 30 ou 60 s…). */
export function ticks(durationSec: number, maxTicks = 12): number[] {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => durationSec / s <= maxTicks) ?? 600;
  const out: number[] = [];
  for (let t = 0; t <= durationSec; t += step) out.push(t);
  return out;
}
