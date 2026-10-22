type P = [number, number];

/** Annotations vectorielles d'une case de storyboard (espace 1000 × 1000/ratio). */
export type SketchItem =
  | { id: string; kind: 'pen'; points: P[]; color: string; width: number }
  | { id: string; kind: 'arrow'; from: P; to: P; color: string; width: number }
  | { id: string; kind: 'text'; at: P; text: string; color: string; size: number }
  | { id: string; kind: 'arrow3d'; at: P; size: number; yaw: number; pitch: number; roll: number; color: string; length?: number; bend?: number; persp?: number };

export const SKETCH_W = 1000;

/** Orientations de départ des flèches en fausse 3D (modifiables ensuite). */
export const ARROW3D_PRESETS: ReadonlyArray<{ label: string; yaw: number; pitch: number; roll: number }> = [
  { label: 'Vers la droite', yaw: 0, pitch: 25, roll: 0 },
  { label: 'Vers la gauche', yaw: 180, pitch: 25, roll: 0 },
  { label: 'Vient vers la caméra', yaw: -90, pitch: 30, roll: 0 },
  { label: 'S’éloigne dans la profondeur', yaw: 90, pitch: 30, roll: 0 },
  { label: 'Monte', yaw: 0, pitch: 10, roll: 90 },
  { label: 'Descend', yaw: 0, pitch: 10, roll: -90 },
  { label: 'Diagonale en profondeur', yaw: 45, pitch: 35, roll: 0 },
  { label: 'Diagonale vers la caméra', yaw: -45, pitch: 35, roll: 0 },
];

/**
 * Contour plat d'une flèche (pointe vers +x), éventuellement courbée : le fût suit un arc
 * de `bend` degrés ; `length` allonge le fût. Centré sur l'origine.
 */
function outline(length = 1, bend = 0): P[] {
  const head = 0.32;
  const shaft = Math.max(0.15, length - head);
  const w = 0.07;
  const hw = 0.2;
  const b = rad(bend);
  const N = Math.abs(b) < 1e-3 ? 1 : 12;
  const c = (t: number): { p: P; a: number } => {
    if (N === 1) return { p: [t * shaft, 0], a: 0 };
    const R = shaft / b;
    return { p: [R * Math.sin(b * t), R * (1 - Math.cos(b * t))], a: b * t };
  };
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i <= N; i++) {
    const { p, a } = c(i / N);
    const [nx, nz] = [-Math.sin(a), Math.cos(a)];
    left.push([p[0] + nx * w, p[1] + nz * w]);
    right.push([p[0] - nx * w, p[1] - nz * w]);
  }
  const end = c(1);
  const [tx, tz] = [Math.cos(end.a), Math.sin(end.a)];
  const [nx, nz] = [-Math.sin(end.a), Math.cos(end.a)];
  const tip: P = [end.p[0] + tx * head, end.p[1] + tz * head];
  const pts: P[] = [...right, [end.p[0] - nx * hw, end.p[1] - nz * hw], tip, [end.p[0] + nx * hw, end.p[1] + nz * hw], ...left.reverse()];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [cx, cz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  return pts.map(([x, z]) => [x - cx, z - cz]);
}
const THICK = 0.07;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Flèche « en fausse 3D » : la forme plate est extrudée, tournée (roulis autour de son axe,
 * lacet dans le plan du sol, tangage vers la caméra), projetée en perspective et peinte
 * de l'arrière vers l'avant ; l'ombrage suit l'orientation de chaque face.
 */
export function arrow3dFaces(a: { yaw: number; pitch: number; roll: number; length?: number; bend?: number; persp?: number }): Array<{ points: P[]; shade: number }> {
  const OUTLINE = outline(a.length ?? 1, a.bend ?? 0);
  const [cr, sr] = [Math.cos(rad(a.roll)), Math.sin(rad(a.roll))];
  const [cy, sy] = [Math.cos(rad(a.yaw)), Math.sin(rad(a.yaw))];
  const [cp, sp] = [Math.cos(rad(a.pitch)), Math.sin(rad(a.pitch))];
  // Repère : x à droite, y vers le haut, z vers le spectateur. La flèche est posée à plat (plan x-z).
  const rot = ([x, y, z]: [number, number, number]): [number, number, number] => {
    const y1 = y * cr - z * sr; // roulis autour de x
    const z1 = y * sr + z * cr;
    const x2 = x * cy + z1 * sy; // lacet autour de y
    const z2 = -x * sy + z1 * cy;
    return [x2, y1 * cp - z2 * sp, y1 * sp + z2 * cp]; // tangage autour de x
  };
  // Perspective : 0 = à plat (orthographique), 1 = forte.
  const D = 1.6 + (1 - Math.max(0, Math.min(1, a.persp ?? 0.5))) * 12;
  const proj = ([x, y, z]: [number, number, number]): P => {
    const k = D / (D - z);
    return [x * k, -y * k];
  };
  const top = OUTLINE.map(([x, z]) => rot([x, THICK / 2, z]));
  const bot = OUTLINE.map(([x, z]) => rot([x, -THICK / 2, z]));
  const faces: Array<{ v: Array<[number, number, number]> }> = [{ v: top }, { v: [...bot].reverse() }];
  for (let i = 0; i < OUTLINE.length; i++) {
    const j = (i + 1) % OUTLINE.length;
    faces.push({ v: [top[i], top[j], bot[j], bot[i]] });
  }
  const light: [number, number, number] = [-0.35, 0.6, 0.72];
  return faces
    .map((f) => {
      const [p0, p1, p2] = f.v;
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const lit = Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / len);
      const depth = f.v.reduce((s, p) => s + p[2], 0) / f.v.length;
      return { points: f.v.map(proj), shade: 0.45 + 0.55 * lit, depth };
    })
    .sort((x, y) => x.depth - y.depth)
    .map(({ points, shade }) => ({ points, shade }));
}

/** Pointe d'une flèche 2D : triangle au bout du segment. */
export function arrowHead(from: P, to: P, size: number): P[] {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const s = size;
  return [to, [to[0] - s * Math.cos(a - 0.45), to[1] - s * Math.sin(a - 0.45)], [to[0] - s * Math.cos(a + 0.45), to[1] - s * Math.sin(a + 0.45)]];
}

/** Assombrit / éclaircit une couleur #rrggbb. */
export function shadeColor(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
