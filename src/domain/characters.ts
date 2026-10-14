import { escapeRegExp, fold } from './text';
import type { Character, ID, ProjectDoc } from './types';

/** Personnages reconnus dans un sujet (nom ou alias, mot entier, sans casse ni accents). */
export function recognizeCharacters(subject: string, characters: readonly Character[]): ID[] {
  const s = fold(subject);
  if (!s) return [];
  return characters
    .filter((c) =>
      [c.name, ...(c.aliases ?? [])].some((n) => {
        const name = fold(n);
        return name.length > 0 && new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}($|[^\\p{L}])`, 'u').test(s);
      }),
    )
    .map((c) => c.id);
}

/** Personnages d'une séquence = union des sujets reconnus + ajouts manuels (§7). */
export function sequenceCharacterIds(doc: ProjectDoc, seqId: ID): ID[] {
  const seq = doc.sequences[seqId];
  if (!seq) return [];
  const ids = new Set<ID>(seq.characterIds);
  for (const shotId of seq.shotIds) for (const c of doc.shots[shotId]?.characterIds ?? []) ids.add(c);
  return [...ids].filter((id) => doc.characters[id]);
}

export function sortedCharacters(doc: ProjectDoc): Character[] {
  return Object.values(doc.characters).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
