import { sequenceCharacterIds } from './characters';
import { newId } from './factory';
import { refreshRecognition } from './ops';
import type { Timing } from './timing';
import type { Decor, ID, ProjectDoc } from './types';

export interface CharacterStats {
  sequenceIds: ID[];
  shotIds: ID[];
}

/** Séquences et plans où apparaît chaque personnage (§7). */
export function characterStats(doc: ProjectDoc): Map<ID, CharacterStats> {
  const out = new Map<ID, CharacterStats>();
  for (const id of Object.keys(doc.characters)) out.set(id, { sequenceIds: [], shotIds: [] });
  for (const seqId of doc.project.sequenceIds) {
    for (const c of sequenceCharacterIds(doc, seqId)) out.get(c)?.sequenceIds.push(seqId);
    for (const shotId of doc.sequences[seqId]?.shotIds ?? []) {
      for (const c of doc.shots[shotId]?.characterIds ?? []) out.get(c)?.shotIds.push(shotId);
    }
  }
  return out;
}

/** Séquences d'un décor et durée totale à y tourner (§7). */
export function decorStats(doc: ProjectDoc, timing: Timing): Map<ID, { sequenceIds: ID[]; totalSec: number }> {
  const out = new Map<ID, { sequenceIds: ID[]; totalSec: number }>();
  for (const id of Object.keys(doc.decors)) out.set(id, { sequenceIds: [], totalSec: 0 });
  for (const seqId of doc.project.sequenceIds) {
    const seq = doc.sequences[seqId];
    const entry = seq?.decorId ? out.get(seq.decorId) : undefined;
    if (!entry) continue;
    entry.sequenceIds.push(seqId);
    entry.totalSec += timing.sequences.get(seqId)?.durationSec ?? 0;
  }
  return out;
}

export function sequenceProgress(doc: ProjectDoc, seqId: ID): { done: number; total: number } {
  const ids = (doc.sequences[seqId]?.shotIds ?? []).filter((id) => doc.shots[id]?.status !== 'abandonné');
  return { done: ids.filter((id) => doc.shots[id]?.status === 'tourné').length, total: ids.length };
}

export function deleteCharacter(doc: ProjectDoc, id: ID): void {
  delete doc.characters[id];
  for (const seq of Object.values(doc.sequences)) seq.characterIds = seq.characterIds.filter((c) => c !== id);
  refreshRecognition(doc);
}

export function addDecor(doc: ProjectDoc, init: Partial<Decor> & { name: string }): ID {
  const d: Decor = { id: newId(), ...init };
  doc.decors[d.id] = d;
  return d.id;
}

export function deleteDecor(doc: ProjectDoc, id: ID): void {
  delete doc.decors[id];
  for (const seq of Object.values(doc.sequences)) if (seq.decorId === id) seq.decorId = undefined;
}

/** Décor d'une séquence : rattache à un décor existant de même nom, sinon le crée. */
export function setSequenceDecorByName(doc: ProjectDoc, seqId: ID, name: string): void {
  const seq = doc.sequences[seqId];
  if (!seq) return;
  const n = name.trim();
  if (!n) {
    seq.decorId = undefined;
    return;
  }
  const existing = Object.values(doc.decors).find((d) => d.name.toLowerCase() === n.toLowerCase());
  seq.decorId = existing?.id ?? addDecor(doc, { name: n, intExt: seq.intExt });
}
