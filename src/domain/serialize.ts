import { richImageKeys } from './richText';
import { ensureInterview, syncInterviewShots, upgradeInterview } from './interview';
import { defaultSettings, makeBlock } from './factory';
import { normalizeBlocks } from './ops';
import { normalizeScenario } from './fountain';
import { storedShots } from './versions';
import { adoptUnversionedComments, commentAttachments } from './comments';
import { migrateDecorLocations } from './locations';
import { migrateBreakdownCharacters } from './breakdown';
import { normalizeProduction, syncProduction } from './production';
import { ensureDayIds } from './schedule';
import { activeColumns, COLUMN_DEFS } from './columns';
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
    const media = raw && typeof raw.media === 'object' && raw.media ? raw.media : {};
    // Entrées abîmées (sans données ni type) : ignorées.
    return Object.fromEntries(Object.entries(media).filter(([, m]) => m && typeof m.data === 'string' && typeof m.type === 'string'));
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
  try {
    return migrate(candidate as unknown as ProjectDoc);
  } catch (e) {
    // Jamais de message technique (en anglais) à l'écran : l'erreur reste dans la console.
    if (e instanceof ProjectFileError) throw e;
    console.error(e);
    throw new ProjectFileError('Ce fichier est endommagé et n’a pas pu être ouvert.');
  }
}

/** Tableau relu d'un fichier : autre chose qu'un tableau compte pour vide. */
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const isText = (v: unknown): v is string => typeof v === 'string';
/** Liste d'identifiants relue : entrées vides ou d'un autre type écartées, doublons retirés. */
const ids = (x: unknown): string[] => [...new Set(list<unknown>(x).filter((v): v is string => isText(v) && v !== ''))];
/** Entrées abîmées (null, texte, nombre) d'une table retirées. */
function dropBroken(table: Record<string, unknown>): void {
  for (const [id, v] of Object.entries(table)) if (!isObject(v)) delete table[id];
}
/** Champ facultatif d'un autre type que prévu (fichier abîmé) : retiré. */
function dropIfNot(o: object, key: string, ok: (v: unknown) => boolean): void {
  const r = o as Record<string, unknown>;
  if (r[key] !== undefined && !ok(r[key])) delete r[key];
}

/**
 * Réglages relus : un réglage nul ou d'un autre type que sa valeur par défaut la reprend (sinon
 * `{ ...défauts, ...réglages }` laisserait passer un `null` qui fait planter l'affichage).
 */
function repairSettings(p: ProjectDoc['project']): void {
  const def = defaultSettings(p.format ?? 'fiction') as unknown as Record<string, unknown>;
  const st: Record<string, unknown> = { ...def, ...(isObject(p.settings) ? p.settings : {}) };
  for (const [k, v] of Object.entries(def)) {
    const cur = st[k];
    if (cur === null || cur === undefined || Array.isArray(cur) !== Array.isArray(v) || typeof cur !== typeof v) st[k] = structuredClone(v);
  }
  for (const k of ['gridColumns', 'exportColumns', 'neverMerge']) st[k] = ids(st[k]).filter((c) => c in COLUMN_DEFS);
  p.settings = st as unknown as ProjectDoc['project']['settings'];
}

/** Sections facultatives d'un autre type que prévu : retirées ; listes débarrassées des entrées nulles. */
function repairSections(doc: ProjectDoc): void {
  for (const k of ['scenario', 'intention', 'intentionHtml', 'activeVersionId']) dropIfNot(doc, k, isText);
  for (const k of ['floorPlans', 'breakdown', 'geocodes', 'schedule', 'research', 'interview', 'review', 'production']) dropIfNot(doc, k, isObject);
  const d = doc as unknown as Record<string, unknown>;
  for (const k of ['versions', 'comments', 'clearedScenarios', 'calendar', 'breakdownExtra', 'equipmentExtra']) {
    dropIfNot(doc, k, Array.isArray);
    if (Array.isArray(d[k])) d[k] = (d[k] as unknown[]).filter(k.endsWith('Extra') ? isText : isObject);
  }
  for (const k of ['floorPlans', 'breakdown', 'geocodes'] as const) if (doc[k]) dropBroken(doc[k] as Record<string, unknown>);
  // Adresse géocodée sans coordonnées valables (ni marquée introuvable) : la carte planterait ; on la recherchera.
  for (const [key, g] of Object.entries(doc.geocodes ?? {})) if (g.missing !== true && !(Number.isFinite(g.lat) && Number.isFinite(g.lon))) delete doc.geocodes![key];
  // Commentaires : sans identifiant ni ancre, ils ne s'afficheraient nulle part ; le reste est complété.
  if (doc.comments) doc.comments = doc.comments.filter((c) => isText(c.id) && isObject(c.anchor));
  for (const c of doc.comments ?? []) {
    c.replies = list<unknown>(c.replies).filter(isObject) as unknown as typeof c.replies;
    for (const x of [c, ...c.replies]) {
      if (!isText(x.text)) x.text = '';
      if (!isText(x.author)) x.author = '';
      dropIfNot(x, 'attachments', Array.isArray);
      if (x.attachments) x.attachments = x.attachments.filter(isText);
    }
  }
  if (doc.schedule) {
    doc.schedule.days = list<unknown>(doc.schedule.days).filter(isObject) as unknown as typeof doc.schedule.days;
    dropIfNot(doc.schedule, 'order', Array.isArray);
    if (doc.schedule.order) doc.schedule.order = ids(doc.schedule.order);
  }
  doc.ignoredChecks = list<unknown>(doc.ignoredChecks).filter(isText);
  doc.validatedSteps = list<unknown>(doc.validatedSteps).filter((n): n is number => typeof n === 'number');
  doc.manualEquipment = list<unknown>(doc.manualEquipment).filter(isObject) as unknown as typeof doc.manualEquipment;
  const vocab = { ...structuredClone(EMPTY_CUSTOM_VOCABULARY), ...(isObject(doc.customVocabulary) ? doc.customVocabulary : {}) };
  for (const k of Object.keys(EMPTY_CUSTOM_VOCABULARY) as Array<keyof typeof vocab>) {
    vocab[k] = list<unknown>(vocab[k]).filter(isObject) as unknown as (typeof vocab)[typeof k];
    for (const e of vocab[k]) if (!Array.isArray(e.aliases)) e.aliases = [];
  }
  doc.customVocabulary = vocab;
}

/**
 * Structure du découpage remise d'aplomb (fichier abîmé, synchronisation interrompue, ancienne
 * version) : entrées nulles retirées, chaque plan dans une seule séquence, chaque action contiguë
 * dans la séquence de ses plans, références pendantes oubliées. Ne change rien à un projet sain.
 */
function repairStructure(doc: ProjectDoc): void {
  const p = doc.project;
  for (const key of ['sequences', 'shots', 'blocks', 'characters', 'decors'] as const) dropBroken(doc[key] as Record<string, unknown>);
  for (const table of [doc.characters, doc.decors]) {
    for (const [id, x] of Object.entries(table)) {
      x.id = id;
      if (!isText(x.name)) x.name = '';
      dropIfNot(x, 'aliases', Array.isArray);
      if (x.aliases) x.aliases = list<unknown>(x.aliases).filter(isText);
    }
  }
  const knownCharacters = (x: unknown) => ids(x).filter((id) => doc.characters[id]);
  // Séquences présentes mais absentes de l'ordre : remises à la fin plutôt que perdues.
  const order = ids(p.sequenceIds).filter((id) => doc.sequences[id]);
  for (const id of Object.keys(doc.sequences)) if (!order.includes(id)) order.push(id);
  p.sequenceIds = order;
  // Un plan n'appartient qu'à une séquence : la première qui le liste.
  const owner = new Map<string, string>();
  for (const seqId of order) {
    const seq = doc.sequences[seqId];
    seq.id = seqId;
    if (!isText(seq.label)) seq.label = '';
    seq.characterIds = knownCharacters(seq.characterIds);
    if (seq.decorId !== undefined && !doc.decors[seq.decorId]) delete seq.decorId;
    seq.shotIds = ids(seq.shotIds).filter((id) => doc.shots[id] && !owner.has(id));
    for (const id of seq.shotIds) owner.set(id, seqId);
    seq.actionBlockIds = ids(seq.actionBlockIds);
  }
  for (const [id, b] of Object.entries(doc.blocks)) {
    if (!isText(b.sequenceId) || !doc.sequences[b.sequenceId]) delete doc.blocks[id];
    else {
      b.id = id;
      if (!isText(b.text)) b.text = '';
    }
  }
  for (const [id, shot] of Object.entries(doc.shots)) {
    const seqId = owner.get(id);
    // Plan qu'aucune séquence ne liste : il ne s'affichait nulle part.
    if (!seqId) {
      delete doc.shots[id];
      continue;
    }
    shot.id = id;
    shot.sequenceId = seqId;
    if (!isText(shot.subject)) shot.subject = '';
    if (!isText(shot.value)) shot.value = '';
    shot.characterIds = knownCharacters(shot.characterIds);
    shot.angle = list<unknown>(shot.angle).filter(isText);
    shot.movement = list<unknown>(shot.movement).filter(isText);
    if (!isObject(shot.focal)) shot.focal = {};
    shot.status ??= 'à tourner';
    dropIfNot(shot, 'storyboard', isObject);
    dropIfNot(shot, 'keyframes', Array.isArray);
    if (shot.keyframes) shot.keyframes = shot.keyframes.filter(isObject);
    dropIfNot(shot, 'mergeBreak', Array.isArray);
    if (!doc.blocks[shot.actionBlockId]) {
      const block = makeBlock(seqId, { text: '' });
      doc.blocks[block.id] = block;
      shot.actionBlockId = block.id;
    }
  }
  // Actions contiguës et dans la séquence de leurs plans ; celles qu'aucun plan n'utilise partent.
  for (const seqId of order) normalizeBlocks(doc, seqId);
  for (const [id, b] of Object.entries(doc.blocks)) if (!doc.sequences[b.sequenceId].actionBlockIds.includes(id)) delete doc.blocks[id];
}

export function migrate(input: ProjectDoc): ProjectDoc {
  const doc = structuredClone(input);
  const p = doc.project;
  if (!isObject(p)) throw new ProjectFileError('Ce fichier ne contient pas de projet Découpage Studio.');
  for (const key of ['sequences', 'shots', 'blocks', 'characters', 'decors'] as const) {
    if (!isObject(doc[key])) throw new ProjectFileError(`Section « ${key} » manquante ou invalide.`);
  }
  if (!Array.isArray(p.sequenceIds)) throw new ProjectFileError('Ordre des séquences manquant.');
  if (typeof p.id !== 'string' || !p.id) throw new ProjectFileError('Identifiant de projet manquant.');
  repairSettings(p);
  p.settings.gridColumns = activeColumns(p.settings.gridColumns);
  p.settings.exportColumns = activeColumns(p.settings.exportColumns);
  // Projets d'avant le mode « durée de chaque plan » : ils y passent, sauf choix explicite.
  if (p.settings.tcMode === 'cumulatif' && !p.settings.tcModeChosen) p.settings.tcMode = 'duree';
  // Données abîmées (fichier modifié à la main, synchronisation interrompue, ancienne version) :
  // réparées plutôt que de faire planter l'affichage.
  repairSections(doc);
  repairStructure(doc);
  normalizeTiming(doc);
  upgradeInterview(doc);
  if (p.format === 'institutionnel') ensureInterview(doc);
  p.schemaVersion = SCHEMA_VERSION;
  if (!isText(p.title)) p.title = 'Projet sans titre';
  if (!isText(p.version)) p.version = 'V1';
  migrateDecorLocations(doc);
  // Commentaires d'avant les versions : à la première, pour ne plus suivre le texte des suivantes.
  if (doc.versions?.length) adoptUnversionedComments(doc, doc.versions[0].id);
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

/** Longueur maximale du nom (avant l'extension) : loin des 255 octets des systèmes de fichiers. */
const MAX_BASE = 80;

export function fileNameFor(doc: ProjectDoc): string {
  // Accents des lettres latines retirés ; les autres écritures (cyrillique, grec, japonais…) gardées.
  const base = `${doc.project.title || 'projet'} ${doc.project.version ?? ''}`
    .trim()
    .normalize('NFD')
    .replace(/([A-Za-z])[̀-ͯ]+/g, '$1')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const short = Array.from(base).slice(0, MAX_BASE).join('').replace(/-+$/, '');
  return `${short || 'projet'}${FILE_EXTENSION}`;
}
