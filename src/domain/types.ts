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
  tcMode: 'cumulatif' | 'piste';
  tcGranularity: 'sequence' | 'action';
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
  actionBlockId: ID;
  sound?: string;
  light?: string;
  notes?: string;
  status: ShotStatus;
  storyboard?: { blobKey: string };
  shootingDay?: number;
  /** Coupure de fusion forcée avant ce plan, pour les colonnes listées (§12). */
  mergeBreak?: ColumnKey[];
  /** Plan-séquence : un seul plan découpé en temps chorégraphiques. */
  oneShot?: { beats: OneShotBeat[] };
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
}

export interface Decor {
  id: ID;
  name: string;
  intExt?: IntExt;
  address?: string;
  notes?: string;
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
  intention?: string;
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
}

export const SCHEMA_VERSION = 1;
