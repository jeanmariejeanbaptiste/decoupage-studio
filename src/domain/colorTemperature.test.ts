import { describe, expect, it } from 'vitest';
import { kelvinRgb, kelvinTone, kelvinValid, lightTint, planckXy } from './colorTemperature';

/** Teinte (degrés) d'une couleur hexadécimale. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const c = max - Math.min(r, g, b);
  if (!c) return NaN;
  const h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return h * 60;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (rgb: number[]) => {
  const lin = rgb.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const warmth = (k: number) => {
  const [r, , b] = kelvinRgb(k);
  return r - b;
};

describe('température de couleur → teinte', () => {
  it('suit le lieu de Planck (points connus)', () => {
    // Illuminant A (2 856 K) : x 0,4476, y 0,4074 ; D65 est proche du corps noir à 6 504 K.
    const [xa, ya] = planckXy(2856);
    expect(xa).toBeCloseTo(0.4476, 2);
    expect(ya).toBeCloseTo(0.4074, 2);
    const [x6, y6] = planckXy(6504);
    expect(x6).toBeCloseTo(0.3135, 2);
    expect(y6).toBeCloseTo(0.3237, 2);
  });

  it('va de l’orangé de la bougie au bleuté, en passant par un blanc à 5 000 K', () => {
    expect(kelvinRgb(5000)).toEqual([255, 255, 255]);
    // Bougie : orangé franc, sans bleu.
    const candle = kelvinRgb(1900);
    expect(candle[0]).toBe(255);
    expect(candle[2]).toBeLessThan(40);
    // Tungstène : chaud ; 4 300 K : à peine chaud.
    expect(warmth(3200)).toBeGreaterThan(80);
    expect(warmth(4300)).toBeGreaterThan(15);
    expect(warmth(4300)).toBeLessThan(warmth(3200));
    // Lumière du jour : neutre à légèrement froide ; 6 500 K et au-delà bleutés.
    expect(warmth(5600)).toBeLessThan(0);
    expect(warmth(5600)).toBeGreaterThan(-40);
    expect(warmth(6500)).toBeLessThan(warmth(5600));
    expect(warmth(10000)).toBeLessThan(warmth(6500));
    // Monotone d'un bout à l'autre.
    const ks = [1900, 2700, 3200, 4300, 5600, 6500, 8000, 12000];
    for (let i = 1; i < ks.length; i++) expect(warmth(ks[i])).toBeLessThan(warmth(ks[i - 1]));
  });

  it('teinte à clarté fixe : orangée au tungstène, bleutée au-delà de 6 500 K, grise au blanc', () => {
    expect(hue(kelvinTone(1900, 0.5))).toBeGreaterThan(20);
    expect(hue(kelvinTone(1900, 0.5))).toBeLessThan(45);
    expect(hue(kelvinTone(3200, 0.5))).toBeGreaterThan(20);
    expect(hue(kelvinTone(3200, 0.5))).toBeLessThan(45);
    expect(hue(kelvinTone(8000, 0.5))).toBeGreaterThan(200);
    expect(hue(kelvinTone(8000, 0.5))).toBeLessThan(230);
    // Au blanc de référence : le gris de la clarté demandée.
    expect(Math.abs(channels(kelvinTone(5000, 0.5))[0] - 128)).toBeLessThanOrEqual(1);
    expect(new Set(channels(kelvinTone(5000, 0.64))).size).toBe(1);
    // Toutes les teintes ont la luminance de ce gris : la bougie ne paraît pas plus pâle que le tungstène.
    const grey = luminance(channels(kelvinTone(5000, 0.5)));
    for (const k of [1900, 3200, 5600, 12000]) expect(luminance(channels(kelvinTone(k, 0.5)))).toBeCloseTo(grey, 2);
  });

  it('sans température, ou hors bornes : pas de teinte (le faisceau reste gris)', () => {
    expect(lightTint(undefined)).toBeUndefined();
    expect(lightTint(32)).toBeUndefined();
    expect(lightTint(320000)).toBeUndefined();
    expect(lightTint(Number.NaN)).toBeUndefined();
    expect(kelvinValid(3200)).toBe(true);
    const t = lightTint(3200)!;
    expect(t.papier).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.encre).not.toBe(t.papier);
  });
});
