import { characterStats, decorUsage, usageInOtherVersions } from './registry';
import { blocksFromSource } from './screenplay';
import { characterReports, locationReports, matchesName, sceneReports } from './scriptReports';
import type { Character, Decor, ID, ProjectDoc } from './types';

export type FicheKind = 'character' | 'decor';

/**
 * Fiches que le texte du scénario ne nomme pas (créées au dépouillement, depuis la grille, ou dont
 * le nom a quitté le texte) : les panneaux du Scénario, tirés du texte, ne les montrent pas.
 * Même lecture que ces panneaux : un personnage est présent s'il parle ou s'il est nommé dans une
 * séquence ; un décor, s'il est le lieu d'un en-tête. Triées par nom.
 */
export function orphanFiches(doc: ProjectDoc, kind: 'character'): Character[];
export function orphanFiches(doc: ProjectDoc, kind: 'decor'): Decor[];
export function orphanFiches(doc: ProjectDoc, kind: FicheKind): Array<Character | Decor> {
  const names = Object.values(doc.characters).flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  const scenes = sceneReports(blocksFromSource(doc.scenario ?? '').blocks, names, doc.project.settings.scriptChrono);
  const inText = kind === 'character' ? characterReports(scenes).map((r) => r.name) : locationReports(scenes).map((r) => r.location);
  const fiches: Array<Character | Decor> = Object.values(kind === 'character' ? doc.characters : doc.decors);
  return fiches.filter((f) => !inText.some((n) => matchesName(f, n))).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Ce qui se sert d'une fiche : séquences de la version courante, autres versions (par leur nom). */
export function ficheUse(doc: ProjectDoc, kind: FicheKind, id: ID): { sequences: number; versions: string[] } {
  const sequences = kind === 'character' ? (characterStats(doc).get(id)?.sequenceIds.length ?? 0) : (decorUsage(doc).get(id)?.sequenceIds.length ?? 0);
  return { sequences, versions: usageInOtherVersions(doc, kind).get(id) ?? [] };
}

/** Phrase de confirmation d'une suppression ; vide si rien ne se sert de la fiche (pas de question). */
export function deleteWarning(doc: ProjectDoc, kind: FicheKind, id: ID): string {
  const { sequences: n, versions } = ficheUse(doc, kind, id);
  if (!n && !versions.length) return '';
  const where = [n ? `${n} séquence${n > 1 ? 's' : ''} de cette version` : '', versions.length ? versions.join(' et ') : ''].filter(Boolean).join(', ainsi que ');
  return kind === 'character'
    ? `Présent dans ${where}. Les plans gardent leur sujet ; seule la fiche disparaît (annulable avec ⌘Z).`
    : `Lieu de ${where}, qui n’auront plus de décor. Le lieu de tournage, son adresse et son contact disparaissent avec la fiche (annulable avec ⌘Z).`;
}
