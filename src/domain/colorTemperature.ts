/**
 * Température de couleur d'une source → teinte. Seule couleur admise sur le plan au sol : celle de
 * la lumière, de l'orangé d'une bougie au bleuté d'un ciel couvert.
 *
 * La chromaticité est celle du corps noir (lieu de Planck, approximation de Kim et al., valable de
 * 1 667 à 25 000 K), passée en sRGB puis équilibrée sur un blanc de 5 000 K (D50, la lumière de
 * l'impression) : 3 200 K reste chaud, 5 600 K est neutre à légèrement froid, 6 500 K et au-delà
 * bleutés. Pour rester lisible en aplat translucide sur le plan, la teinte et la pureté physiques
 * sont gardées, la clarté est fixée par le thème et la pureté légèrement accentuée.
 */

/** Températures admises (K) : en dehors, la saisie est sans doute une faute de frappe. */
export const KELVIN_RANGE = [1000, 25000] as const;

/** Blanc de référence (K). */
const WHITE_K = 5000;

/** Clarté de la teinte : sur papier (le trait s'y multiplie) et sur l'encre (il s'y additionne). */
export const TONE_LIGHTNESS = { papier: 0.5, encre: 0.64 } as const;

/** Accentuation de la pureté, pour qu'un faisceau translucide se lise. */
const CHROMA_GAIN = 1.6;

export const kelvinValid = (k: number | undefined): k is number => typeof k === 'number' && Number.isFinite(k) && k >= KELVIN_RANGE[0] && k <= KELVIN_RANGE[1];

/** Chromaticité CIE 1931 (x, y) du corps noir à `k` kelvins. */
export function planckXy(k: number): [number, number] {
  const T = Math.min(25000, Math.max(1667, k));
  const t = 1e3 / T;
  const x = T <= 4000 ? -0.2661239 * t ** 3 - 0.2343589 * t ** 2 + 0.8776956 * t + 0.17991 : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  const y =
    T <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** sRGB linéaire (non borné) du corps noir, luminance 1. */
function linearRgb(k: number): [number, number, number] {
  const [x, y] = planckXy(k);
  const X = x / y;
  const Z = (1 - x - y) / y;
  return [3.2404542 * X - 1.5371385 - 0.4985314 * Z, -0.969266 * X + 1.8760108 + 0.041556 * Z, 0.0556434 * X - 0.2040259 + 1.0572252 * Z];
}

const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const WHITE = linearRgb(WHITE_K);

/**
 * Couleur de la lumière à `k` kelvins, telle que l'œil la voit sous un blanc de 5 000 K :
 * composantes sRGB de 0 à 255, la plus forte à 255.
 */
export function kelvinRgb(k: number): [number, number, number] {
  const c = linearRgb(k).map((v, i) => Math.max(0, v / WHITE[i]));
  const m = Math.max(...c) || 1;
  return c.map((v) => Math.round(gamma(v / m) * 255)) as [number, number, number];
}

const hex = (rgb: readonly number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Luminance relative d'une couleur sRGB (composantes de 0 à 1). */
const luminance = (rgb: readonly number[]) => 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);

/** TSL → RVB (teinte en sixièmes de tour, composantes de 0 à 1). */
function hsl(h: number, s: number, L: number): [number, number, number] {
  const c = (1 - Math.abs(2 * L - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/**
 * Teinte de la lumière, en hexadécimal : la teinte du corps noir, sa pureté accentuée, à la
 * luminance du gris de clarté `lightness` (0 à 1) ; toutes les températures pèsent donc autant à
 * l'œil, la bougie ne paraît pas plus pâle que le tungstène. À 5 000 K, ce gris même.
 */
export function kelvinTone(k: number, lightness: number): string {
  const [r, g, b] = kelvinRgb(k).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  let h = 0;
  if (chroma > 0) {
    if (max === r) h = ((g - b) / chroma + 6) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
  }
  const s = Math.min(1, chroma * CHROMA_GAIN);
  const grey = Math.min(1, Math.max(0, lightness));
  const target = luminance([grey, grey, grey]);
  // Clarté TSL qui donne la luminance du gris (la luminance croît avec la clarté).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hsl(h, s, mid)) < target) lo = mid;
    else hi = mid;
  }
  return hex(hsl(h, s, (lo + hi) / 2).map((v) => v * 255));
}

/** Teintes d'une source pour les deux thèmes ; rien sans température (ou hors bornes) : elle reste grise. */
export function lightTint(k: number | undefined): { papier: string; encre: string } | undefined {
  if (!kelvinValid(k)) return undefined;
  return { papier: kelvinTone(k, TONE_LIGHTNESS.papier), encre: kelvinTone(k, TONE_LIGHTNESS.encre) };
}
