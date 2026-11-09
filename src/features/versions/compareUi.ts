import { comparisonPair } from '../../domain/versions';
import type { ID, ProjectDoc } from '../../domain/types';
import { flushEditors } from '../../store/persistence';

/** Page d'où l'on est venu (Scénario ou Découpage), pour la flèche de retour. */
let returnTo: string | null = null;

export const compareHash = (a: ID, b: ID) => `#/scenario?compare=${a}~${b}`;

/** Ouvre la comparaison des versions (par défaut : la courante avec celle dont elle est partie). */
export function openCompare(doc: ProjectDoc): void {
  const pair = comparisonPair(doc);
  if (!pair) return;
  flushEditors();
  if (!window.location.hash.includes('compare=')) returnTo = window.location.hash || '#/scenario';
  window.location.hash = compareHash(pair.a, pair.b);
}

/** Change les versions comparées, sans empiler l'historique. */
export function setCompared(a: ID, b: ID): void {
  window.location.replace(compareHash(a, b));
}

export function leaveCompare(): void {
  const to = returnTo && !returnTo.includes('compare=') ? returnTo : '#/scenario';
  returnTo = null;
  window.location.hash = to;
}

/** Ouvre une séquence de la version courante dans l'éditeur (numéro dérivé de l'ordre). */
export function openSequenceInEditor(n: number): void {
  returnTo = null;
  window.location.hash = `#/scenario?seq=${n}`;
}
