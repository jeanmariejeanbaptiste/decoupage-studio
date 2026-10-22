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

/** Style CSS d'une image cadrée : « remplir » par défaut, « ajuster » sur demande. */
export function cropStyle(f: Frame): { objectFit: 'cover' | 'contain'; transform: string } {
  const c = f.crop ?? NO_CROP;
  return { objectFit: f.fit ?? 'cover', transform: `translate(${c.x}%, ${c.y}%) rotate(${c.rot}deg) scale(${c.zoom})` };
}

export interface Frame {
  fit?: 'cover' | 'contain';
  crop?: Crop;
  blobKey?: string;
  baseKey?: string;
  sketch?: SketchItem[];
  note?: string;
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
    shot.storyboard = first.blobKey ? { blobKey: first.blobKey, baseKey: first.baseKey, sketch: first.sketch, note: first.note, fit: first.fit, crop: first.crop } : undefined;
    shot.keyframes = rest;
  } else shot.storyboard = undefined;
  if (shot.keyframes && !shot.keyframes.length) delete shot.keyframes;
}

/** Nombre d'images effectivement présentes (pour attendre leur chargement à l'export). */
export const imageCount = (shot: Shot) => framesOf(shot).filter((f) => f.blobKey).length;
