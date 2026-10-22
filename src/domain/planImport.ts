import { PLAN_H, PLAN_W } from './floorplan';

/**
 * Consignes à donner à une IA externe (Claude, ChatGPT, Gemini…) avec l'image d'un plan de locaux :
 * elle doit répondre dans ce format Markdown exact, que l'outil sait relire.
 */
export const AI_PLAN_INSTRUCTIONS = `Tu analyses l'image d'un plan de locaux (plan d'architecte, croquis ou capture) pour un logiciel de découpage technique de cinéma.
Ton unique tâche : décrire la géométrie des murs, portes et fenêtres, dans le format Markdown ci-dessous, à l'exclusion de tout autre texte.

RÈGLES OBLIGATOIRES
1. Réponds UNIQUEMENT avec un bloc Markdown commençant par « # PLAN ». Aucune phrase avant ni après, pas de bloc de code.
2. Repère : origine (0,0) au coin HAUT-GAUCHE du plan ; x vers la droite, y vers le BAS ; unité = centimètres réels (estime l'échelle à partir des cotes, des portes standard de 80–90 cm, ou du mobilier).
3. Chaque mur est un segment droit : « - x1,y1 -> x2,y2 ». Découpe les murs courbes en segments. Un mur épais se décrit par son axe (un seul segment).
4. Ajoute « | blanc » en fin de ligne si le mur est manifestement clair/blanc (sinon rien).
5. Les ouvertures ne coupent pas les murs : décris le mur entier, puis la porte ou la fenêtre séparément par son centre.
6. Porte : « - x,y | largeur L | angle A » (A = orientation du mur en degrés : 0 = horizontal, 90 = vertical). Fenêtre : même format.
7. Nombres entiers ou décimaux avec un point. Pas d'unités dans les nombres. Toutes les sections sont obligatoires, même vides.
8. N'invente rien : si une zone est illisible, omets-la plutôt que de deviner.

FORMAT EXACT
# PLAN
unite: cm
largeur: <largeur totale en cm>
hauteur: <hauteur totale en cm>
## MURS
- 0,0 -> 850,0 | blanc
- 850,0 -> 850,520
## PORTES
- 120,0 | largeur 90 | angle 0
## FENETRES
- 400,520 | largeur 150 | angle 0
`;

export interface ImportedPlan {
  walls: Array<{ x: number; y: number; x2: number; y2: number; white: boolean }>;
  doors: Array<{ x: number; y: number; width: number; rot: number }>;
  windows: Array<{ x: number; y: number; width: number; rot: number }>;
}

const N = String.raw`(-?\d+(?:[.,]\d+)?)`;
const num = (s: string) => Number(s.replace(',', '.'));

/** Lit la réponse Markdown de l'IA et la met à l'échelle du plan au sol (centrée, avec une marge). */
export function parsePlanMarkdown(md: string): ImportedPlan | null {
  if (!/^\s*#\s*PLAN/im.test(md)) return null;
  const get = (k: string) => num(new RegExp(`^\\s*${k}\\s*:\\s*${N}`, 'im').exec(md)?.[1] ?? 'NaN');
  const section = (name: string) => {
    const m = new RegExp(`^##\\s*(?:${name})\\s*$([\\s\\S]*?)(?=^##|$(?![\\s\\S]))`, 'im').exec(md);
    return (m?.[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-'));
  };
  const wallRe = new RegExp(`${N}\\s*,\\s*${N}\\s*->\\s*${N}\\s*,\\s*${N}`);
  const openRe = new RegExp(`${N}\\s*,\\s*${N}(?:.*?largeur\\s*${N})?(?:.*?angle\\s*${N})?`, 'i');
  const rawWalls = section('MURS').flatMap((l) => {
    const m = wallRe.exec(l);
    return m ? [{ x: num(m[1]), y: num(m[2]), x2: num(m[3]), y2: num(m[4]), white: /\|\s*blanc/i.test(l) }] : [];
  });
  const openings = (name: string) =>
    section(name).flatMap((l) => {
      const m = openRe.exec(l);
      return m ? [{ x: num(m[1]), y: num(m[2]), width: m[3] ? num(m[3]) : 90, rot: m[4] ? num(m[4]) : 0 }] : [];
    });
  const doors = openings('PORTES');
  const windows = openings('FENETRES|FENÊTRES');
  const xs = [...rawWalls.flatMap((w) => [w.x, w.x2]), ...doors.map((d) => d.x), ...windows.map((w) => w.x)];
  const ys = [...rawWalls.flatMap((w) => [w.y, w.y2]), ...doors.map((d) => d.y), ...windows.map((w) => w.y)];
  if (!xs.length) return null;
  const W = Number.isFinite(get('largeur')) ? get('largeur') : Math.max(...xs);
  const H = Number.isFinite(get('hauteur')) ? get('hauteur') : Math.max(...ys);
  const margin = 30;
  const k = Math.min((PLAN_W - 2 * margin) / Math.max(1, W), (PLAN_H - 2 * margin) / Math.max(1, H));
  const ox = (PLAN_W - W * k) / 2;
  const oy = (PLAN_H - H * k) / 2;
  const X = (v: number) => Math.round(ox + v * k);
  const Y = (v: number) => Math.round(oy + v * k);
  return {
    walls: rawWalls.map((w) => ({ x: X(w.x), y: Y(w.y), x2: X(w.x2), y2: Y(w.y2), white: w.white })),
    doors: doors.map((d) => ({ x: X(d.x) - (d.width * k) / 2, y: Y(d.y), width: Math.round(d.width * k), rot: d.rot })),
    windows: windows.map((d) => ({ x: X(d.x) - (d.width * k) / 2, y: Y(d.y), width: Math.round(d.width * k), rot: d.rot })),
  };
}
