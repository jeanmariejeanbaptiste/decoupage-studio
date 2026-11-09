import type { Decor, FilmingLocation, ID, ProjectDoc } from './types';

const FIELDS = ['name', 'address', 'access', 'contact'] as const;

/** Lieu de tournage d'un décor ; l'ancienne adresse (`address`) sert tant qu'elle n'est pas migrée. */
export function decorLocation(decor: Decor | undefined): FilmingLocation {
  const out: FilmingLocation = {};
  for (const k of FIELDS) {
    const v = (k === 'address' ? (decor?.location?.address ?? decor?.address) : decor?.location?.[k])?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Modifie le lieu de tournage d'un décor (champ vide = retiré) ; l'ancienne adresse est reprise. */
export function setDecorLocation(doc: ProjectDoc, decorId: ID, patch: Partial<FilmingLocation>): void {
  const decor = doc.decors[decorId];
  if (!decor) return;
  const next: FilmingLocation = { ...decorLocation(decor) };
  for (const k of FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k]?.trim();
    if (v) next[k] = v;
    else delete next[k];
  }
  delete decor.address;
  if (Object.keys(next).length) decor.location = next;
  else delete decor.location;
}

/** Migration douce : l'adresse de tournage d'un décor passe dans son lieu de tournage. */
export function migrateDecorLocations(doc: ProjectDoc): void {
  for (const decor of Object.values(doc.decors)) {
    if (decor.address === undefined) continue;
    const loc = decorLocation(decor);
    delete decor.address;
    if (Object.keys(loc).length) decor.location = loc;
    else delete decor.location;
  }
}
