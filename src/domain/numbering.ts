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

/** Numéro de plan dérivé de sa position dans sa séquence (1-based), 0 si absent. */
export function shotNumber(doc: ProjectDoc, shotId: ID): number {
  const shot = doc.shots[shotId];
  if (!shot) return 0;
  return (doc.sequences[shot.sequenceId]?.shotIds.indexOf(shotId) ?? -1) + 1;
}

export function shotCode(doc: ProjectDoc, shotId: ID): string {
  const shot = doc.shots[shotId];
  if (!shot) return '';
  return formatShotCode(sequenceNumber(doc, shot.sequenceId), shotNumber(doc, shotId), doc.project.settings.shotCodeFormat);
}

export function sequenceHeading(doc: ProjectDoc, seqId: ID): string {
  const seq = doc.sequences[seqId];
  return `${sequenceNumber(doc, seqId)}, ${(seq?.label ?? '').toUpperCase()}`;
}
