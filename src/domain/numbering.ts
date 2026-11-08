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

export function formatShotCode(seqNumber: number, shotNumber: number, format: ShotCodeFormat): string {
  switch (format) {
    case '{seq}-{shot}':
      return `${seqNumber}-${shotNumber}`;
    case '{seq}{letter}':
      return `${seqNumber}${letterCode(shotNumber)}`;
    default:
      return `${seqNumber}.${shotNumber}`;
  }
}

/** Numéro de séquence dérivé de sa position (1-based), 0 si absente. */
export function sequenceNumber(doc: ProjectDoc, seqId: ID): number {
  return doc.project.sequenceIds.indexOf(seqId) + 1;
}

/**
 * Numéro de plan dérivé de sa position dans sa séquence (1-based), 0 si absent. Les caméras d'un
 * même cadre d'interview, filmées ensemble, partagent un numéro (2.3A, 2.3B).
 */
export function shotNumber(doc: ProjectDoc, shotId: ID): number {
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
