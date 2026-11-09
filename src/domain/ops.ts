/**
 * Opérations d'édition du document. Elles mutent le document reçu (prévu pour un brouillon immer)
 * et maintiennent les invariants du §3.
 */
import { recognizeCharacters, shotSubjectText } from './characters';
import { blockDuration } from './timing';
import { makeBlock, makeSequence, makeShot, newId } from './factory';
import { planKeysOfSequence, unlinkShotFromPlans } from './floorplan';
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

/** Nouveau plan sous `afterShotId` : vierge, rien n'est recopié du plan précédent. */
export function addShotAfter(doc: ProjectDoc, afterShotId: ID): ID {
  const prev = doc.shots[afterShotId];
  if (!prev) throw new Error('Plan inconnu');
  const seq = seqOf(doc, prev.sequenceId);
  return addShot(doc, prev.sequenceId, {
    index: seq.shotIds.indexOf(afterShotId) + 1,
  });
}

/** Duplique un plan juste en dessous ; la copie couvre la même action (sauf plan-séquence ou caméra d'interview). */
export function duplicateShot(doc: ProjectDoc, shotId: ID): ID {
  const src = doc.shots[shotId];
  if (!src) throw new Error('Plan inconnu');
  const seq = seqOf(doc, src.sequenceId);
  const copy: Shot = JSON.parse(JSON.stringify(src)) as Shot;
  copy.id = newId();
  // Images propres à chaque plan : la copie repart sans storyboard (ni keyframes partagées), et sans
  // jour de tournage (elle n'a pas de créneau dans l'emploi du temps).
  copy.storyboard = undefined;
  copy.keyframes = undefined;
  copy.shootingDay = undefined;
  copy.mergeBreak = undefined;
  // Une copie d'un plan d'interview devient un plan ordinaire (la fiche n'a qu'un plan par caméra) :
  // elle se pose après toutes les caméras du cadre, avec sa propre action.
  const itw = !!src.interview;
  const after = itw ? (interviewGroupOf(doc, shotId).filter((id) => seq.shotIds.includes(id)).at(-1) ?? shotId) : shotId;
  copy.interview = undefined;
  doc.shots[copy.id] = copy;
  seq.shotIds.splice(seq.shotIds.indexOf(after) + 1, 0, copy.id);
  normalizeBlocks(doc, seq.id);
  // Un plan-séquence a sa propre chorégraphie : la copie ne partage pas son action.
  if (copy.oneShot || itw) detachAction(doc, copy.id);
  return copy.id;
}

/**
 * Plans d'un même cadre d'interview (institutionnel : une caméra par plan), dans l'ordre du découpage ;
 * pour tout autre plan, lui seul. Ils se suppriment et se déplacent ensemble.
 */
export function interviewGroupOf(doc: ProjectDoc, shotId: ID): ID[] {
  const setupId = doc.shots[shotId]?.interview?.setupId;
  if (!setupId) return doc.shots[shotId] ? [shotId] : [];
  const out: ID[] = [];
  for (const sid of doc.project.sequenceIds) for (const id of doc.sequences[sid]?.shotIds ?? []) if (doc.shots[id]?.interview?.setupId === setupId) out.push(id);
  return out.length ? out : [shotId];
}

/** Supprime un plan ; un plan d'interview part avec les autres caméras de son cadre. */
export function deleteShot(doc: ProjectDoc, shotId: ID): void {
  for (const id of interviewGroupOf(doc, shotId)) removeShot(doc, id);
}

/**
 * Une autre version du film (rangée) a-t-elle encore cette séquence ou ce plan ? Sa préparation,
 * commune aux versions (plans au sol, dépouillement, emploi du temps), reste alors en place.
 */
const keptElsewhere = (doc: ProjectDoc, kind: 'sequences' | 'shots', id: ID) => (doc.versions ?? []).some((v) => !!v.slice?.[kind]?.[id]);

/** Supprime ce seul plan, sans toucher aux autres caméras d'un cadre d'interview. */
export function removeShot(doc: ProjectDoc, shotId: ID): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  const seq = seqOf(doc, shot.sequenceId);
  if (!keptElsewhere(doc, 'shots', shotId)) {
    unlinkShotFromPlans(doc, shotId, true);
    // Emploi du temps : ses créneaux et reprises disparaissent avec lui.
    for (const d of doc.schedule?.days ?? []) {
      if (d.timeline?.[shotId]) delete d.timeline[shotId];
      if (d.parts?.[shotId]) delete d.parts[shotId];
    }
  }
  seq.shotIds = seq.shotIds.filter((id) => id !== shotId);
  delete doc.shots[shotId];
  normalizeBlocks(doc, seq.id);
}

export function deleteSequence(doc: ProjectDoc, seqId: ID): void {
  const seq = doc.sequences[seqId];
  if (!seq) return;
  // Plans au sol, dépouillement et jours de la séquence partent avec elle (annulable), sauf si une
  // autre version du film la garde.
  if (!keptElsewhere(doc, 'sequences', seqId)) {
    for (const key of planKeysOfSequence(doc, seqId)) delete doc.floorPlans![key];
    if (doc.breakdown) delete doc.breakdown[seqId];
  }
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
  const group = interviewGroupOf(doc, shotId);
  if (group.length > 1) {
    moveGroup(doc, group, toSeqId, toIndex);
    return 0;
  }
  const from = seqOf(doc, shot.sequenceId);
  const to = seqOf(doc, toSeqId);
  from.shotIds = from.shotIds.filter((id) => id !== shotId);
  let splits = 0;
  if (from.id !== to.id) {
    const block = doc.blocks[shot.actionBlockId];
    const others = from.shotIds.filter((id) => doc.shots[id]?.actionBlockId === shot.actionBlockId).length;
    if (block && !others) {
      block.sequenceId = to.id;
      block.tc = block.tc ? { ...block.tc } : undefined;
    } else {
      const part = overrideShare(block?.overrideSec, 1, others + 1);
      const copy = makeBlock(to.id, { ...blockData(block), overrideSec: part });
      doc.blocks[copy.id] = copy;
      if (block?.overrideSec !== undefined && part !== undefined) block.overrideSec -= part;
      shot.actionBlockId = copy.id;
    }
    shot.sequenceId = to.id;
    shot.mergeBreak = undefined;
    unlinkShotFromPlans(doc, shotId, false);
    splits += normalizeBlocks(doc, from.id);
  }
  to.shotIds.splice(Math.max(0, Math.min(toIndex, to.shotIds.length)), 0, shotId);
  splits += normalizeBlocks(doc, to.id);
  return splits;
}

/**
 * Pose un plan (avec les autres caméras de son cadre d'interview) à la place `at` de la séquence,
 * comptée parmi les plans qui y restent : 0 = en tête. Jamais entre deux caméras d'un même cadre.
 */
export function moveShotTo(doc: ProjectDoc, shotId: ID, toSeqId: ID, at: number): number {
  const group = interviewGroupOf(doc, shotId);
  if (group.length <= 1) return moveShot(doc, shotId, toSeqId, at);
  const to = seqOf(doc, toSeqId);
  moveGroup(doc, group, toSeqId, to.shotIds.length);
  const others = to.shotIds.filter((id) => !group.includes(id));
  let k = Math.max(0, Math.min(at, others.length));
  while (k > 0 && k < others.length && insideGroup(doc, others, k)) k++;
  to.shotIds = [...others.slice(0, k), ...group, ...others.slice(k)];
  normalizeBlocks(doc, toSeqId);
  return 0;
}

/** Vrai si une insertion à `at` tomberait entre deux caméras d'un même cadre d'interview. */
export function insideGroup(doc: ProjectDoc, ids: readonly ID[], at: number): boolean {
  const a = doc.shots[ids[at - 1]]?.interview?.setupId;
  return !!a && a === doc.shots[ids[at]]?.interview?.setupId;
}

/**
 * Déplace d'un bloc les caméras d'un cadre d'interview, avec leur action commune. `toIndex` suit la
 * convention du glisser-déposer : dans la même séquence, le groupe prend la place du plan visé (au-dessus
 * en montant, en dessous en descendant) ; vers une autre séquence, il s'insère avant ce plan.
 */
function moveGroup(doc: ProjectDoc, group: ID[], toSeqId: ID, toIndex: number): void {
  const to = seqOf(doc, toSeqId);
  const first = doc.shots[group[0]];
  const sameSeq = group.every((id) => doc.shots[id].sequenceId === toSeqId);
  const target = to.shotIds[toIndex];
  if (sameSeq && target && group.includes(target)) return;
  const down = sameSeq && toIndex > to.shotIds.indexOf(group[0]);
  const touched = new Set<ID>([toSeqId]);
  for (const id of group) {
    const sh = doc.shots[id];
    const from = doc.sequences[sh.sequenceId];
    if (from) from.shotIds = from.shotIds.filter((x) => x !== id);
    if (sh.sequenceId !== toSeqId) {
      touched.add(sh.sequenceId);
      sh.mergeBreak = undefined;
      unlinkShotFromPlans(doc, id, false);
      sh.sequenceId = toSeqId;
    }
    sh.actionBlockId = first.actionBlockId;
  }
  const block = doc.blocks[first.actionBlockId];
  if (block && block.sequenceId !== toSeqId) block.sequenceId = toSeqId;
  // Jamais au milieu d'un autre cadre : le groupe se pose après lui.
  let at = target ? to.shotIds.indexOf(target) + (down ? 1 : 0) : Math.min(toIndex, to.shotIds.length);
  if (at < 0) at = to.shotIds.length;
  while (at > 0 && at < to.shotIds.length && insideGroup(doc, to.shotIds, at)) at++;
  to.shotIds.splice(at, 0, ...group);
  for (const t of touched) normalizeBlocks(doc, t);
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
      const copy = makeBlock(seqId, blockData(block));
      doc.blocks[copy.id] = copy;
      remap.set(bId, copy.id);
      if (block && !foreign) splits += 1;
      shot.actionBlockId = copy.id;
      bId = copy.id;
    }
    seen.add(bId);
    prev = bId;
  }
  // Action scindée (plans devenus discontinus) : sa durée forcée est répartie selon le nombre de plans.
  for (const [orig, copyId] of remap) {
    const a = doc.blocks[orig];
    const b = doc.blocks[copyId];
    if (!a || !b || a.sequenceId !== seqId || a.overrideSec === undefined) continue;
    const na = seq.shotIds.filter((id) => doc.shots[id].actionBlockId === orig).length;
    const nb = seq.shotIds.filter((id) => doc.shots[id].actionBlockId === copyId).length;
    const total = a.overrideSec;
    b.overrideSec = overrideShare(total, nb, na + nb);
    a.overrideSec = total - (b.overrideSec ?? 0);
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

/** Part d'une durée forcée quand une action couverte par `total` plans est scindée en une part de `n` plans. */
function overrideShare(sec: number | undefined, n: number, total: number): number | undefined {
  return sec === undefined ? undefined : Math.round((sec * n) / Math.max(1, total));
}

/**
 * Copie complète des données d'un bloc d'action (texte, réplique, durée forcée, plage de piste,
 * passage du scénario) : aucune opération de structure ne doit en perdre une au passage.
 */
function blockData(block: ActionBlock | undefined): Partial<ActionBlock> {
  if (!block) return { text: '' };
  return {
    text: block.text,
    dialogue: block.dialogue,
    overrideSec: block.overrideSec,
    tc: block.tc ? { ...block.tc } : undefined,
    scenarioAnchor: block.scenarioAnchor ? { ...block.scenarioAnchor } : undefined,
  };
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
  const blocks = blockIds.map((b) => doc.blocks[b]).filter((b): b is ActionBlock => !!b);
  for (const block of blocks) {
    if (block.text.trim() && !texts.includes(block.text.trim())) texts.push(block.text.trim());
    if (block.dialogue?.trim()) dialogues.push(block.dialogue.trim());
  }
  // Minutage : la durée d'une action liée est la somme des durées des actions réunies. Dès qu'une
  // d'elles avait une durée forcée, on la garde en forçant la somme (chaque action comptant pour sa
  // durée forcée ou calculée) ; les plages de piste sont réunies de la plus précoce à la plus tardive.
  if (blocks.some((b) => b.overrideSec !== undefined)) {
    target.overrideSec = blocks.reduce((n, b) => n + blockDuration(b, doc.project.settings), 0);
  }
  const ranges = blocks.map((b) => b.tc).filter((r): r is NonNullable<ActionBlock['tc']> => !!r);
  if (ranges.some((r) => r.all)) target.tc = { all: true };
  else {
    const ins = ranges.map((r) => r.in).filter((x): x is number => x !== undefined);
    const outs = ranges.map((r) => r.out).filter((x): x is number => x !== undefined);
    if (ins.length || outs.length) target.tc = { in: ins.length ? Math.min(...ins) : undefined, out: outs.length ? Math.max(...outs) : undefined };
  }
  const anchors = blocks.map((b) => b.scenarioAnchor).filter((a): a is NonNullable<ActionBlock['scenarioAnchor']> => !!a);
  if (anchors.length) target.scenarioAnchor = { start: Math.min(...anchors.map((a) => a.start)), end: Math.max(...anchors.map((a) => a.end)) };
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
    // La durée forcée de l'action est partagée entre les plans déliés (le total ne change pas).
    const total = block?.overrideSec;
    for (const other of sharing.slice(1)) {
      const copy = makeBlock(seq.id, { ...blockData(block), overrideSec: overrideShare(total, 1, sharing.length) });
      doc.blocks[copy.id] = copy;
      doc.shots[other].actionBlockId = copy.id;
    }
    if (block && total !== undefined) block.overrideSec = total - (sharing.length - 1) * (overrideShare(total, 1, sharing.length) ?? 0);
    touched.add(seq.id);
  }
  for (const s of touched) normalizeBlocks(doc, s);
}

/** Détache un seul plan de l'action qu'il partage (les autres restent liés entre eux). */
export function detachAction(doc: ProjectDoc, shotId: ID): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  const seq = seqOf(doc, shot.sequenceId);
  const n = seq.shotIds.filter((x) => doc.shots[x].actionBlockId === shot.actionBlockId).length;
  if (n < 2) return;
  const block = doc.blocks[shot.actionBlockId];
  const part = overrideShare(block?.overrideSec, 1, n);
  const copy = makeBlock(seq.id, { ...blockData(block), overrideSec: part });
  doc.blocks[copy.id] = copy;
  if (block?.overrideSec !== undefined && part !== undefined) block.overrideSec -= part;
  shot.actionBlockId = copy.id;
  normalizeBlocks(doc, seq.id);
}

export function setShotSubject(doc: ProjectDoc, shotId: ID, subject: string): void {
  const shot = doc.shots[shotId];
  if (!shot) return;
  shot.subject = subject;
  shot.characterIds = recognizeCharacters(shotSubjectText(shot), Object.values(doc.characters));
}

/** Recalcule les personnages reconnus de tous les plans (après création ou fusion de fiches). */
export function refreshRecognition(doc: ProjectDoc): void {
  const chars = Object.values(doc.characters);
  for (const shot of Object.values(doc.shots)) shot.characterIds = recognizeCharacters(shotSubjectText(shot), chars);
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
  remapCharacter(doc, fromId, intoId);
  refreshRecognition(doc);
}

/**
 * Fiche fusionnée ou supprimée : les convocations du plan de travail et les comédiens posés sur
 * les plans au sol suivent (vers la fiche gardée, ou plus de fiche).
 */
export function remapCharacter(doc: ProjectDoc, fromId: ID, intoId?: ID): void {
  for (const d of doc.schedule?.days ?? []) {
    if (!d.calls?.[fromId]) continue;
    if (intoId && !d.calls[intoId]) d.calls[intoId] = d.calls[fromId];
    delete d.calls[fromId];
  }
  for (const plan of Object.values(doc.floorPlans ?? {}))
    for (const it of plan.items) if (it.kind === 'actor' && it.characterId === fromId) it.characterId = intoId;
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
