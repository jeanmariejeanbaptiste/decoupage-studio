import { comparisonPair } from '../../domain/versions';
import type { ID, ProjectDoc } from '../../domain/types';
import { flushEditors } from '../../store/persistence';

/** Page d'où l'on est venu (Scénario ou Découpage), gardée pour la session : un rechargement ne la perd pas. */
const FROM_KEY = 'ds-compare-from';
/** Ouverte depuis l'application dans cette page : l'entrée d'historique précédente est la page d'origine. */
let pushed = false;

const readFrom = (): string | null => {
  try {
    return sessionStorage.getItem(FROM_KEY);
  } catch {
    return null;
  }
};
const writeFrom = (to: string | null) => {
  try {
    if (to) sessionStorage.setItem(FROM_KEY, to);
    else sessionStorage.removeItem(FROM_KEY);
  } catch {
    /* sans stockage : retour au Scénario */
  }
};

export const compareHash = (a: ID, b: ID) => `#/scenario?compare=${a}~${b}`;

/**
 * Ouvre la comparaison des versions (par défaut : la courante avec celle dont elle est partie).
 * `guest` : invité ou relecteur, limité aux versions publiées.
 */
export function openCompare(doc: ProjectDoc, guest = false): void {
  const pair = comparisonPair(doc, null, guest);
  if (!pair) return;
  flushEditors();
  if (!window.location.hash.includes('compare=')) {
    writeFrom(window.location.hash || '#/scenario');
    pushed = true;
  }
  window.location.hash = compareHash(pair.a, pair.b);
}

/** Change les versions comparées, sans empiler l'historique. */
export function setCompared(a: ID, b: ID): void {
  window.location.replace(compareHash(a, b));
}

/**
 * Flèche de retour : la page d'origine. Ouverte depuis l'application, on revient en arrière dans
 * l'historique (le bouton Précédent ne ramène pas à la comparaison) ; sinon, l'adresse est remplacée.
 */
export function leaveCompare(): void {
  const from = readFrom();
  const to = from && !from.includes('compare=') ? from : '#/scenario';
  writeFrom(null);
  if (pushed && window.history.length > 1) {
    pushed = false;
    window.history.back();
  } else window.location.replace(to);
}

/** La comparaison quittée autrement que par sa flèche (menu, adresse) : l'historique n'est plus le sien. */
export function compareClosed(): void {
  if (!window.location.hash.includes('compare=')) pushed = false;
}

/** Ouvre une séquence de la version courante dans l'éditeur (numéro dérivé de l'ordre). */
export function openSequenceInEditor(n: number): void {
  pushed = false;
  writeFrom(null);
  window.location.hash = `#/scenario?seq=${n}`;
}
