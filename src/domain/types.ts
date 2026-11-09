export type ID = string;

export type ProjectFormat = 'fiction' | 'clip' | 'documentaire' | 'institutionnel' | 'pub';
export type IntExt = 'INT' | 'EXT' | 'INT/EXT';
export type Effect = 'JOUR' | 'NUIT' | 'AUBE' | 'CRÉPUSCULE';
export type ShotStatus = 'à tourner' | 'tourné' | 'abandonné';
export type CharacterKind = 'principal' | 'secondaire' | 'figurant' | 'silhouette' | 'voix off';
export type Sensor = 'FF' | 'S35' | 'APSC' | 'M43' | 'custom';
export type ExportTheme = 'mauve' | 'papier' | 'sobre';
export type ShotCodeFormat = '{seq}.{shot}' | '{seq}-{shot}' | '{seq}{letter}';

export const DEFAULT_COLUMNS = [
  'sequence',
  'number',
  'subject',
  'value',
  'angle',
  'movement',
  'focal',
  'action',
  'tc',
] as const;

export const OPTIONAL_COLUMNS = [
  'aperture',
  'characters',
  'dialogue',
  'sound',
  'light',
  'grip',
  'shotDuration',
  'shootingDay',
  'status',
  'notes',
] as const;

export type DefaultColumnKey = (typeof DEFAULT_COLUMNS)[number];
export type OptionalColumnKey = (typeof OPTIONAL_COLUMNS)[number];
export type ColumnKey = DefaultColumnKey | OptionalColumnKey;

export interface AudioTrack {
  name: string;
  durationSec: number;
  blobKey?: string;
}

export interface ProjectSettings {
  /** Durée de chaque plan (par défaut), minutage cumulatif, ou TC calé sur une piste musicale. */
  tcMode: 'duree' | 'cumulatif' | 'piste';
  /** Mode de TC choisi explicitement dans les réglages (sinon les anciens projets passent en durée). */
  tcModeChosen?: boolean;
  tcGranularity: 'sequence' | 'action';
  /** Minutage du scénario (méthodes de KIT) ; absent = une page par minute. */
  scriptChrono?: Partial<import('./chronometry').ScriptChrono>;
  dialogueWordsPerSecond: number;
  actionWordsPerSecond: number;
  minActionSeconds: number;
  sensor: Sensor;
  cropFactor: number;
  fps: 25;
  labelStyle: 'court' | 'long';
  shotCodeFormat: ShotCodeFormat;
  exportTheme: ExportTheme;
  exportColumns: ColumnKey[];
  gridColumns: ColumnKey[];
  audioTrack?: AudioTrack;
  /** Colonnes à ne jamais fusionner à l'export (Réglages → Export). */
  neverMerge: ColumnKey[];
  exportPaper: 'A4' | 'A3';
  /** Économie d'encre : aucun aplat de couleur à l'impression (texte et filets seulement). */
  exportInkSaver?: boolean;
  /** Exporter le découpage sans fusion de cellules. */
  exportNoMerge?: boolean;
  /** Export intelligent : sur chaque page, les colonnes facultatives vides sont masquées. */
  exportSmart?: boolean;
  /** Passages du scénario ajoutés au découpage : rangés d'office dans la séquence de leur scène, ou séquence choisie. */
  scenarioLink?: 'auto' | 'free';
  /** Orientation des pages exportées (PDF et images). */
  exportOrientation?: 'landscape' | 'portrait';
  /** Format des images du storyboard (largeur : hauteur). */
  storyboardAspect?: { w: number; h: number };
  /** Cartes par ligne dans la page Storyboard (absent = automatique). */
  storyboardPerRow?: number;
  /** Derniers réglages d'export par page (orientation, numérotation, plans par feuille…). */
  exportPrefs?: Record<string, { orientation?: 'landscape' | 'portrait'; numbers?: boolean; perPage?: number }>;
  exportFooter: boolean;
}

export interface Project {
  id: ID;
  schemaVersion: number;
  title: string;
  director?: string;
  dop?: string;
  version: string;
  format: ProjectFormat;
  settings: ProjectSettings;
  sequenceIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface Sequence {
  id: ID;
  label: string;
  decorId?: ID;
  intExt?: IntExt;
  effect?: Effect;
  /** Ajouts manuels ; la liste effective = union avec les sujets reconnus. */
  characterIds: ID[];
  estimatedSec?: number;
  /** Durée manuelle de la séquence (granularité « séquence » en mode cumulatif). */
  overrideSec?: number;
  summary?: string;
  color?: string;
  shotIds: ID[];
  actionBlockIds: ID[];
  scenarioAnchor?: { start: number; end: number };
  /** Institutionnel (B-roll) : créneau horaire de tournage, « 10:30–11:00 ». */
  slot?: string;
}

export interface TrackRange {
  in?: number;
  out?: number;
  all?: boolean;
}

export interface ActionBlock {
  id: ID;
  sequenceId: ID;
  text: string;
  dialogue?: string;
  overrideSec?: number;
  tc?: TrackRange;
  scenarioAnchor?: { start: number; end: number };
}

export interface Focal {
  from?: number;
  to?: number;
}

export interface Shot {
  id: ID;
  sequenceId: ID;
  subject: string;
  characterIds: ID[];
  value: string;
  angle: string[];
  movement: string[];
  /** Séparateur saisi entre les jetons de mouvement, préservé à l'export (§5.3). */
  movementSep?: ', ' | ' + ';
  focal: Focal;
  /** Ouverture (nombre f, ex. 2.8) : colonne facultative, règle le flou d'arrière-plan des vignettes. */
  aperture?: number;
  actionBlockId: ID;
  sound?: string;
  light?: string;
  notes?: string;
  status: ShotStatus;
  /** Image affichée ; `baseKey` = image d'origine sous le dessin, `sketch` = annotations modifiables. */
  storyboard?: { blobKey: string } & Omit<import('./keyframes').Frame, 'blobKey'>;
  /** Keyframes supplémentaires du même plan (la première reste `storyboard`). */
  keyframes?: Array<{ id: ID } & import('./keyframes').Frame>;
  shootingDay?: number;
  /** Mode « durée de chaque plan » : durée saisie pour ce plan (sinon sa part de l'action). */
  durationSec?: number;
  /** Coupure de fusion forcée avant ce plan, pour les colonnes listées (§12). */
  mergeBreak?: ColumnKey[];
  /** Plan-séquence : un seul plan découpé en temps chorégraphiques. */
  oneShot?: { beats: OneShotBeat[] };
  /** Institutionnel : plan tourné par une caméra d'un cadre d'interview (synchronisé avec la fiche). */
  interview?: { subjectId: ID; setupId: ID; cameraId: ID };
}

/** Un temps du plan-séquence : ce que voit la caméra entre deux repères. */
export interface OneShotBeat {
  id: ID;
  value: string;
  subject: string;
  angle: string;
  movement: string;
  /** Repères : position caméra, déplacement des comédiens, déclencheur du temps suivant. */
  cue?: string;
  /** Liaison vers le temps suivant : le mouvement qui fait passer d'un sujet ou d'un cadre à l'autre. */
  bridge?: string;
  /** Focale du temps (mm) : elle peut changer en cours de plan (zoom). */
  focal?: number;
  /** Fourchette de durée (s) : le jeu des comédiens fait varier le temps réel. */
  minSec?: number;
  maxSec?: number;
}

export interface Character {
  id: ID;
  name: string;
  kind: CharacterKind;
  color?: string;
  actor?: string;
  notes?: string;
  aliases?: string[];
  /** Fiche du personnage (module Personnages du scénario). */
  age?: string;
  costume?: string;
}

/** Recherche du projet : genre, logline, synopsis et documents libres. */
export interface Research {
  genre?: string;
  year?: string;
  logline?: string;
  synopsis?: string;
  docs?: Array<{ id: ID; title: string; text: string }>;
}

/** Lieu de tournage réel d'un décor (le décor, lui, est le lieu du scénario). */
export interface FilmingLocation {
  /** Nom du lieu (« Lycée Voltaire »), quand il diffère du décor. */
  name?: string;
  address?: string;
  /** Accès, stationnement, base technique. */
  access?: string;
  /** Contact sur place (nom, téléphone). */
  contact?: string;
}

export interface Decor {
  id: ID;
  name: string;
  intExt?: IntExt;
  /** Ancien champ (adresse de tournage), repris dans `location.address` à l'ouverture du projet. */
  address?: string;
  location?: FilmingLocation;
  notes?: string;
  /** Anciens noms (renommé dans une version : les autres, figées, l'écrivent encore). */
  aliases?: string[];
}

export interface VocabEntry {
  key: string;
  short: string;
  long: string;
  abbr?: string;
  aliases: string[];
}

export interface CustomVocabulary {
  value: VocabEntry[];
  angle: VocabEntry[];
  movement: VocabEntry[];
}

export interface ManualEquipment {
  id: ID;
  category: EquipmentCategory;
  label: string;
  shotIds: ID[];
}

/** Postes de base, plus ceux que l'utilisateur ajoute (`equipmentExtra`). */
export type EquipmentCategory = 'Image' | 'Machinerie' | 'Lumière' | 'Son' | (string & {});

/** Le projet complet, tel qu'il est stocké et échangé (fichier `.decoupage`). */
export interface ProjectDoc {
  project: Project;
  sequences: Record<ID, Sequence>;
  shots: Record<ID, Shot>;
  blocks: Record<ID, ActionBlock>;
  characters: Record<ID, Character>;
  decors: Record<ID, Decor>;
  ignoredChecks: string[];
  validatedSteps: number[];
  customVocabulary: CustomVocabulary;
  manualEquipment: ManualEquipment[];
  scenario?: string;
  /** Note d'intention en texte brut (comptes de mots, assistant, export texte), tenue à jour par l'éditeur. */
  intention?: string;
  /** Note d'intention mise en forme (HTML réduit, voir `richText.ts`). */
  intentionHtml?: string;
  /** Plans au sol, par séquence (§15.2). */
  floorPlans?: Record<ID, import('./floorplan').FloorPlan>;
  /** Plan de travail : jours de tournage et ordre des séquences (§15.3). */
  schedule?: import('./schedule').Schedule & { order?: ID[] };
  /** Dépouillement manuel par séquence (§15.5). */
  breakdown?: Record<ID, import('./breakdown').SequenceBreakdown>;
  /** Catégories de dépouillement ajoutées par l'utilisateur (libellés). */
  breakdownExtra?: string[];
  /** Postes de matériel ajoutés par l'utilisateur. */
  equipmentExtra?: string[];
  /** Recherche (scénario) : genre, logline, synopsis, documents. */
  research?: Research;
  /** Institutionnel : l'interview (A-roll). */
  interview?: import('./interview').Interview;
  /** Versions du film (V1, V2…), voir `versions.ts` ; la courante vit dans le projet lui-même. */
  versions?: import('./versions').ProjectVersion[];
  activeVersionId?: ID;
  /** Commentaires de relecture (scénario, découpage), par version (`comments.ts`). */
  comments?: import('./comments').ReviewComment[];
  /** Textes de scénario effacés, mis de côté pour être rétablis (`versions.ts`). */
  clearedScenarios?: import('./versions').ClearedScenario[];
  /** Calendrier : rendez-vous du projet (les jours de tournage viennent du plan de travail). */
  calendar?: import('./calendar').CalendarEvent[];
  /** Relecture en ligne (Google Drive) : version publiée pour les relecteurs (`reviewSnapshot.ts`). */
  review?: import('./reviewSnapshot').ReviewPublication;
  /** Calendrier de production : phases, étapes et jalons du film (`production.ts`), communs à toutes les versions. */
  production?: import('./production').Production;
}

export const SCHEMA_VERSION = 1;
