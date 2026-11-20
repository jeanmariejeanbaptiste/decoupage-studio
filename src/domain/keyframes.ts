import { newId } from './factory';
import type { SketchItem } from './sketch';
import type { ProjectDoc, Shot } from './types';

/** Une image d'un plan : keyframe 1 (`storyboard`) ou suivantes (`keyframes`). */
/** Cadrage d'une image dans sa case : zoom (1 = taille de base), décalage (% de la case), rotation (°). */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
  rot: number;
}

export const NO_CROP: Crop = { zoom: 1, x: 0, y: 0, rot: 0 };

/**
 * Cadrage « remplir » toujours plein : l'image (zoomée, tournée, déplacée) couvre tout le cadre, sans
 * bande vide. `ratio` = largeur / hauteur du cadre. Le zoom remonte au minimum utile, puis le
 * déplacement est ramené vers le centre juste assez.
 */
export function clampCrop(c: Crop, ratio: number): Crop {
  const W = ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9;
  const H = 1;
  const a = (c.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
  // Coin du cadre exprimé dans le repère de l'image (centrée en t, tournée de rot) : |u| ≤ zW/2, |v| ≤ zH/2.
  const need = (tx: number, ty: number) =>
    Math.max(...corners.map(([px, py]) => {
      const dx = px - tx;
      const dy = py - ty;
      const u = cos * dx + sin * dy;
      const v = -sin * dx + cos * dy;
      return Math.max((2 * Math.abs(u)) / W, (2 * Math.abs(v)) / H);
    }));
  const zoom = Math.max(c.zoom, need(0, 0));
  let tx = (c.x / 100) * W;
  let ty = (c.y / 100) * H;
  if (need(tx, ty) > zoom + 1e-9) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (need(tx * m, ty * m) <= zoom + 1e-9) lo = m;
      else hi = m;
    }
    tx *= lo;
    ty *= lo;
  }
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4 || 0;
  return { zoom, x: r4((tx / W) * 100), y: r4((ty / H) * 100), rot: c.rot };
}

/** Style CSS d'une image cadrée : « remplir » par défaut (jamais de vide si le format du cadre est donné), « ajuster » sur demande. */
export function cropStyle(f: Frame, ratio?: number): { objectFit: 'cover' | 'contain'; transform: string } {
  const fit = f.fit ?? 'cover';
  const raw = f.crop ?? NO_CROP;
  const c = fit === 'cover' && ratio ? clampCrop(raw, ratio) : raw;
  return { objectFit: fit, transform: `translate(${c.x}%, ${c.y}%) rotate(${c.rot}deg) scale(${c.zoom})` };
}

export interface Frame {
  fit?: 'cover' | 'contain';
  crop?: Crop;
  blobKey?: string;
  baseKey?: string;
  sketch?: SketchItem[];
  /** Cadrage de l'image d'origine sous le dessin (le dessin enregistré l'intègre déjà). */
  baseFit?: 'cover' | 'contain';
  baseCrop?: Crop;
  /** Format (largeur / hauteur) dans lequel le dessin a été fait. */
  sketchAspect?: number;
  note?: string;
}

/** Transformation SVG équivalente au cadrage CSS d'une image (centre, décalage, rotation, zoom). */
export function cropTransform(c: Crop | undefined, w: number, h: number): string {
  const k = c ?? NO_CROP;
  return `translate(${w / 2 + (k.x / 100) * w} ${h / 2 + (k.y / 100) * h}) rotate(${k.rot}) scale(${k.zoom}) translate(${-w / 2} ${-h / 2})`;
}

/** Toutes les keyframes d'un plan, dans l'ordre ; la première existe toujours (éventuellement vide). */
export function framesOf(shot: Shot): Frame[] {
  return [{ ...shot.storyboard }, ...(shot.keyframes ?? [])];
}

export function setFrame(doc: ProjectDoc, shotId: string, index: number, patch: Frame): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  if (index === 0) {
    const next = { ...shot.storyboard, ...patch };
    shot.storyboard = next.blobKey || next.note ? (next as Shot['storyboard']) : undefined;
    return;
  }
  const k = shot.keyframes?.[index - 1];
  if (k) Object.assign(k, patch);
}

export function addKeyframe(doc: ProjectDoc, shotId: string): void {
  const shot = doc.shots[shotId];
  if (shot) (shot.keyframes ??= []).push({ id: newId() });
}

/** Retire une keyframe ; si c'est la première, la suivante prend sa place. */
export function removeFrame(doc: ProjectDoc, shotId: string, index: number): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  if (index > 0) {
    shot.keyframes = shot.keyframes?.filter((_, i) => i !== index - 1);
  } else if (shot.keyframes?.length) {
    const [first, ...rest] = shot.keyframes;
    const { id: _id, ...rest0 } = first;
    void _id;
    shot.storyboard = first.blobKey ? (rest0 as Shot['storyboard']) : undefined;
    shot.keyframes = rest;
  } else shot.storyboard = undefined;
  if (shot.keyframes && !shot.keyframes.length) delete shot.keyframes;
}

/** Nombre d'images effectivement présentes (pour attendre leur chargement à l'export). */
export const imageCount = (shot: Shot) => framesOf(shot).filter((f) => f.blobKey).length;
