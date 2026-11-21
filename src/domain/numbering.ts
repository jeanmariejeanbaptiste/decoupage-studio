import { scenesOf } from './fountain';
import { fold } from './text';
import type { ID, ProjectDoc, ShotCodeFormat } from './types';

export function letterCode(n: number): string {
  // 1 → A, 26 → Z, 27 → AA
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function formatShotCode(seqNumber: SeqNo, shotNumber: number, format: ShotCodeFormat): string {
  switch (format) {
    case '{seq}-{shot}':
      return `${seqNumber}-${shotNumber}`;
    case '{seq}{letter}':
      return `${seqNumber}${letterCode(shotNumber)}`;
    default:
      return `${seqNumber}.${shotNumber}`;
  }
}

/**
 * Numéros des séquences. Avec un scénario, une séquence rattachée à une scène (ancrée dedans, sinon
 * du même lieu) porte le numéro de cette scène, même s'il en manque entre deux au découpage (4, 8, 10) :
 * c'est la référence commune à toute l'équipe. Une séquence absente du scénario suit celle qui la
 * précède. Sans scénario : la position. Dérivés, jamais stockés (mis en cache par document).
 */
/** Numéro de séquence affiché : un nombre, ou un numéro bis (« 4A ») pour une séquence hors du scénario. */
export type SeqNo = number | string;

const numbersCache = new WeakMap<object, { key: string; map: Map<ID, SeqNo> }>();
function sequenceNumbers(doc: ProjectDoc): Map<ID, SeqNo> {
  const ids = doc.project.sequenceIds;
  const source = doc.scenario ?? '';
  const key = `${ids.join(',')}|${source.length}|${ids.map((id) => `${doc.sequences[id]?.label ?? ''}@${doc.sequences[id]?.scenarioAnchor?.start ?? ''}`).join(',')}`;
  const hit = numbersCache.get(doc);
  if (hit && hit.key === key) return hit.map;
  const fromScene = new Map<ID, number>();
  if (source.trim()) {
    const used = new Set<ID>();
    scenesOf(source).forEach((sc, k) => {
      const inScene = ids.find((id) => {
        const a = doc.sequences[id]?.scenarioAnchor;
        return !used.has(id) && !!a && a.start >= sc.start && a.start < sc.end;
      });
      const label = fold(sc.location);
      const id = inScene ?? ids.find((x) => !used.has(x) && !doc.sequences[x]?.scenarioAnchor && fold(doc.sequences[x]?.label ?? '') === label);
      if (!id) return;
      used.add(id);
      fromScene.set(id, k + 1);
    });
  }
  const map = new Map<ID, SeqNo>();
  if (!fromScene.size) ids.forEach((id, i) => map.set(id, i + 1));
  else {
    // Hors du scénario : numéro bis de la séquence qui précède (1A, 1B…), jamais un doublon.
    let base = 0;
    let extra = 0;
    for (const id of ids) {
      const n = fromScene.get(id);
      if (n !== undefined) {
        base = n;
        extra = 0;
        map.set(id, n);
      } else map.set(id, `${base || ''}${letterCode(++extra)}`);
    }
  }
  numbersCache.set(doc, { key, map });
  return map;
}

/** Numéro de séquence (celui du scénario quand elle y figure, sinon sa place), 0 si absente. */
export function sequenceNumber(doc: ProjectDoc, seqId: ID): SeqNo {
  return doc.display?.seqNumbers?.[seqId] ?? sequenceNumbers(doc).get(seqId) ?? 0;
}

/** Séquence portant un numéro (le premier rencontré), pour les outils qui désignent par numéro. */
export function sequenceIdByNumber(doc: ProjectDoc, n: SeqNo): ID | undefined {
  const k = String(n).trim().toUpperCase();
  return doc.project.sequenceIds.find((id) => String(sequenceNumber(doc, id)) === k);
}

/**
 * Numéro de plan dérivé de sa position dans sa séquence (1-based), 0 si absent. Les caméras d'un
 * même cadre d'interview, filmées ensemble, partagent un numéro (2.3A, 2.3B).
 */
export function shotNumber(doc: ProjectDoc, shotId: ID): number {
  const fixed = doc.display?.shotNumbers?.[shotId];
  if (fixed !== undefined) return fixed;
  const shot = doc.shots[shotId];
  if (!shot) return 0;
  let n = 0;
  let prev: ID | undefined;
  for (const id of doc.sequences[shot.sequenceId]?.shotIds ?? []) {
    const setup = doc.shots[id]?.interview?.setupId;
    if (!setup || setup !== prev) n++;
    prev = setup;
    if (id === shotId) return n;
  }
  return 0;
}

/** Lettre de la caméra d'un plan d'interview (A, B…), sinon rien. */
export function cameraLetter(doc: ProjectDoc, shotId: ID): string {
  const link = doc.shots[shotId]?.interview;
  if (!link) return '';
  for (const s of doc.interview?.subjects ?? []) for (const y of s.setups ?? []) if (y.id === link.setupId) return y.cameras.find((c) => c.id === link.cameraId)?.name ?? '';
  return '';
}

export function shotCode(doc: ProjectDoc, shotId: ID): string {
  const shot = doc.shots[shotId];
  if (!shot) return '';
  const format = doc.project.settings.shotCodeFormat;
  const cam = cameraLetter(doc, shotId);
  return formatShotCode(sequenceNumber(doc, shot.sequenceId), shotNumber(doc, shotId), format) + (cam ? (format === '{seq}{letter}' ? `-${cam}` : cam) : '');
}

/** Numéro affiché dans la colonne N° (« 3 », ou « 3A » pour la caméra A d'une interview). */
export function shotNumberLabel(doc: ProjectDoc, shotId: ID): string {
  const n = shotNumber(doc, shotId);
  return n ? `${n}${cameraLetter(doc, shotId)}` : '';
}

export function sequenceHeading(doc: ProjectDoc, seqId: ID): string {
  const seq = doc.sequences[seqId];
  return `${sequenceNumber(doc, seqId)}, ${(seq?.label ?? '').toUpperCase()}`;
}

/** Ordre des numéros de séquence, bis compris (4 < 4A < 4B < 5). */
export const compareSeqNo = (a: SeqNo | undefined, b: SeqNo | undefined): number => String(a ?? 0).localeCompare(String(b ?? 0), 'fr', { numeric: true });
