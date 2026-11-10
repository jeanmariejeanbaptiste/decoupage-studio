/** Formats d'image usuels (largeur : hauteur), du plus courant au plus spécifique. Chaque format se
 *  montre par son rapport et sa silhouette, sans description. */
export const ASPECT_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: '16:9', w: 16, h: 9 },
  { label: '1.85:1', w: 1.85, h: 1 },
  { label: '2.39:1', w: 2.39, h: 1 },
  { label: '2:1', w: 2, h: 1 },
  { label: '1.66:1', w: 1.66, h: 1 },
  { label: '4:3', w: 4, h: 3 },
  { label: '1:1', w: 1, h: 1 },
  { label: '4:5', w: 4, h: 5 },
  { label: '3:4', w: 3, h: 4 },
  { label: '9:16', w: 9, h: 16 },
];

export interface Aspect {
  w: number;
  h: number;
}

export const DEFAULT_ASPECT: Aspect = { w: 16, h: 9 };

/** Rapport largeur / hauteur, borné pour rester affichable. */
export function aspectRatio(a: Aspect | undefined): number {
  const r = a && a.w > 0 && a.h > 0 ? a.w / a.h : 16 / 9;
  return Math.min(5, Math.max(0.2, r));
}

/** Lit « 2.39:1 », « 16/9 », « 1,85 » ou « 4x3 ». */
export function parseAspect(input: string): Aspect | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:[:/x×]\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(input);
  if (!m) return null;
  const w = Number(m[1].replace(',', '.'));
  const h = m[2] ? Number(m[2].replace(',', '.')) : 1;
  return w > 0 && h > 0 ? { w, h } : null;
}

export function formatAspect(a: Aspect): string {
  return `${+a.w.toFixed(3)}:${+a.h.toFixed(3)}`;
}
