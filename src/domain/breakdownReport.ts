/**
 * Index du dépouillement sur tout le film : chaque élément, ses séquences, sa durée à l'écran et ses
 * jours de tournage (comme les rapports du scénario, mais pour les accessoires, costumes, effets…).
 */
import { addedCharacters, breakdownCategories, breakdownOf, derivedBreakdown, type BreakdownCategory } from './breakdown';
import { stripsByDay } from './schedule';
import { fold } from './text';
import type { Timing } from './timing';
import type { ID, ProjectDoc } from './types';

export interface BreakdownEntry {
  cat: BreakdownCategory;
  /** Libellé tel qu'écrit à sa première apparition. */
  item: string;
  /** Séquences où il figure, dans l'ordre du film. */
  seqIds: ID[];
  /** Séquences où il a été saisi (les autres le tiennent du découpage : personnages, matériel). */
  manualSeqIds: ID[];
  /** Jours de tournage de ces séquences (plan de travail), triés. */
  days: number[];
  /** Durée à l'écran cumulée de ces séquences (s). */
  totalSec: number;
}

/** Jours de tournage de chaque séquence. */
function daysBySequence(doc: ProjectDoc): Map<ID, number[]> {
  const out = new Map<ID, number[]>();
  for (const [day, strips] of stripsByDay(doc)) {
    if (day <= 0) continue;
    for (const s of strips) out.set(s.seqId, [...(out.get(s.seqId) ?? []), day]);
  }
  return out;
}

/** Tous les éléments du dépouillement, par catégorie puis par ordre d'apparition. */
export function breakdownIndex(doc: ProjectDoc, timing?: Timing): BreakdownEntry[] {
  const cats = breakdownCategories(doc);
  const byKey = new Map<string, BreakdownEntry>();
  const order: string[] = [];
  const days = daysBySequence(doc);
  for (const seqId of doc.project.sequenceIds) {
    const manual = breakdownOf(doc, seqId);
    const derived = derivedBreakdown(doc, seqId);
    // Personnages ajoutés à la séquence (pas nommés par ses plans) : saisis, donc retirables.
    const added = addedCharacters(doc, seqId);
    for (const cat of cats) {
      const seen = new Set<string>();
      const add = (item: string, isManual: boolean) => {
        const name = item.trim();
        if (!name) return;
        const key = `${cat}|${fold(name)}`;
        let e = byKey.get(key);
        if (!e) {
          e = { cat, item: name, seqIds: [], manualSeqIds: [], days: [], totalSec: 0 };
          byKey.set(key, e);
          order.push(key);
        }
        if (isManual && !e.manualSeqIds.includes(seqId)) e.manualSeqIds.push(seqId);
        if (seen.has(key)) return;
        seen.add(key);
        e.seqIds.push(seqId);
        e.totalSec += timing?.sequences.get(seqId)?.durationSec ?? 0;
        for (const d of days.get(seqId) ?? []) if (!e.days.includes(d)) e.days.push(d);
      };
      for (const item of manual[cat] ?? []) add(item, true);
      for (const item of derived[cat] ?? []) add(item, !!added[cat]?.includes(item));
    }
  }
  const rank = new Map(cats.map((c, i) => [c, i]));
  const entries = order.map((k) => byKey.get(k)!);
  for (const e of entries) e.days.sort((a, b) => a - b);
  return entries.sort((a, b) => (rank.get(a.cat) ?? 99) - (rank.get(b.cat) ?? 99));
}

/** Nombre d'éléments par catégorie dans une séquence (rapport par séquence). */
export function sequenceCounts(entries: readonly BreakdownEntry[], seqId: ID): Map<BreakdownCategory, number> {
  const out = new Map<BreakdownCategory, number>();
  for (const e of entries) if (e.seqIds.includes(seqId)) out.set(e.cat, (out.get(e.cat) ?? 0) + 1);
  return out;
}
