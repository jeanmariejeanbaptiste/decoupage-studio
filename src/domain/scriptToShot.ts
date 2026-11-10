/**
 * Du scénario au découpage : un passage du scénario (une phrase, une réplique, une sélection libre)
 * devient un plan, rangé dans la séquence de sa scène et à sa place chronologique.
 */
import { characterName, displayName, matchSequence, parseFountain, sceneAt, scenesOf, type Scene, type ScriptElement } from './fountain';
import { addCharacter, addSequence, addShot, refreshRecognition } from './ops';
import { setSequenceDecorByName } from './registry';
import { parseEmphasis } from './scriptLayout';
import { fold } from './text';
import type { ID, ProjectDoc } from './types';

/** Une phrase d'action, ou une réplique entière (nom, didascalie et texte). */
export interface Sentence {
  start: number;
  end: number;
  kind: 'action' | 'dialogue';
}

/** Découpe les actions en phrases (jusqu'au point, au point d'exclamation ou d'interrogation, aux points de suspension). */
export function sentencesOf(source: string, elements: readonly ScriptElement[] = parseFountain(source)): Sentence[] {
  const out: Sentence[] = [];
  let reply: Sentence | null = null;
  for (const el of elements) {
    if (el.type === 'character') {
      reply = { start: el.start, end: el.end, kind: 'dialogue' };
      out.push(reply);
      continue;
    }
    if ((el.type === 'dialogue' || el.type === 'parenthetical') && reply) {
      reply.end = el.end;
      continue;
    }
    reply = null;
    if (el.type !== 'action' && el.type !== 'centered') continue;
    for (const [a0, a1] of sentenceSpans(el.text)) out.push({ start: el.start + a0, end: el.start + a1, kind: 'action' });
  }
  return out;
}

/** Abréviations usuelles après lesquelles une phrase ne s'arrête pas. */
const ABBREV = /(?:^|[\s(«“"'])(?:M|Mme|Mlle|MM|Dr|Pr|Me|Mgr|St|Ste|cf|etc|p|vol|chap|n°|No|av|bd|env|apr|J\.-C|ex)\.$/i;

/** Phrases d'un paragraphe : coupe après . ! ? …, sauf abréviations ; guillemets fermants rattachés. */
export function sentenceSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  const push = (end: number) => {
    const part = text.slice(start, end);
    const lead = part.length - part.trimStart().length;
    const trimmed = part.trim();
    if (trimmed && /[\p{L}\p{N}]/u.test(trimmed)) out.push([start + lead, start + lead + trimmed.length]);
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?…]/.test(text[i])) continue;
    let j = i + 1;
    while (j < text.length && /[.!?…]/.test(text[j])) j++;
    // Guillemets ou parenthèses fermants, avec l'espace insécable française éventuelle avant « » ».
    while (j < text.length && /[\s\u00a0\u202f]/.test(text[j]) && /[»”)\]]/.test(text[j + 1] ?? '')) j++;
    while (j < text.length && /["»”)\]]/.test(text[j])) j++;
    if (text[i] === '.' && ABBREV.test(text.slice(Math.max(0, i - 6), i + 1))) continue;
    if (j < text.length && !/\s/.test(text[j])) continue;
    push(j);
    i = j - 1;
  }
  push(text.length);
  return out;
}

export interface Passage {
  action: string;
  dialogue: string;
  subject: string;
  sound: string;
  scene?: Scene;
}

const STOP_UPPER = new Set(['INT', 'EXT', 'JOUR', 'NUIT', 'OFF', 'VO', 'V', 'O', 'CONT', 'SUITE', 'FIN', 'TV', 'OK', 'TGV', 'SMS', 'USA', 'PDG', 'SNCF', 'RER', 'GPS', 'DJ', 'OVNI']);

/** Prénom écrit en majuscules dans une action (« LÉA entre. ») : seulement s'il y en a un. */
export function upperName(text: string, doc?: ProjectDoc): string | undefined {
  // Frontières de mot Unicode (\b ne connaît que l'ASCII : « ÉLODIE » donnerait « LODIE »).
  const words = text.match(/(?<![\p{L}\p{N}])\p{Lu}[\p{Lu}'’-]+(?![\p{L}\p{N}])/gu) ?? [];
  const names = doc ? Object.values(doc.characters).flatMap((c) => [c.name, ...(c.aliases ?? [])]) : [];
  for (const w of words) {
    if (STOP_UPPER.has(fold(w).toUpperCase())) continue;
    const known = names.find((n) => fold(n) === fold(w));
    return known ?? displayName(w);
  }
  return undefined;
}

/**
 * Ce que devient un passage : l'action (avec « [Rép]. » là où des répliques s'intercalent entre deux
 * séries d'actions, didascalies comprises),
 * les répliques, le sujet (personnage qui parle, ou prénom en majuscules dans l'action) et, quand la
 * colonne Dialogue n'est pas affichée, une mention courte de la réplique dans la colonne Son (« Rép. », sans le nom déjà en Sujet).
 */
export function passageOf(doc: ProjectDoc, source: string, start: number, end: number, opts: { dialogueShown: boolean }): Passage {
  const elements = parseFountain(source);
  const action: string[] = [];
  const replies: Array<{ name: string; line: string }> = [];
  // Répliques survenues depuis la dernière action : marquées « [Rép]. » entre deux séries d'actions,
  // avec leurs didascalies (« [Rép (ton saccadé)]. »).
  let pending: string[] | null = null;
  for (const el of elements) {
    if (el.end <= start || el.start >= end) continue;
    const part = el.text.slice(Math.max(start, el.start) - el.start, Math.min(end, el.end) - el.start).trim();
    if (!part) continue;
    if (el.type === 'dialogue' && el.speaker) {
      const name = displayName(el.speaker);
      const last = replies[replies.length - 1];
      if (last && last.name === name) last.line += ` ${part}`;
      else replies.push({ name, line: part });
      pending ??= [];
    } else if (el.type === 'parenthetical') {
      (pending ??= []).push(part.startsWith('(') ? part : `(${part})`);
    } else if (el.type === 'action' || el.type === 'centered') {
      if (pending && action.length) action.push(pending.length ? `[Rép ${pending.join(' ')}].` : '[Rép].');
      pending = null;
      action.push(part);
    }
  }
  // Réplique seule : sa didascalie reste l'action du plan.
  if (!action.length && pending?.length) action.push(...pending);
  const speakers = [...new Set(replies.map((r) => r.name))];
  const actionText = action.join(' ');
  const subject = speakers[0] ?? upperName(actionText, doc) ?? '';
  const dialogue = replies.map((r) => `${r.name.toLocaleUpperCase('fr')} : ${r.line}`).join(' ');
  const sound =
    replies.length && !opts.dialogueShown
      ? // Le nom est déjà dans Sujet : on ne le répète que s'il y a plusieurs personnages.
        replies.map((r) => (speakers.length > 1 ? `Rép. ${r.name.toLocaleUpperCase('fr')} « ${shortQuote(r.line)} »` : `Rép. « ${shortQuote(r.line)} »`)).join(' · ')
      : '';
  return { action: actionText, dialogue, subject, sound, scene: sceneAt(scenesOf(source, elements), start) };
}

/** Début de réplique reconnaissable : cinq mots au plus. */
function shortQuote(line: string): string {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length > 5 ? `${words.slice(0, 5).join(' ').replace(/[,;:]$/, '')}…` : words.join(' ');
}

/**
 * Place chronologique du nouveau plan dans sa séquence : avant le premier plan dont le passage lié
 * vient après dans le scénario, après le dernier dont le passage vient avant.
 */
export function chronologicalIndex(doc: ProjectDoc, seqId: ID, start: number): number {
  const ids = doc.sequences[seqId]?.shotIds ?? [];
  let index = ids.length;
  let lastBefore = -1;
  let firstAfter = -1;
  ids.forEach((id, i) => {
    const a = doc.blocks[doc.shots[id]?.actionBlockId ?? '']?.scenarioAnchor;
    if (!a) return;
    if (a.start <= start) lastBefore = i;
    else if (firstAfter < 0) firstAfter = i;
  });
  if (firstAfter >= 0) index = firstAfter;
  else if (lastBefore >= 0) index = lastBefore + 1;
  return index;
}

/** Séquence du découpage correspondant à la scène ; créée à sa place si besoin (mode lié). */
export function sequenceForScene(doc: ProjectDoc, source: string, scene: Scene): ID {
  const found = matchSequence(doc, scene);
  if (found) {
    // Séquence du même lieu encore libre : elle devient celle de cette scène (et pas des suivantes).
    doc.sequences[found].scenarioAnchor ??= { start: scene.start, end: scene.end };
    return found;
  }
  return createSequenceForScene(doc, source, scene);
}

/** Nouvelle séquence pour une scène, à sa place dans l'ordre du scénario. */
export function createSequenceForScene(doc: ProjectDoc, source: string, scene: Scene): ID {
  // Rang : après la dernière séquence existante dont la scène précède celle-ci dans le scénario.
  const scenes = scenesOf(source);
  let index = 0;
  for (const sc of scenes) {
    if (sc.start >= scene.start) break;
    const id = matchSequence(doc, sc);
    if (id) index = doc.project.sequenceIds.indexOf(id) + 1;
  }
  const seqId = addSequence(doc, index, {}, false);
  const seq = doc.sequences[seqId];
  seq.label = scene.location.toUpperCase();
  seq.intExt = scene.intExt ?? seq.intExt;
  seq.effect = scene.effect ?? seq.effect;
  seq.scenarioAnchor = { start: scene.start, end: scene.end };
  setSequenceDecorByName(doc, seqId, scene.location);
  return seqId;
}

/**
 * Crée le plan d'un passage : séquence imposée (mode libre) ou déduite de la scène (mode lié),
 * à sa place chronologique, action / répliques / sujet / son remplis. Renvoie l'identifiant du plan.
 */
export function createShotFromPassage(
  doc: ProjectDoc,
  source: string,
  start: number,
  end: number,
  opts: { seqId?: ID; dialogueShown: boolean },
): ID | undefined {
  const p = passageOf(doc, source, start, end, opts);
  // Passage hors de toute scène (avant le premier en-tête) : rien n'est rangé au hasard.
  const seqId = opts.seqId === NEW_SEQUENCE ? (p.scene ? createSequenceForScene(doc, source, p.scene) : addSequence(doc, undefined, {}, false)) : (opts.seqId ?? (p.scene ? sequenceForScene(doc, source, p.scene) : undefined));
  if (!seqId) return undefined;
  // Personnages qui parlent dans le passage : leur fiche existe (registre, dépouillement, convocations).
  for (const m of (p.dialogue.match(/(?:^|\s)([^:]{1,40}?) : /g) ?? []).map((x) => x.replace(/ : $/, '').trim())) ensureCharacter(doc, displayName(m));
  if (p.subject && !/\s/.test(p.subject) && upperName(p.subject.toLocaleUpperCase('fr'), doc) && p.dialogue) ensureCharacter(doc, p.subject);
  const fallback = source.slice(start, end).trim();
  return addShot(doc, seqId, {
    index: chronologicalIndex(doc, seqId, start),
    init: { subject: p.subject, ...(p.sound ? { sound: p.sound } : {}) },
    action: { text: p.action || (p.dialogue ? '' : fallback), dialogue: p.dialogue || undefined, scenarioAnchor: { start, end } },
  });
}

/** Séquence imposée « nouvelle » (mode libre) : créée à la place de la scène. */
export const NEW_SEQUENCE = '__new__';

/** Fiche du personnage (nom ou alias, sans accents ni casse), créée au besoin. */
function ensureCharacter(doc: ProjectDoc, name: string): void {
  const n = name.trim();
  if (!n) return;
  const exists = Object.values(doc.characters).some((c) => [c.name, ...(c.aliases ?? [])].some((x) => fold(x) === fold(n)));
  if (!exists) addCharacter(doc, { name: n, kind: 'secondaire' });
  refreshRecognition(doc);
}

/** Personnage d'une ligne de nom (utile à l'affichage). */
export const cueName = (cue: string) => displayName(characterName(cue));

/**
 * Découpe une sélection aux frontières de scènes : un morceau par scène traversée, sans les en-têtes
 * (INT. … - JOUR) ni les blancs. Une sélection dans une seule scène donne un seul morceau.
 */
export function splitByScene(source: string, start: number, end: number): Array<{ start: number; end: number }> {
  const elements = parseFountain(source);
  const scenes = scenesOf(source, elements);
  const cuts = [start, ...scenes.map((s) => s.start).filter((s) => s > start && s < end), end];
  const parts: Array<{ start: number; end: number }> = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    let a = cuts[k];
    const b = cuts[k + 1];
    // On saute l'en-tête de scène s'il est dans le morceau.
    const heading = elements.find((el) => el.type === 'heading' && el.start >= a && el.start < b);
    if (heading && heading.start <= a + 1) a = Math.max(a, heading.end);
    while (a < b && /\s/.test(source[a])) a++;
    let z = b;
    while (z > a && /\s/.test(source[z - 1])) z--;
    if (z > a) parts.push({ start: a, end: z });
  }
  return parts;
}

/**
 * Crée les plans d'une sélection : un par scène traversée, chacun rangé dans la séquence de sa scène.
 * Avec une séquence imposée (mode libre), seule une sélection d'une scène unique y va ; une sélection
 * à cheval sur plusieurs scènes est toujours répartie scène par scène. Renvoie les plans créés.
 */
export function createShotsFromSelection(
  doc: ProjectDoc,
  source: string,
  start: number,
  end: number,
  opts: { seqId?: ID; dialogueShown: boolean },
): ID[] {
  const parts = splitByScene(source, start, end);
  if (parts.length <= 1) {
    const id = createShotFromPassage(doc, source, parts[0]?.start ?? start, parts[0]?.end ?? end, opts);
    return id ? [id] : [];
  }
  return parts.map((p) => createShotFromPassage(doc, source, p.start, p.end, { dialogueShown: opts.dialogueShown })).filter((id): id is ID => !!id);
}

/**
 * Passages du texte d'une séquence (sa scène dans le scénario), pour un premier découpage : un par
 * paragraphe d'action, un par réplique (nom, didascalie et texte). Vide sans scène liée.
 */
export function sequencePassages(doc: ProjectDoc, seqId: ID, elements?: readonly ScriptElement[]): Sentence[] {
  const source = doc.scenario ?? '';
  const a = doc.sequences[seqId]?.scenarioAnchor;
  if (!a || a.end <= a.start || a.end > source.length) return [];
  const out: Sentence[] = [];
  let reply: Sentence | null = null;
  for (const el of elements ?? parseFountain(source)) {
    if (el.start < a.start || el.start >= a.end) continue;
    if (el.type === 'character') {
      reply = { start: el.start, end: el.end, kind: 'dialogue' };
      out.push(reply);
      continue;
    }
    if ((el.type === 'dialogue' || el.type === 'parenthetical') && reply) {
      reply.end = Math.min(el.end, a.end);
      continue;
    }
    reply = null;
    if ((el.type === 'action' || el.type === 'centered') && /[\p{L}\p{N}]/u.test(el.text)) out.push({ start: el.start, end: Math.min(el.end, a.end), kind: 'action' });
  }
  return out;
}

/** Texte imprimé d'un passage : sans marques d'emphase, notes ni surlignages, sur une seule ligne. */
const printed = (text: string) =>
  parseEmphasis(text)
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Aperçu d'une séquence sans plan : son résumé s'il est écrit, sinon l'action de sa scène (à défaut,
 * sa première réplique). Coupé à `max` caractères, au mot près.
 */
export function sequenceExcerpt(doc: ProjectDoc, seqId: ID, elements?: readonly ScriptElement[], max = 280): string {
  const seq = doc.sequences[seqId];
  if (!seq) return '';
  let text = printed(seq.summary ?? '');
  if (!text) {
    const source = doc.scenario ?? '';
    const els = elements ?? parseFountain(source);
    const passages = sequencePassages(doc, seqId, els);
    text = passages
      .filter((p) => p.kind === 'action')
      .map((p) => printed(source.slice(p.start, p.end)))
      .join(' ');
    const first = passages.find((p) => p.kind === 'dialogue');
    if (!text && first) {
      const lines = els.filter((el) => el.start >= first.start && el.start < first.end);
      const name = lines.find((el) => el.type === 'character');
      const said = printed(lines.filter((el) => el.type === 'dialogue').map((el) => el.text).join(' '));
      if (name && said) text = `${characterName(name.text).toLocaleUpperCase('fr')} : ${said}`;
    }
  }
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/**
 * Premier découpage d'une séquence depuis son texte : un plan par passage (`sequencePassages`), dans
 * l'ordre du scénario, action, répliques et sujet remplis, chacun lié à son passage. Renvoie les plans créés.
 */
export function shotsFromSequenceText(doc: ProjectDoc, seqId: ID, opts: { dialogueShown: boolean }): ID[] {
  const source = doc.scenario ?? '';
  const elements = parseFountain(source);
  return sequencePassages(doc, seqId, elements)
    .map((p) => createShotFromPassage(doc, source, p.start, p.end, { seqId, dialogueShown: opts.dialogueShown }))
    .filter((id): id is ID => !!id);
}
