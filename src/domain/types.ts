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

export type EquipmentCategory = 'Image' | 'Machinerie' | 'Lumière' | 'Son';

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
}

export const SCHEMA_VERSION = 1;
