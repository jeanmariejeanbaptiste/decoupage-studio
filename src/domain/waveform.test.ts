import { describe, expect, it } from 'vitest';
import { computePeaks, dragRange, secToX, ticks, xToSec } from './waveform';

describe('forme d’onde', () => {
  it('calcule des pics normalisés', () => {
    const data = new Float32Array([0, 0.5, -0.25, 0.1, -1, 0.2]);
    expect(computePeaks(data, 3)).toEqual([0.5, 0.25, 1]);
    expect(computePeaks(new Float32Array(4), 2)).toEqual([0, 0]);
    expect(computePeaks(new Float32Array([0.5]), 0)).toEqual([1]);
  });
  it('convertit positions et secondes', () => {
    expect(xToSec(50, 100, 180)).toBe(90);
    expect(xToSec(-10, 100, 180)).toBe(0);
    expect(xToSec(500, 100, 180)).toBe(180);
    expect(xToSec(10, 0, 180)).toBe(0);
    expect(secToX(90, 100, 180)).toBe(50);
    expect(secToX(10, 100, 0)).toBe(0);
  });
  it('ordonne la plage glissée', () => {
    expect(dragRange(40, 10, 180)).toEqual({ in: 10, out: 40 });
    expect(dragRange(10, 10, 180)).toEqual({ in: 10, out: 11 });
    expect(dragRange(180, 180, 180)).toEqual({ in: 180, out: 180 });
  });
  it('produit des graduations lisibles', () => {
    expect(ticks(181)).toEqual([0, 30, 60, 90, 120, 150, 180]);
    expect(ticks(10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ticks(100000).length).toBeGreaterThan(0);
  });
});
