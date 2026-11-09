import { sequenceCharacterIds } from './characters';
import { newId } from './factory';
import { remapCharacter, refreshRecognition } from './ops';
import { scheduleDays, stripCharacterIds, stripsByDay, type Strip } from './schedule';
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

/** Numéro de chaque personnage : principaux d'abord, puis par nombre de séquences (repris partout). */
export function characterNumbers(doc: ProjectDoc): Map<ID, number> {
  const stats = characterStats(doc);
  const rank = (k: string) => (k === 'principal' ? 0 : k === 'secondaire' ? 1 : 2);
  const list = Object.values(doc.characters).sort(
    (a, b) => rank(a.kind) - rank(b.kind) || (stats.get(b.id)?.sequenceIds.length ?? 0) - (stats.get(a.id)?.sequenceIds.length ?? 0) || a.name.localeCompare(b.name, 'fr'),
  );
  return new Map(list.map((c, i) => [c.id, i + 1]));
}

/** Distribution numérotée, dans l'ordre des numéros : « 1 Léa, 3 Paul ». */
export function numberedCast(doc: ProjectDoc, ids: readonly ID[], nums: Map<ID, number> = characterNumbers(doc)): string {
  return ids
    .filter((id) => doc.characters[id])
    .sort((a, b) => (nums.get(a) ?? 999) - (nums.get(b) ?? 999))
    .map((id) => `${nums.get(id) ?? ''} ${doc.characters[id].name}`.trim())
    .join(', ');
}

/** Présence au plan de travail : jours de tournage (triés) et séquences du scénario. */
export interface ScheduleUsage {
  days: number[];
  sequenceIds: ID[];
}

function usage(doc: ProjectDoc, ids: readonly ID[], sequenceIds: (id: ID) => ID[], present: (strip: Strip) => ID[]): Map<ID, ScheduleUsage> {
  const out = new Map<ID, ScheduleUsage>(ids.map((id) => [id, { days: [], sequenceIds: sequenceIds(id) }]));
  for (const [day, strips] of stripsByDay(doc)) {
    if (day <= 0) continue;
    for (const strip of strips)
      for (const id of present(strip)) {
        const u = out.get(id);
        if (u && !u.days.includes(day)) u.days.push(day);
      }
  }
  for (const u of out.values()) u.days.sort((a, b) => a - b);
  return out;
}

/** Personnages : jours de tournage où ils sont dans une bande, et séquences où ils apparaissent. */
export function characterUsage(doc: ProjectDoc): Map<ID, ScheduleUsage> {
  const stats = characterStats(doc);
  return usage(doc, Object.keys(doc.characters), (id) => stats.get(id)?.sequenceIds ?? [], (strip) => stripCharacterIds(doc, strip));
}

/** Décors : jours de tournage et séquences qui s'y passent. */
export function decorUsage(doc: ProjectDoc): Map<ID, ScheduleUsage> {
  const ids = Object.keys(doc.decors);
  return usage(
    doc,
    ids,
    (id) => doc.project.sequenceIds.filter((s) => doc.sequences[s]?.decorId === id),
    (strip) => {
      const d = doc.sequences[strip.seqId]?.decorId;
      return d ? [d] : [];
    },
  );
}

const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Premier jour de tournage, « J2 · 16 nov. » (date si elle est connue) ; vide s'il n'est pas planifié. */
export function usageDayLabel(doc: ProjectDoc, u: ScheduleUsage | undefined): string {
  const n = u?.days[0];
  if (n === undefined) return '';
  const date = scheduleDays(doc).find((d) => d.n === n)?.date;
  const t = date ? new Date(`${date}T12:00`) : undefined;
  return t && !Number.isNaN(t.getTime()) ? `J${n} · ${shortDate.format(t)}` : `J${n}`;
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
  remapCharacter(doc, id);
  refreshRecognition(doc);
}

export function addDecor(doc: ProjectDoc, init: Partial<Decor> & { name: string }): ID {
  const d: Decor = { id: newId(), ...init };
  doc.decors[d.id] = d;
  return d.id;
}

/** Supprime un décor partout, versions rangées comprises : aucune séquence n'y renvoie plus. */
export function deleteDecor(doc: ProjectDoc, id: ID): void {
  delete doc.decors[id];
  const seqs = [...Object.values(doc.sequences), ...(doc.versions ?? []).flatMap((v) => Object.values(v.slice?.sequences ?? {}))];
  for (const seq of seqs) if (seq.decorId === id) seq.decorId = undefined;
}

/**
 * Versions rangées (hors la courante) qui se servent encore de chaque décor ou personnage, par
 * leur nom. Ces fiches sont communes à toutes les versions : « inutilisé » ne vaut que si aucune
 * ne s'en sert.
 */
export function usageInOtherVersions(doc: ProjectDoc, kind: 'decor' | 'character'): Map<ID, string[]> {
  const out = new Map<ID, string[]>();
  const add = (id: ID | undefined, name: string) => {
    if (!id) return;
    const l = out.get(id) ?? [];
    if (!l.includes(name)) out.set(id, [...l, name]);
  };
  for (const v of doc.versions ?? []) {
    if (v.id === doc.activeVersionId || !v.slice) continue;
    for (const seqId of v.slice.sequenceIds) {
      const q = v.slice.sequences[seqId];
      if (!q) continue;
      if (kind === 'decor') add(q.decorId, v.name);
      else {
        for (const c of q.characterIds ?? []) add(c, v.name);
        for (const shotId of q.shotIds) for (const c of v.slice.shots[shotId]?.characterIds ?? []) add(c, v.name);
      }
    }
  }
  return out;
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
