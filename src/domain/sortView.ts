import { sequenceNumber, shotNumber } from './numbering';
import { effectiveShot } from './rules';
import { canon } from './text';
import type { ActionBlock, ID, ProjectDoc, Sequence, Shot } from './types';
import { AXES, HEIGHTS, MOVEMENTS, matchVocab, valueRank } from './vocabulary';

/**
 * Découpage trié pour le tournage (« faire tous les plans larges d'abord », « tout ce qui est en
 * fixe », « par comédien »…). Rien n'est modifié : on fabrique une vue du projet où les plans sont
 * rangés autrement, en gardant leurs numéros d'origine (le clap ne change pas : 3.7, puis 1.6…).
 */

export type SortKey = 'value' | 'subject' | 'dialogue' | 'movement' | 'focal' | 'angle';
export interface SortCriterion {
  key: SortKey;
  /** Ordre inverse (du plus serré au plus large, plans parlés en dernier…). */
  desc?: boolean;
}
export interface SortOptions {
  criteria: SortCriterion[];
  /** Tout le film d'un seul tenant, ou chaque séquence pour elle-même. */
  scope: 'film' | 'sequence';
  /** Séquences retenues (toutes si absent). */
  seqIds?: ID[];
}

export const SORT_KEYS: ReadonlyArray<[SortKey, string]> = [
  ['value', 'Valeur'],
  ['subject', 'Sujet'],
  ['dialogue', 'Dialogue'],
  ['movement', 'Mouvement'],
  ['focal', 'Focale'],
  ['angle', 'Angle'],
];

const AXIS_ORDER = ['face', 'trois_quarts_face_gauche', 'trois_quarts_face', 'profil_gauche', 'profil', 'trois_quarts_dos_gauche', 'trois_quarts_dos', 'dos', 'trois_quarts_dos_droit', 'profil_droit', 'trois_quarts_face_droit'];

type Rank = number | string;

function rankOf(doc: ProjectDoc, shot: Shot, key: SortKey): Rank {
  const { shot: s, block } = effectiveShot(doc, shot);
  switch (key) {
    case 'value': {
      const r = valueRank(s.value);
      return r < 0 ? 999 : r;
    }
    case 'subject':
      return canon(s.subject) || '￿';
    case 'dialogue':
      // Plans parlés d'abord (son à prévoir), puis les autres.
      return block?.dialogue?.trim() || /(^|\s)Rép\./.test(s.sound ?? '') ? 0 : 1;
    case 'movement': {
      const tokens = s.movement.filter(Boolean);
      const fixed = !tokens.length || tokens.every((t) => matchVocab(t, MOVEMENTS)?.key === 'fixe');
      return fixed ? '0' : `1${tokens.map(canon).join(' ')}`;
    }
    case 'focal':
      return s.focal.from ?? 99999;
    case 'angle': {
      const axis = s.angle.map((t) => matchVocab(t, AXES)?.key).find(Boolean);
      const height = s.angle.map((t) => matchVocab(t, HEIGHTS)).find(Boolean);
      const a = axis ? AXIS_ORDER.indexOf(axis) : 99;
      const h = height ? HEIGHTS.indexOf(height) : 99;
      return a * 100 + h;
    }
  }
}

function compare(a: Rank, b: Rank): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'fr');
}

/** Les plans rangés selon les critères (à égalité : l'ordre du découpage). */
export function sortShots(doc: ProjectDoc, ids: readonly ID[], criteria: readonly SortCriterion[]): ID[] {
  const rows = ids.map((id, i) => ({ id, i, ranks: criteria.map((c) => rankOf(doc, doc.shots[id], c.key)) }));
  rows.sort((x, y) => {
    for (let k = 0; k < criteria.length; k++) {
      const d = compare(x.ranks[k], y.ranks[k]);
      if (d) return criteria[k].desc ? -d : d;
    }
    return x.i - y.i;
  });
  return rows.map((r) => r.id);
}

/** Vue triée du projet, prête pour l'aperçu et les exports (tableau, storyboard). */
export function sortedDoc(doc: ProjectDoc, o: SortOptions): ProjectDoc {
  const keep = o.seqIds?.length ? new Set(o.seqIds) : null;
  const seqIds = doc.project.sequenceIds.filter((id) => doc.sequences[id] && (!keep || keep.has(id)));
  const seqNumbers: Record<ID, number | string> = {};
  const shotNumbers: Record<ID, number> = {};
  for (const sid of doc.project.sequenceIds) for (const id of doc.sequences[sid]?.shotIds ?? []) shotNumbers[id] = shotNumber(doc, id);

  // Suite de plans (dans l'ordre voulu), découpée en séquences : une par passage d'une même séquence.
  const runs: Array<{ from: ID; shots: ID[] }> = [];
  if (o.scope === 'sequence') {
    for (const sid of seqIds) runs.push({ from: sid, shots: sortShots(doc, doc.sequences[sid].shotIds, o.criteria) });
  } else {
    const all = sortShots(doc, seqIds.flatMap((sid) => doc.sequences[sid].shotIds), o.criteria);
    for (const id of all) {
      const from = doc.shots[id].sequenceId;
      if (runs.at(-1)?.from === from) runs.at(-1)!.shots.push(id);
      else runs.push({ from, shots: [id] });
    }
  }

  const sequences: Record<ID, Sequence> = {};
  const shots: Record<ID, Shot> = { ...doc.shots };
  const blocks: Record<ID, ActionBlock> = { ...doc.blocks };
  const order: ID[] = [];
  runs.forEach((run, k) => {
    const orig = doc.sequences[run.from];
    const vid = o.scope === 'sequence' ? run.from : `${run.from}~${k}`;
    const blockIds: ID[] = [];
    let prevOrig: ID | undefined;
    let prevClone: ID | undefined;
    for (const id of run.shots) {
      const sh = doc.shots[id];
      // Une action liée reste fusionnée tant que ses plans restent côte à côte ; sinon chacun a la sienne.
      let bid = prevOrig === sh.actionBlockId ? prevClone! : `${sh.actionBlockId}~${vid}~${id}`;
      if (bid !== prevClone) {
        const b = doc.blocks[sh.actionBlockId];
        blocks[bid] = { ...(b ?? { id: bid, text: '' }), id: bid, sequenceId: vid } as ActionBlock;
        blockIds.push(bid);
      } else bid = prevClone!;
      shots[id] = { ...sh, sequenceId: vid, actionBlockId: bid };
      prevOrig = sh.actionBlockId;
      prevClone = bid;
    }
    sequences[vid] = { ...orig, id: vid, shotIds: run.shots, actionBlockIds: blockIds };
    seqNumbers[vid] = sequenceNumber(doc, run.from);
    order.push(vid);
  });

  const settings = doc.project.settings;
  // Le TC cumulé n'a pas de sens dans un ordre de tournage : la colonne s'efface de cette vue.
  const noTc = <T extends string>(cols: readonly T[]) => cols.filter((c) => c !== 'tc');
  return {
    ...doc,
    project: { ...doc.project, sequenceIds: order, settings: { ...settings, gridColumns: noTc(settings.gridColumns), exportColumns: noTc(settings.exportColumns) } },
    sequences: { ...doc.sequences, ...sequences },
    shots,
    blocks,
    display: { seqNumbers, shotNumbers },
  };
}
