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
  // Lieu partagé : les décors tournés au même endroit suivent (et la source, si c'est l'un d'eux qu'on règle).
  const root = decor.locationFrom && doc.decors[decor.locationFrom] ? decor.locationFrom : decorId;
  if (root !== decorId) copyLocation(doc, decorId, root);
  for (const d of Object.values(doc.decors)) if (d.locationFrom === root && d.id !== decorId) copyLocation(doc, root, d.id);
}

function copyLocation(doc: ProjectDoc, fromId: ID, toId: ID): void {
  const from = doc.decors[fromId];
  const to = doc.decors[toId];
  if (!from || !to) return;
  delete to.address;
  const loc = decorLocation(from);
  if (Object.keys(loc).length) to.location = { ...loc };
  else delete to.location;
}

/**
 * Un même lieu de tournage pour plusieurs décors (« bureau » et « couloir » tournés dans les mêmes
 * locaux) : le décor reprend le lieu de `fromId` et le suit ensuite. `undefined` : lieu propre (il
 * garde la copie actuelle, modifiable seule).
 */
export function shareLocation(doc: ProjectDoc, decorId: ID, fromId: ID | undefined): void {
  const decor = doc.decors[decorId];
  if (!decor || fromId === decorId) return;
  // Toujours vers la source : pas de chaîne ni de boucle.
  const root = fromId && doc.decors[fromId]?.locationFrom && doc.decors[doc.decors[fromId].locationFrom!] ? doc.decors[fromId].locationFrom! : fromId;
  if (!root || !doc.decors[root]) {
    delete decor.locationFrom;
    return;
  }
  decor.locationFrom = root;
  copyLocation(doc, root, decorId);
  for (const d of Object.values(doc.decors)) if (d.locationFrom === decorId) d.locationFrom = root;
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
