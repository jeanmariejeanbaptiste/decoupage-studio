import { nanoid } from 'nanoid';
import { DEFAULT_COLUMNS, SCHEMA_VERSION } from './types';
import type { ActionBlock, ID, Project, ProjectDoc, ProjectFormat, ProjectSettings, Sequence, Shot } from './types';
import { EMPTY_CUSTOM_VOCABULARY } from './vocabulary';

export const newId = (): ID => nanoid(10);

export function defaultSettings(format: ProjectFormat): ProjectSettings {
  const musical = format === 'clip' || format === 'pub';
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

/**
 * Format et minutage vont ensemble : clip et publicité se calent sur une piste musicale, les autres
 * formats comptent la durée de chaque plan. Changer l'un met l'autre à jour.
 */
export function applyFormat(doc: ProjectDoc, format: ProjectFormat): void {
  const def = defaultSettings(format);
  const st = doc.project.settings;
  doc.project.format = format;
  st.tcMode = def.tcMode;
  st.tcGranularity = def.tcGranularity;
  st.tcModeChosen = false;
  if (st.tcMode === 'piste') st.audioTrack ??= { name: 'Piste musicale', durationSec: 0 };
}
