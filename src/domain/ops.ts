/**
 * Opérations d'édition du document. Elles mutent le document reçu (prévu pour un brouillon immer)
 * et maintiennent les invariants du §3.
 */
import { recognizeCharacters } from './characters';
import { makeBlock, makeSequence, makeShot, newId } from './factory';
import type { ActionBlock, Character, ID, ProjectDoc, Sequence, Shot } from './types';

function seqOf(doc: ProjectDoc, seqId: ID): Sequence {
  const seq = doc.sequences[seqId];
  if (!seq) throw new Error(`Séquence inconnue : ${seqId}`);
  return seq;
}

function clampIndex(i: number | undefined, len: number): number {
  if (i === undefined || i < 0 || i > len) return len;
  return i;
}

export function addSequence(doc: ProjectDoc, index?: number, init: Partial<Sequence> = {}, withShot = true): ID {
  const seq = makeSequence(init);
  doc.sequences[seq.id] = seq;
  doc.project.sequenceIds.splice(clampIndex(index, doc.project.sequenceIds.length), 0, seq.id);
  if (withShot) addShot(doc, seq.id);
  return seq.id;
}

export interface AddShotOptions {
  index?: number;
  init?: Partial<Shot>;
  action?: Partial<ActionBlock>;
  /** Rejoint ce bloc d'action au lieu d'en créer un. */
  blockId?: ID;
}

export function addShot(doc: ProjectDoc, seqId: ID, opts: AddShotOptions = {}): ID {
  const seq = seqOf(doc, seqId);
  let blockId = opts.blockId;
  if (!blockId || !doc.blocks[blockId]) {
    const block = makeBlock(seqId, opts.action);
    doc.blocks[block.id] = block;
    blockId = block.id;
  }
  const shot = makeShot(seqId, blockId, opts.init);
  if (shot.subject && shot.characterIds.length === 0) {
    shot.characterIds = recognizeCharacters(shot.subject, Object.values(doc.characters));
  }
  doc.shots[shot.id] = shot;
  seq.shotIds.splice(clampIndex(opts.index, seq.shotIds.length), 0, shot.id);
  normalizeBlocks(doc, seqId);
  return shot.id;
}

/** Nouveau plan sous `afterShotId` : hérite du sujet, de la focale et de l'angle (§4.2). */
export function addShotAfter(doc: ProjectDoc, afterShotId: ID): ID {
  const prev = doc.shots[afterShotId];
  if (!prev) throw new Error('Plan inconnu');
  const seq = seqOf(doc, prev.sequenceId);
  return addShot(doc, prev.sequenceId, {
    index: seq.shotIds.indexOf(afterShotId) + 1,
    init: {
      subject: prev.subject,
      characterIds: [...prev.characterIds],
      focal: { ...prev.focal },
      angle: [...prev.angle],
    },
  });
}

/** Duplique un plan juste en dessous ; la copie couvre la même action. */
export function duplicateShot(doc: ProjectDoc, shotId: ID): ID {
  const src = doc.shots[shotId];
  if (!src) throw new Error('Plan inconnu');
  const seq = seqOf(doc, src.sequenceId);
  const copy: Shot = JSON.parse(JSON.stringify(src)) as Shot;
  copy.id = newId();
  copy.storyboard = undefined;
  copy.mergeBreak = undefined;
  doc.shots[copy.id] = copy;
  seq.shotIds.splice(seq.shotIds.indexOf(shotId) + 1, 0, copy.id);
  normalizeBlocks(doc, seq.id);
  return copy.id;
}

export function deleteShot(doc: ProjectDoc, shotId: ID): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  const seq = seqOf(doc, shot.sequenceId);
  seq.shotIds = seq.shotIds.filter((id) => id !== shotId);
  delete doc.shots[shotId];
  normalizeBlocks(doc, seq.id);
}

export function deleteSequence(doc: ProjectDoc, seqId: ID): void {
  const seq = doc.sequences[seqId];
  if (!seq) return;
  for (const id of seq.shotIds) delete doc.shots[id];
  for (const b of Object.values(doc.blocks)) if (b.sequenceId === seqId) delete doc.blocks[b.id];
  delete doc.sequences[seqId];
  doc.project.sequenceIds = doc.project.sequenceIds.filter((id) => id !== seqId);
}

export function moveSequence(doc: ProjectDoc, seqId: ID, toIndex: number): void {
  const ids = doc.project.sequenceIds.filter((id) => id !== seqId);
  if (ids.length === doc.project.sequenceIds.length) return;
  ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, seqId);
  doc.project.sequenceIds = ids;
}

/**
 * Déplace un plan. Dans la même séquence, l'ordre change et les blocs non contigus sont scindés.
 * Vers une autre séquence, l'action liée est détachée (§4.5). Renvoie le nombre de scissions.
 */
export function moveShot(doc: ProjectDoc, shotId: ID, toSeqId: ID, toIndex: number): number {
  const shot = doc.shots[shotId];
  if (!shot) return 0;
  const from = seqOf(doc, shot.sequenceId);
  const to = seqOf(doc, toSeqId);
  from.shotIds = from.shotIds.filter((id) => id !== shotId);
  let splits = 0;
  if (from.id !== to.id) {
    const block = doc.blocks[shot.actionBlockId];
    const shared = from.shotIds.some((id) => doc.shots[id]?.actionBlockId === shot.actionBlockId);
    if (block && !shared) {
      block.sequenceId = to.id;
      block.tc = block.tc ? { ...block.tc } : undefined;
    } else {
      const copy = makeBlock(to.id, { text: block?.text ?? '', dialogue: block?.dialogue });
      doc.blocks[copy.id] = copy;
      shot.actionBlockId = copy.id;
    }
    shot.sequenceId = to.id;
    shot.mergeBreak = undefined;
    splits += normalizeBlocks(doc, from.id);
  }
  to.shotIds.splice(Math.max(0, Math.min(toIndex, to.shotIds.length)), 0, shotId);
  splits += normalizeBlocks(doc, to.id);
  return splits;
}

/**
 * Rétablit les invariants d'une séquence : chaque bloc couvre des plans consécutifs (sinon il est scindé),
 * appartient à la séquence, et les blocs orphelins sont supprimés. Renvoie le nombre de scissions.
 */
export function normalizeBlocks(doc: ProjectDoc, seqId: ID): number {
  const seq = doc.sequences[seqId];
  if (!seq) return 0;
  seq.shotIds = seq.shotIds.filter((id) => doc.shots[id]);
  let splits = 0;
  const seen = new Set<ID>();
  let prev: ID | undefined;
  const remap = new Map<ID, ID>();
  for (const shotId of seq.shotIds) {
    const shot = doc.shots[shotId];
    let bId = shot.actionBlockId;
    if (remap.has(bId) && prev === remap.get(bId)) {
      shot.actionBlockId = remap.get(bId)!;
      prev = shot.actionBlockId;
      continue;
    }
    const block = doc.blocks[bId];
    const foreign = !block || block.sequenceId !== seqId;
    if (foreign || (seen.has(bId) && prev !== bId)) {
      const copy = makeBlock(seqId, { text: block?.text ?? '', dialogue: block?.dialogue, tc: block?.tc ? { ...block.tc } : undefined });
      doc.blocks[copy.id] = copy;
      remap.set(bId, copy.id);
      if (block && !foreign) splits += 1;
      shot.actionBlockId = copy.id;
      bId = copy.id;
    }
    seen.add(bId);
    prev = bId;
  }
  const used = new Set(seq.shotIds.map((id) => doc.shots[id].actionBlockId));
  for (const b of Object.values(doc.blocks)) if (b.sequenceId === seqId && !used.has(b.id)) delete doc.blocks[b.id];
  const ordered: ID[] = [];
  for (const id of seq.shotIds) {
    const b = doc.shots[id].actionBlockId;
    if (!ordered.includes(b)) ordered.push(b);
  }
  seq.actionBlockIds = ordered;
  return splits;
}

/** Plans consécutifs d'une même séquence ? Renvoie les ids dans l'ordre, sinon `null`. */
export function consecutiveRun(doc: ProjectDoc, shotIds: readonly ID[]): ID[] | null {
  if (shotIds.length === 0) return null;
  const seqId = doc.shots[shotIds[0]]?.sequenceId;
  if (!seqId || shotIds.some((id) => doc.shots[id]?.sequenceId !== seqId)) return null;
  const seq = seqOf(doc, seqId);
  const idx = shotIds.map((id) => seq.shotIds.indexOf(id)).sort((a, b) => a - b);
  for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return null;
  return idx.map((i) => seq.shotIds[i]);
}

/** « Lier l'action » : les plans consécutifs partagent un même bloc (§4.4). */
export function linkAction(doc: ProjectDoc, shotIds: readonly ID[]): ID | null {
  const run = consecutiveRun(doc, shotIds);
  if (!run || run.length < 2) return null;
  const seqId = doc.shots[run[0]].sequenceId;
  const target = doc.blocks[doc.shots[run[0]].actionBlockId];
  const texts: string[] = [];
  const dialogues: string[] = [];
  const blockIds: ID[] = [];
  for (const id of run) {
    const b = doc.shots[id].actionBlockId;
    if (!blockIds.includes(b)) blockIds.push(b);
  }
  // Étend aux plans qui partagent déjà ces blocs, pour ne pas les rendre discontigus.
  const seq = seqOf(doc, seqId);
  for (const id of seq.shotIds) if (blockIds.includes(doc.shots[id].actionBlockId)) doc.shots[id].actionBlockId = target.id;
  for (const b of blockIds) {
    const block = doc.blocks[b];
    if (block?.text.trim() && !texts.includes(block.text.trim())) texts.push(block.text.trim());
    if (block?.dialogue?.trim()) dialogues.push(block.dialogue.trim());
  }
  target.text = texts.join(' ');
  target.dialogue = dialogues.length ? dialogues.join('\n') : undefined;
  normalizeBlocks(doc, seqId);
  return target.id;
}

/** « Délier » : chaque plan retrouve son propre bloc, le texte est copié. */
export function unlinkAction(doc: ProjectDoc, shotIds: readonly ID[]): void {
  const touched = new Set<ID>();
  for (const id of shotIds) {
    const shot = doc.shots[id];
    if (!shot) continue;
    const block = doc.blocks[shot.actionBlockId];
    const seq = seqOf(doc, shot.sequenceId);
    const sharing = seq.shotIds.filter((x) => doc.shots[x].actionBlockId === shot.actionBlockId);
    if (sharing.length < 2) continue;
    for (const other of sharing.slice(1)) {
      const copy = makeBlock(seq.id, { text: block?.text ?? '', dialogue: block?.dialogue, tc: block?.tc ? { ...block.tc } : undefined });
      doc.blocks[copy.id] = copy;
      doc.shots[other].actionBlockId = copy.id;
    }
    touched.add(seq.id);
  }
  for (const s of touched) normalizeBlocks(doc, s);
}

export function setShotSubject(doc: ProjectDoc, shotId: ID, subject: string): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  shot.subject = subject;
  shot.characterIds = recognizeCharacters(subject, Object.values(doc.characters));
}

/** Recalcule les personnages reconnus de tous les plans (après création ou fusion de fiches). */
export function refreshRecognition(doc: ProjectDoc): void {
  const chars = Object.values(doc.characters);
  for (const shot of Object.values(doc.shots)) shot.characterIds = recognizeCharacters(shot.subject, chars);
}

export function addCharacter(doc: ProjectDoc, init: Partial<Character> & { name: string }): ID {
  const c: Character = { id: newId(), kind: 'principal', ...init };
  doc.characters[c.id] = c;
  refreshRecognition(doc);
  return c.id;
}

/** Fusionne la fiche `fromId` dans `intoId` (doublons « Candice » / « Candi », §7). */
export function mergeCharacters(doc: ProjectDoc, fromId: ID, intoId: ID): void {
  const from = doc.characters[fromId];
  const into = doc.characters[intoId];
  if (!from || !into || fromId === intoId) return;
  into.aliases = [...new Set([...(into.aliases ?? []), from.name, ...(from.aliases ?? [])])];
  delete doc.characters[fromId];
  for (const seq of Object.values(doc.sequences)) {
    seq.characterIds = [...new Set(seq.characterIds.map((id) => (id === fromId ? intoId : id)))];
  }
  refreshRecognition(doc);
}

/** Vérifie les invariants du §3 ; renvoie la liste des violations (vide si tout va bien). */
export function checkInvariants(doc: ProjectDoc): string[] {
  const errors: string[] = [];
  const seqIds = new Set(doc.project.sequenceIds);
  if (seqIds.size !== doc.project.sequenceIds.length) errors.push('Séquence listée deux fois');
  for (const id of Object.keys(doc.sequences)) if (!seqIds.has(id)) errors.push(`Séquence hors ordre : ${id}`);
  const shotSeen = new Set<ID>();
  for (const seqId of doc.project.sequenceIds) {
    const seq = doc.sequences[seqId];
    if (!seq) {
      errors.push(`Séquence manquante : ${seqId}`);
      continue;
    }
    const closed = new Set<ID>();
    let prev: ID | undefined;
    for (const shotId of seq.shotIds) {
      const shot = doc.shots[shotId];
      if (!shot) {
        errors.push(`Plan manquant : ${shotId}`);
        continue;
      }
      if (shotSeen.has(shotId)) errors.push(`Plan présent deux fois : ${shotId}`);
      shotSeen.add(shotId);
      if (shot.sequenceId !== seqId) errors.push(`Plan ${shotId} rattaché à la mauvaise séquence`);
      const block = doc.blocks[shot.actionBlockId];
      if (!block) errors.push(`Bloc manquant pour ${shotId}`);
      else if (block.sequenceId !== seqId) errors.push(`Bloc ${block.id} hors de sa séquence`);
      if (prev !== undefined && prev !== shot.actionBlockId) closed.add(prev);
      if (closed.has(shot.actionBlockId)) errors.push(`Bloc ${shot.actionBlockId} non contigu`);
      prev = shot.actionBlockId;
    }
  }
  for (const id of Object.keys(doc.shots)) if (!shotSeen.has(id)) errors.push(`Plan orphelin : ${id}`);
  const usedBlocks = new Set(Object.values(doc.shots).map((s) => s.actionBlockId));
  for (const id of Object.keys(doc.blocks)) if (!usedBlocks.has(id)) errors.push(`Bloc orphelin : ${id}`);
  return errors;
}
