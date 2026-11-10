import { richImageKeys } from './richText';
import { ensureInterview, syncInterviewShots, upgradeInterview } from './interview';
import { defaultSettings, makeBlock } from './factory';
import { normalizeScenario } from './fountain';
import { storedShots } from './versions';
import { adoptUnversionedComments, commentAttachments } from './comments';
import { migrateDecorLocations } from './locations';
import { migrateBreakdownCharacters } from './breakdown';
import { normalizeProduction, syncProduction } from './production';
import { normalizeCalendar } from './calendar';
import { ensureDayIds } from './schedule';
import { activeColumns } from './columns';
import { normalizeTiming } from './factory';
import { EMPTY_CUSTOM_VOCABULARY } from './vocabulary';
import { SCHEMA_VERSION, type ProjectDoc } from './types';

export const FILE_EXTENSION = '.decoupage';
export const FILE_MIME = 'application/x-decoupage+json';

/** Média intégré au fichier (image, piste audio), en base 64. */
export interface MediaEntry {
  type: string;
  data: string;
}

export interface ProjectFile {
  format: 'decoupage-studio';
  schemaVersion: number;
  savedAt: string;
  doc: ProjectDoc;
  /** Images et sons du projet : le fichier se suffit à lui-même (autre navigateur, autre ordinateur). */
  media?: Record<string, MediaEntry>;
}

export function serializeDoc(doc: ProjectDoc, savedAt = new Date().toISOString(), media?: Record<string, MediaEntry>): string {
  const file: ProjectFile = { format: 'decoupage-studio', schemaVersion: SCHEMA_VERSION, savedAt, doc, ...(media && Object.keys(media).length ? { media } : {}) };
  return JSON.stringify(file, null, media ? undefined : 2);
}

/** Médias intégrés à un fichier (absents des fichiers d'avant cette version). */
export function mediaOfFile(text: string): Record<string, MediaEntry> {
  try {
    const raw = JSON.parse(text) as { media?: Record<string, MediaEntry> };
    return raw && typeof raw.media === 'object' && raw.media ? raw.media : {};
  } catch {
    return {};
  }
}

/** Toutes les clés de médias utilisées par un projet : storyboard (images et dessins), fonds de plan, piste. */
export function mediaKeys(doc: ProjectDoc): string[] {
  const keys = new Set<string>();
  const add = (k?: string) => k && keys.add(k);
  // Images du storyboard de toutes les versions, rangées comprises.
  for (const sh of [...Object.values(doc.shots), ...storedShots(doc)]) {
    add(sh.storyboard?.blobKey);
    add(sh.storyboard?.baseKey);
    for (const k of sh.keyframes ?? []) {
      add(k.blobKey);
      add(k.baseKey);
    }
  }
  for (const p of Object.values(doc.floorPlans ?? {})) add(p.bg?.blobKey);
  for (const k of richImageKeys(doc.intentionHtml)) add(k);
  for (const subj of doc.interview?.subjects ?? []) for (const st of subj.setups ?? []) for (const c of st.cameras) add(c.frame);
  add(doc.project.settings.audioTrack?.blobKey);
  for (const k of commentAttachments(doc)) add(k);
  return [...keys];
}

/**
 * Médias d'un projet qu'on supprime et qu'un autre projet utilise encore (copie ouverte d'un fichier,
 * partage) : clé → projet qui en devient propriétaire. Les clés absentes du résultat peuvent être effacées.
 */
export function sharedMediaOwners(keys: string[], others: ProjectDoc[]): Map<string, string> {
  const owners = new Map<string, string>();
  const wanted = new Set(keys);
  for (const d of others) for (const k of mediaKeys(d)) if (wanted.has(k) && !owners.has(k)) owners.set(k, d.project.id);
  return owners;
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
  p.settings.gridColumns = activeColumns(p.settings.gridColumns);
  p.settings.exportColumns = activeColumns(p.settings.exportColumns);
  // Projets d'avant le mode « durée de chaque plan » : ils y passent, sauf choix explicite.
  if (p.settings.tcMode === 'cumulatif' && !p.settings.tcModeChosen) p.settings.tcMode = 'duree';
  normalizeTiming(doc);
  upgradeInterview(doc);
  if (p.format === 'institutionnel') ensureInterview(doc);
  p.schemaVersion = SCHEMA_VERSION;
  p.title = p.title ?? 'Projet sans titre';
  p.version = p.version ?? 'V1';
  doc.ignoredChecks ??= [];
  doc.validatedSteps ??= [];
  doc.customVocabulary = { ...structuredClone(EMPTY_CUSTOM_VOCABULARY), ...(doc.customVocabulary ?? {}) };
  doc.manualEquipment ??= [];
  migrateDecorLocations(doc);
  // Commentaires d'avant les versions : à la première, pour ne plus suivre le texte des suivantes.
  if (doc.versions?.length) adoptUnversionedComments(doc, doc.versions[0].id);
  // Références cassées (fichier abîmé, ancienne version, synchronisation interrompue) : réparées
  // plutôt que de faire planter l'affichage.
  p.sequenceIds = p.sequenceIds.filter((id, i, all) => isObject(doc.sequences[id]) && all.indexOf(id) === i);
  for (const seq of Object.values(doc.sequences)) {
    seq.label ??= '';
    seq.characterIds ??= [];
    seq.shotIds = (seq.shotIds ?? []).filter((id) => isObject(doc.shots[id]));
    seq.actionBlockIds ??= [];
  }
  for (const [id, shot] of Object.entries(doc.shots)) {
    const seq = doc.sequences[shot.sequenceId];
    if (!seq || !seq.shotIds.includes(id)) {
      delete doc.shots[id];
      continue;
    }
    shot.id = id;
    shot.subject ??= '';
    shot.value ??= '';
    shot.characterIds ??= [];
    shot.angle ??= [];
    shot.movement ??= [];
    shot.focal ??= {};
    shot.status ??= 'à tourner';
    if (!doc.blocks[shot.actionBlockId]) {
      const block = makeBlock(seq.id, { text: '' });
      doc.blocks[block.id] = block;
      shot.actionBlockId = block.id;
    }
  }
  for (const [id, b] of Object.entries(doc.blocks)) {
    if (!doc.sequences[b.sequenceId]) delete doc.blocks[id];
    else b.text ??= '';
  }
  for (const seq of Object.values(doc.sequences)) {
    const used = new Set(seq.shotIds.map((id) => doc.shots[id].actionBlockId));
    seq.actionBlockIds = [...new Set([...seq.actionBlockIds.filter((id) => used.has(id)), ...used])];
  }
  // Mode « durée de chaque plan » : l'ancienne durée d'action (× nombre de plans) devient la durée de chaque plan.
  if (p.settings.tcMode === 'duree') {
    for (const seq of Object.values(doc.sequences)) {
      for (const bId of seq.actionBlockIds) {
        const b = doc.blocks[bId];
        const own = seq.shotIds.map((id) => doc.shots[id]).filter((sh) => sh.actionBlockId === bId);
        if (b?.overrideSec === undefined || !own.length || own.some((sh) => sh.durationSec !== undefined)) continue;
        for (const sh of own) sh.durationSec = Math.round(b.overrideSec / own.length);
        b.overrideSec = undefined;
      }
      seq.overrideSec = undefined;
    }
  }
  normalizeScenario(doc);
  migrateBreakdownCharacters(doc);
  // Plans d'interview remis d'accord avec la fiche (fichier modifié ailleurs, ancienne version).
  syncInterviewShots(doc);
  // Calendrier de production relu : données abîmées écartées, étape liée recalée sur le plan de travail.
  normalizeProduction(doc);
  normalizeCalendar(doc);
  syncProduction(doc);
  ensureDayIds(doc);
  return doc;
}

/** Début des noms de fichiers exportés : titre nettoyé et version (« rav3-v3 »), sans extension. */
export function exportBase(doc: ProjectDoc): string {
  return fileNameFor(doc).slice(0, -FILE_EXTENSION.length);
}

/**
 * Copie d'un projet sous un nouvel identifiant : sans le lien de sa relecture en ligne (le fichier
 * publié reste à l'original ; la copie publiera le sien).
 */
export function projectCopy(doc: ProjectDoc, id: string): ProjectDoc {
  return withoutReview({ ...doc, project: { ...doc.project, id, title: `${doc.project.title} (copie)` } });
}

/** Le projet sans sa relecture en ligne (copie, projet reçu d'un partage en direct). */
export function withoutReview(doc: ProjectDoc): ProjectDoc {
  if (!doc.review) return doc;
  const out: ProjectDoc = { ...doc };
  delete out.review;
  return out;
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
