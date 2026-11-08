/**
 * Symboles du plan au sol, vus de dessus, dans le repère de l'objet : pivot à l'origine, axe du
 * faisceau (ou de l'objectif) vers +x. Une seule définition sert à l'écran et à l'export, pour que
 * le plan imprimé soit celui qu'on a dessiné.
 */

/** Rôle d'un tracé : fond papier et trait (corps), trait seul, ou aplat d'encre. */
export type SymbolRole = 'body' | 'stroke' | 'solid';

export interface SymbolShape {
  d: string;
  role: SymbolRole;
}

/** Rectangle à coins arrondis en tracé SVG. */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

/** Projecteur de cinéma (Fresnel) : boîtier, bague de lentille, volets coupe-flux ouverts, câble. */
export const FRESNEL: readonly SymbolShape[] = [
  { role: 'body', d: roundRect(-12, -9, 20, 18, 2.5) },
  { role: 'stroke', d: 'M8 -7.5h2.6v15H8' },
  { role: 'stroke', d: 'M10.6 -7.5L17 -13M10.6 7.5L17 13' },
  { role: 'stroke', d: 'M-12 0h-4' },
];

/** Caméra : boîtier, objectif et pare-soleil. */
export const CAMERA: readonly SymbolShape[] = [
  { role: 'solid', d: roundRect(-15, -9, 22, 18, 2.5) },
  { role: 'solid', d: 'M7 -5L13 -9v18l-6 -4z' },
  { role: 'solid', d: 'M13 -10.5h2.2v21H13z' },
];

/** Couleurs de l'export (papier blanc, encre). */
const EXPORT_STYLE: Record<SymbolRole, string> = {
  body: 'fill="#fff" stroke="#111318" stroke-width="1.3" stroke-linejoin="round"',
  stroke: 'fill="none" stroke="#111318" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"',
  solid: 'fill="#111318"',
};

/** Symbole en SVG autonome, posé et orienté sur le plan. */
export function symbolSvg(shapes: readonly SymbolShape[], x: number, y: number, rot: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">${shapes.map((s) => `<path d="${s.d}" ${EXPORT_STYLE[s.role]}/>`).join('')}</g>`;
}

/**
 * Rails de travelling : traverses sous deux rails fins (trois traits superposés), en SVG autonome.
 * `k` est l'épaisseur du trait choisie pour le plan.
 */
export function railSvg(x1: number, y1: number, x2: number, y2: number, k = 1): string {
  const line = (attrs: string) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrs}/>`;
  return [
    line(`stroke="#111318" stroke-width="${12 * k}" stroke-dasharray="${1.3 * k} ${7 * k}"`),
    line(`stroke="#111318" stroke-width="${8 * k}"`),
    line(`stroke="#fff" stroke-width="${6 * k}"`),
  ].join('');
}

/**
 * Place du repère d'un objet orienté : derrière lui, à l'opposé du faisceau ou du champ. Couché
 * (vers la gauche ou la droite), le texte s'aligne sur son bord pour ne pas recouvrir l'objet.
 */
export function labelBehind(x: number, y: number, rot: number, dist = 30): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const anchor = c > 0.5 ? 'end' : c < -0.5 ? 'start' : 'middle';
  const d = anchor === 'middle' ? dist : dist - 10;
  return { x: x - c * d, y: y - Math.sin(a) * d + 4, anchor };
}
