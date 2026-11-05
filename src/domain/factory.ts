import { nanoid } from 'nanoid';
import { DEFAULT_COLUMNS, SCHEMA_VERSION } from './types';
import type { ActionBlock, ID, Project, ProjectDoc, ProjectFormat, ProjectSettings, Sequence, Shot } from './types';
import { EMPTY_CUSTOM_VOCABULARY } from './vocabulary';

export const newId = (): ID => nanoid(10);

export function defaultSettings(format: ProjectFormat): ProjectSettings {
  const musical = format === 'clip';
  return {
    tcMode: musical ? 'piste' : 'duree',
    tcGranularity: musical ? 'action' : 'sequence',
    dialogueWordsPerSecond: 2.5,
    actionWordsPerSecond: 2,
    minActionSeconds: 2,
    sensor: 'FF',
    cropFactor: 1,
    fps: 25,
    labelStyle: 'court',
    shotCodeFormat: '{seq}.{shot}',
    exportTheme: 'papier',
    exportColumns: [...DEFAULT_COLUMNS],
    gridColumns: [...DEFAULT_COLUMNS],
    neverMerge: [],
    exportPaper: 'A4',
    exportFooter: true,
  };
}

export function createProjectDoc(init: { title: string; format: ProjectFormat; director?: string; dop?: string; id?: ID }): ProjectDoc {
  const now = new Date().toISOString();
  const project: Project = {
    id: init.id ?? newId(),
    schemaVersion: SCHEMA_VERSION,
    title: init.title,
    director: init.director,
    dop: init.dop,
    version: 'V1',
    format: init.format,
    settings: defaultSettings(init.format),
    sequenceIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    project,
    sequences: {},
    shots: {},
    blocks: {},
    characters: {},
    decors: {},
    ignoredChecks: [],
    validatedSteps: [],
    customVocabulary: structuredClone(EMPTY_CUSTOM_VOCABULARY),
    manualEquipment: [],
  };
}

export function makeSequence(init: Partial<Sequence> = {}): Sequence {
  return { id: newId(), label: '', characterIds: [], shotIds: [], actionBlockIds: [], ...init };
}

export function makeBlock(sequenceId: ID, init: Partial<ActionBlock> = {}): ActionBlock {
  return { id: newId(), sequenceId, text: '', ...init };
}

export function makeShot(sequenceId: ID, actionBlockId: ID, init: Partial<Shot> = {}): Shot {
  return {
    id: newId(),
    sequenceId,
    actionBlockId,
    subject: '',
    characterIds: [],
    value: '',
    angle: [],
    movement: [],
    focal: {},
    status: 'à tourner',
    ...init,
  };
}

/** Le clip se cale sur une piste musicale ; la fiction et l'institutionnel non. */
export const isMusicalFormat = (f: ProjectFormat) => f === 'clip';

/**
 * Cohérence du minutage avec le format, appliquée partout (changement de format, modèle, ouverture
 * d'un projet) :
 * - clip : minutage sur la piste musicale, par action, piste toujours présente ;
 * - fiction (publicité comprise), institutionnel : jamais de piste ; durée de chaque plan ou cumulatif.
 */
export function normalizeTiming(doc: ProjectDoc): void {
  // Formats retirés : la publicité est de la fiction, le documentaire rejoint l'institutionnel.
  if (doc.project.format === 'pub') doc.project.format = 'fiction';
  if (doc.project.format === 'documentaire') doc.project.format = 'institutionnel';
  const st = doc.project.settings;
  if (isMusicalFormat(doc.project.format)) {
    st.tcMode = 'piste';
    st.tcGranularity = 'action';
    st.audioTrack ??= { name: 'Piste musicale', durationSec: 0 };
  } else if (st.tcMode === 'piste') {
    st.tcMode = 'duree';
    st.tcGranularity = 'sequence';
  }
}

/** Change le format du projet : son minutage par défaut suit. */
export function applyFormat(doc: ProjectDoc, format: ProjectFormat): void {
  const def = defaultSettings(format);
  doc.project.format = format;
  doc.project.settings.tcMode = def.tcMode;
  doc.project.settings.tcGranularity = def.tcGranularity;
  doc.project.settings.tcModeChosen = false;
  // Institutionnel : pas de minutage millimétré, la colonne TC devient facultative (masquée) ;
  // elle revient dans les autres formats.
  for (const key of ['gridColumns', 'exportColumns'] as const) {
    const cols = doc.project.settings[key];
    if (format === 'institutionnel') doc.project.settings[key] = cols.filter((c) => c !== 'tc');
    else if (!cols.includes('tc')) doc.project.settings[key] = [...cols, 'tc'];
  }
  normalizeTiming(doc);
}
