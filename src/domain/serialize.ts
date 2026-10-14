import { defaultSettings } from './factory';
import { EMPTY_CUSTOM_VOCABULARY } from './vocabulary';
import { SCHEMA_VERSION, type ProjectDoc } from './types';

export const FILE_EXTENSION = '.decoupage';
export const FILE_MIME = 'application/x-decoupage+json';

export interface ProjectFile {
  format: 'decoupage-studio';
  schemaVersion: number;
  savedAt: string;
  doc: ProjectDoc;
}

export function serializeDoc(doc: ProjectDoc, savedAt = new Date().toISOString()): string {
  const file: ProjectFile = { format: 'decoupage-studio', schemaVersion: SCHEMA_VERSION, savedAt, doc };
  return JSON.stringify(file, null, 2);
}

export class ProjectFileError extends Error {}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Lit un fichier `.decoupage` (ou un JSON de projet nu), vérifie sa structure et complète
 * les champs ajoutés depuis (migration douce).
 */
export function parseProjectFile(text: string): ProjectDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('Le fichier n’est pas un JSON valide.');
  }
  const candidate = isObject(raw) && 'doc' in raw ? raw.doc : raw;
  if (!isObject(candidate) || !isObject(candidate.project)) throw new ProjectFileError('Ce fichier ne contient pas de projet Découpage Studio.');
  const version = isObject(raw) && typeof raw.schemaVersion === 'number' ? raw.schemaVersion : SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) throw new ProjectFileError('Ce fichier provient d’une version plus récente de l’application.');
  return migrate(candidate as unknown as ProjectDoc);
}

export function migrate(input: ProjectDoc): ProjectDoc {
  const doc = structuredClone(input);
  const p = doc.project;
  for (const key of ['sequences', 'shots', 'blocks', 'characters', 'decors'] as const) {
    if (!isObject(doc[key])) throw new ProjectFileError(`Section « ${key} » manquante ou invalide.`);
  }
  if (!Array.isArray(p.sequenceIds)) throw new ProjectFileError('Ordre des séquences manquant.');
  if (typeof p.id !== 'string' || !p.id) throw new ProjectFileError('Identifiant de projet manquant.');
  p.settings = { ...defaultSettings(p.format ?? 'fiction'), ...(p.settings ?? {}) };
  p.schemaVersion = SCHEMA_VERSION;
  p.title = p.title ?? 'Projet sans titre';
  p.version = p.version ?? 'V1';
  doc.ignoredChecks ??= [];
  doc.validatedSteps ??= [];
  doc.customVocabulary = { ...structuredClone(EMPTY_CUSTOM_VOCABULARY), ...(doc.customVocabulary ?? {}) };
  doc.manualEquipment ??= [];
  for (const seq of Object.values(doc.sequences)) {
    seq.characterIds ??= [];
    seq.shotIds ??= [];
    seq.actionBlockIds ??= [];
  }
  for (const shot of Object.values(doc.shots)) {
    shot.characterIds ??= [];
    shot.angle ??= [];
    shot.movement ??= [];
    shot.focal ??= {};
    shot.status ??= 'à tourner';
  }
  return doc;
}

export function fileNameFor(doc: ProjectDoc): string {
  const base = `${doc.project.title || 'projet'} ${doc.project.version ?? ''}`
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base || 'projet'}${FILE_EXTENSION}`;
}
