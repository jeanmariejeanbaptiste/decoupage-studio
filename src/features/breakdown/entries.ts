import { matchSequence, scenesOf, type Scene } from '../../domain/fountain';
import { sequenceHeading } from '../../domain/numbering';
import type { ID, ProjectDoc } from '../../domain/types';

/** Une scène à dépouiller : scène du scénario, séquence du découpage, ou les deux. */
export interface Entry {
  key: string;
  seqId?: ID;
  scene?: Scene;
}

/** Scènes dans l'ordre du scénario (avec leur séquence), puis les séquences sans passage écrit. */
export function entriesOf(doc: ProjectDoc): Entry[] {
  const scenes = scenesOf(doc.scenario ?? '');
  const used = new Set<ID>();
  const out: Entry[] = [];
  for (const sc of scenes) {
    const id = matchSequence(doc, sc);
    const seqId = id && !used.has(id) ? id : undefined;
    if (seqId) used.add(seqId);
    out.push({ key: seqId ?? `scene-${sc.start}`, seqId, scene: sc });
  }
  for (const id of doc.project.sequenceIds) if (!used.has(id)) out.push({ key: id, seqId: id });
  return out;
}

/** Nom d'une scène dans la liste : lieu, ou libellé de la séquence (vide s'il n'y en a pas). */
export function entryName(doc: ProjectDoc, e: Entry): string {
  const name = e.seqId ? sequenceHeading(doc, e.seqId).replace(/^\d+,?\s*/, '') : (e.scene?.location ?? '');
  return name.trim().toLocaleUpperCase('fr');
}

/**
 * Numéros du dépouillement : ceux du scénario (la scène n porte le numéro n, comme dans l'éditeur),
 * puis, à la suite, les séquences du découpage sans passage écrit. Un même numéro partout : liste,
 * fiche, rapports.
 */
export function entryNumbers(entries: readonly Entry[]): { byKey: Map<string, number>; bySeq: Map<ID, number> } {
  const byKey = new Map<string, number>();
  const bySeq = new Map<ID, number>();
  entries.forEach((e, i) => {
    byKey.set(e.key, i + 1);
    if (e.seqId) bySeq.set(e.seqId, i + 1);
  });
  return { byKey, bySeq };
}

/** « 3, ENTREPRISE / BUREAU DIRECTRICE » au numéro du dépouillement. */
export const entryLabel = (doc: ProjectDoc, e: Entry, n: number | undefined) => `${n ?? '–'}, ${entryName(doc, e) || (e.scene?.heading ?? '').toLocaleUpperCase('fr')}`;
