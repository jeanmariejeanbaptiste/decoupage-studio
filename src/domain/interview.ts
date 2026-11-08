/**
 * Découpage institutionnel, volet A-roll : l'interview face caméra. Une fiche par intervenant
 * (dispositif caméra, regard, son, décor et lumière, questions) ; les plans d'illustration (B-roll)
 * restent dans la grille classique, avec un créneau horaire par séquence au lieu d'un minutage.
 */
import { newId } from './factory';
import { recognizeCharacters } from './characters';
import { shotNumber } from './numbering';
import { addSequence, addShot, normalizeBlocks, removeShot } from './ops';
import type { ID, ProjectDoc, Shot } from './types';

export interface InterviewCamera {
  id: ID;
  /** A, B, C… */
  name: string;
  value: string;
  angle: string;
  focal: string;
  note?: string;
  /** Image du cadre (storyboard propre à l'interview, utile quand elle reste en annexe). */
  frame?: string;
  /** Multicam : intervenant filmé par cette caméra (par défaut, celui du cadre). */
  filmsId?: ID;
}

export interface InterviewQuestion {
  id: ID;
  text: string;
  /** Intervenant à qui elle s'adresse ; absent = question commune à tous. */
  subjectId?: ID;
  /** Cadre précis de cet intervenant ; absent = tous ses cadres. */
  setupId?: ID;
  /** Ce qu'on attend de la réponse : idées clés, chiffre, anecdote, durée visée. */
  expected?: string;
  asked?: boolean;
  note?: string;
}

/** Un cadre d'interview : une installation (lieu, caméras, lumière). Une personne peut en avoir plusieurs. */
export interface InterviewSetup {
  id: ID;
  /** « Au bureau », « Debout dans l'atelier »… */
  name: string;
  /** Regard vers l'intervieweur, à gauche ou à droite de la caméra, ou face caméra. */
  eyeline: 'gauche' | 'droite' | 'camera';
  cameras: InterviewCamera[];
  place: string;
  background: string;
  light: string;
  sound: string;
  /** Séquence du découpage où ce cadre est tourné (un plan par caméra) ; absente = annexe seule. */
  sequenceId?: ID;
}

export interface Interviewee {
  id: ID;
  name: string;
  /** Fonction, telle qu'elle apparaîtra au synthé. */
  role: string;
  setups: InterviewSetup[];
  notes?: string;
}

export interface Interview {
  subjects: Interviewee[];
  questions: InterviewQuestion[];
}

export function defaultCameras(): InterviewCamera[] {
  return [
    { id: newId(), name: 'A', value: 'Rapproché', angle: '3/4 Face, Hauteur regard', focal: '50' },
    { id: newId(), name: 'B', value: 'Gros plan', angle: 'Profil (≈ 30° de A)', focal: '85' },
  ];
}

export function makeSetup(_index: number, eyeline: InterviewSetup['eyeline'] = 'gauche'): InterviewSetup {
  return { id: newId(), name: '', eyeline, cameras: defaultCameras(), place: '', background: '', light: '', sound: 'Micro-cravate + perche' };
}

export function makeInterviewee(index: number, eyeline: InterviewSetup['eyeline'] = index % 2 ? 'droite' : 'gauche'): Interviewee {
  return { id: newId(), name: '', role: '', setups: [makeSetup(0, eyeline)] };
}

/** Nouveau cadre pour un intervenant : reprend le dispositif du cadre courant, à adapter. */
export function addSetup(doc: ProjectDoc, subjectId: ID, from?: ID): ID | undefined {
  const s = ensureInterview(doc).subjects.find((x) => x.id === subjectId);
  if (!s) return undefined;
  const base = s.setups.find((x) => x.id === from) ?? s.setups.at(-1);
  const setup: InterviewSetup = base
    ? // Copie par JSON : `base` peut être un brouillon immer (que structuredClone refuse).
      { ...(JSON.parse(JSON.stringify(base)) as InterviewSetup), id: newId(), name: '', cameras: base.cameras.map((c) => ({ ...c, id: newId() })) }
    : makeSetup(s.setups.length);
  s.setups.push(setup);
  return setup.id;
}

export function removeSetup(doc: ProjectDoc, subjectId: ID, setupId: ID): void {
  const itw = ensureInterview(doc);
  const s = itw.subjects.find((x) => x.id === subjectId);
  if (!s || s.setups.length <= 1) return;
  s.setups = s.setups.filter((x) => x.id !== setupId);
  itw.questions = itw.questions.filter((q) => q.setupId !== setupId);
}

/** Anciennes fiches (un seul dispositif à plat sur l'intervenant) : converties en un premier cadre. */
function upgrade(s: Interviewee): void {
  const old = s as Interviewee & Partial<Omit<InterviewSetup, 'id' | 'name'>>;
  if (!Array.isArray(s.setups) || s.setups.length === 0) {
    s.setups = [
      {
        id: newId(),
        name: '',
        eyeline: old.eyeline ?? 'gauche',
        cameras: old.cameras ?? defaultCameras(),
        place: old.place ?? '',
        background: old.background ?? '',
        light: old.light ?? '',
        sound: old.sound ?? 'Micro-cravate + perche',
      },
    ];
  }
  for (const k of ['eyeline', 'cameras', 'place', 'background', 'light', 'sound'] as const) delete old[k];
  delete (s as { checked?: unknown }).checked;
}

/** Au chargement : fiches d'interview d'anciennes versions remises au format courant. */
export function upgradeInterview(doc: ProjectDoc): void {
  if (!doc.interview) return;
  doc.interview.subjects = Array.isArray(doc.interview.subjects) ? doc.interview.subjects : [];
  doc.interview.questions = Array.isArray(doc.interview.questions) ? doc.interview.questions : [];
  doc.interview.subjects.forEach(upgrade);
}

/** L'interview du projet, créée au besoin avec un intervenant (cas par défaut). */
export function ensureInterview(doc: ProjectDoc): Interview {
  doc.interview ??= { subjects: [makeInterviewee(0)], questions: [] };
  if (doc.interview.subjects.length === 0) doc.interview.subjects.push(makeInterviewee(0));
  doc.interview.subjects.forEach(upgrade);
  return doc.interview;
}

/** Ajoute un intervenant ; son regard est opposé au précédent, pour pouvoir les monter en dialogue. */
export function addInterviewee(doc: ProjectDoc): ID {
  const itw = ensureInterview(doc);
  const prev = itw.subjects.at(-1)?.setups[0]?.eyeline;
  const eyeline = prev === 'gauche' ? 'droite' : 'gauche';
  const s = makeInterviewee(itw.subjects.length, eyeline);
  itw.subjects.push(s);
  return s.id;
}

export function removeInterviewee(doc: ProjectDoc, id: ID): void {
  const itw = ensureInterview(doc);
  if (itw.subjects.length <= 1) return;
  itw.subjects = itw.subjects.filter((s) => s.id !== id);
  itw.questions = itw.questions.filter((q) => q.subjectId !== id);
}

/** Questions vues dans un cadre : communes, propres à l'intervenant, propres à ce cadre (ordre de la liste). */
export function questionsFor(itw: Interview, subjectId: ID, setupId?: ID): InterviewQuestion[] {
  return itw.questions.filter((q) => !q.subjectId || (q.subjectId === subjectId && (!q.setupId || !setupId || q.setupId === setupId)));
}

/** Déplace une question d'un cran parmi celles que voit cet intervenant. */
export function moveQuestion(itw: Interview, subjectId: ID, qId: ID, delta: -1 | 1, setupId?: ID): void {
  const visible = questionsFor(itw, subjectId, setupId);
  const i = visible.findIndex((q) => q.id === qId);
  const other = visible[i + delta];
  if (i < 0 || !other) return;
  const a = itw.questions.findIndex((q) => q.id === qId);
  const b = itw.questions.findIndex((q) => q.id === other.id);
  [itw.questions[a], itw.questions[b]] = [itw.questions[b], itw.questions[a]];
}

// --- L'interview dans le découpage ----------------------------------------------------------------
//
// Un cadre d'interview peut rester une annexe (fiche seule) ou être placé dans une séquence : il y
// devient un plan par caméra (2.3A, 2.3B : un numéro, une lettre par caméra), groupés et dessinés en
// une seule bande dans le découpage. La fiche reste la source : sujet, valeur, axe, focale et action
// des plans la suivent ; on déplace ou supprime le groupe d'un bloc.

/** Plans du découpage tournés par un cadre (un par caméra), dans l'ordre des séquences. */
export function setupShotIds(doc: ProjectDoc, setupId: ID): ID[] {
  const out: ID[] = [];
  for (const seqId of doc.project.sequenceIds) for (const id of doc.sequences[seqId]?.shotIds ?? []) if (doc.shots[id]?.interview?.setupId === setupId) out.push(id);
  return out;
}

/** Intervenant et cadre d'un identifiant de cadre. */
export function findSetup(doc: ProjectDoc, setupId: ID): { subject: Interviewee; setup: InterviewSetup } | undefined {
  for (const subject of doc.interview?.subjects ?? []) for (const setup of subject.setups ?? []) if (setup.id === setupId) return { subject, setup };
  return undefined;
}

/** Action commune aux caméras d'un cadre : qui parle, à quel titre, où, son regard, ses questions. */
export function interviewAction(subject: Pick<Interviewee, 'id' | 'name' | 'role'>, setup?: InterviewSetup, itw?: Interview): string {
  const label = (x: Pick<Interviewee, 'name' | 'role'>) => `${x.name.trim() || 'intervenant'}${x.role.trim() ? `, ${x.role.trim()}` : ''}`;
  // Multicam : tous les intervenants filmés par les caméras du cadre.
  const filmed = setup && itw ? [...new Set(setup.cameras.map((c) => c.filmsId ?? subject.id))].map((id) => itw.subjects.find((x) => x.id === id) ?? subject) : [subject];
  const who = `Interview — ${filmed.map(label).join(' et ')}`;
  if (!setup) return who;
  const n = itw ? questionsFor(itw, subject.id, setup.id).length : 0;
  return [who, [setup.name.trim(), setup.place.trim()].filter(Boolean).join(', '), EYELINE_SHORT[setup.eyeline]?.toLocaleLowerCase('fr'), n ? `${n} question${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
}

/** Focale saisie librement dans la fiche (« 50 », « 24-70 mm ») : en millimètres. */
function parseFocal(text: string): Shot['focal'] {
  const m = /(\d+(?:[.,]\d+)?)(?:\s*(?:[-–]|à)\s*(\d+(?:[.,]\d+)?))?/.exec(text ?? '');
  if (!m) return {};
  const num = (v: string) => Number(v.replace(',', '.'));
  return m[2] ? { from: num(m[1]), to: num(m[2]) } : { from: num(m[1]) };
}

/** Intervenant filmé par une caméra : celui choisi (multicam), sinon celui du cadre. */
export function filmedBy(doc: ProjectDoc, subject: Interviewee, cam: InterviewCamera): Interviewee {
  return (cam.filmsId && doc.interview?.subjects.find((x) => x.id === cam.filmsId)) || subject;
}

/** Champs d'un plan tirés d'une caméra de la fiche. */
function cameraFields(subject: Interviewee, cam: InterviewCamera, doc?: ProjectDoc): Pick<Shot, 'subject' | 'value' | 'angle' | 'focal'> {
  const who = doc ? filmedBy(doc, subject, cam) : subject;
  return {
    subject: who.name.trim() || 'Intervenant',
    value: cam.value.trim(),
    angle: cam.angle.split(',').map((t) => t.trim()).filter(Boolean),
    focal: parseFocal(cam.focal),
  };
}

const cameraShot = (subject: Interviewee, setup: InterviewSetup, cam: InterviewCamera, doc?: ProjectDoc): Partial<Shot> => ({
  ...cameraFields(subject, cam, doc),
  movement: ['Fixe'],
  sound: setup.sound.trim() || undefined,
  interview: { subjectId: subject.id, setupId: setup.id, cameraId: cam.id },
});

/** Libellé de la séquence créée pour un cadre placé à part. */
export const interviewSequenceLabel = (s: Pick<Interviewee, 'name'>) => `Interview${s.name.trim() ? ` ${s.name.trim()}` : ''}`;

/**
 * Place un cadre dans une séquence (à sa fin), ou dans une nouvelle séquence en fin de découpage
 * (`'new'`) ; sans séquence, il sort du découpage et la fiche reste en annexe.
 */
/** Numéro de plan auquel un cadre placé commence dans sa séquence (« 3 » pour 3A, 3B). */
export function setupNumber(doc: ProjectDoc, setupId: ID): number | undefined {
  const ids = setupShotIds(doc, setupId);
  return ids.length ? shotNumber(doc, ids[0]) : undefined;
}

/** Plans d'une séquence hors ce cadre : le plus grand numéro qu'il peut prendre (en fin de séquence). */
export function maxSetupNumber(doc: ProjectDoc, setupId: ID, seqId: ID): number {
  const others = (doc.sequences[seqId]?.shotIds ?? []).filter((id) => doc.shots[id]?.interview?.setupId !== setupId);
  let n = 0;
  let prev: ID | undefined;
  for (const id of others) {
    const g = doc.shots[id]?.interview?.setupId;
    if (!g || g !== prev) n++;
    prev = g;
  }
  return n + 1;
}

/**
 * Donne au cadre le numéro de plan voulu dans sa séquence : ses caméras se placent avant le plan qui
 * portait ce numéro (ou en fin de séquence), sans rien perdre de leurs réglages.
 */
export function setSetupNumber(doc: ProjectDoc, setupId: ID, number: number): void {
  const ids = setupShotIds(doc, setupId);
  if (!ids.length) return;
  const seq = doc.sequences[doc.shots[ids[0]].sequenceId];
  const rest = seq.shotIds.filter((id) => !ids.includes(id));
  let n = 0;
  let prev: ID | undefined;
  let at = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const g = doc.shots[rest[i]]?.interview?.setupId;
    if (!g || g !== prev) n++;
    prev = g;
    if (n === number && (!g || doc.shots[rest[i - 1]]?.interview?.setupId !== g)) {
      at = i;
      break;
    }
  }
  const order = [...rest.slice(0, at), ...ids, ...rest.slice(at)];
  if (order.some((id, i) => id !== seq.shotIds[i])) seq.shotIds = order;
}

export function placeSetup(doc: ProjectDoc, setupId: ID, seqId?: ID | 'new'): void {
  const found = findSetup(doc, setupId);
  if (!found) return;
  const { subject, setup } = found;
  for (const id of setupShotIds(doc, setupId)) removeShot(doc, id);
  setup.sequenceId = undefined;
  let target = seqId === 'new' ? undefined : seqId && doc.sequences[seqId] ? seqId : undefined;
  if (seqId === 'new') target = addSequence(doc, undefined, { label: interviewSequenceLabel(subject) }, false);
  if (!target) return;
  setup.sequenceId = target;
  let blockId: ID | undefined;
  for (const cam of setup.cameras) {
    const id = addShot(doc, target, { blockId, action: { text: interviewAction(subject, setup, doc.interview) }, init: cameraShot(subject, setup, cam, doc) });
    blockId ??= doc.shots[id].actionBlockId;
  }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Remet les plans d'interview d'accord avec la fiche (après chaque modification du projet, et au
 * chargement). Idempotente : rien n'est réécrit quand tout est déjà juste.
 * - cadre, caméra ou intervenant supprimés : leurs plans quittent le découpage ;
 * - caméra ajoutée : son plan rejoint le groupe ; une caméra n'a qu'un plan (les doubles redeviennent
 *   des plans ordinaires) ;
 * - les caméras d'un cadre restent groupées, dans leur ordre, à la place du premier plan, avec une
 *   action commune ; un cadre dont le groupe a été supprimé redevient une annexe seule ;
 * - sujet, valeur, axe, focale et action suivent la fiche.
 */
export function syncInterviewShots(doc: ProjectDoc): void {
  const linked: Shot[] = [];
  for (const seqId of doc.project.sequenceIds) for (const id of doc.sequences[seqId]?.shotIds ?? []) if (doc.shots[id]?.interview) linked.push(doc.shots[id]);
  const placed = (doc.interview?.subjects ?? []).some((x) => (x.setups ?? []).some((y) => y.sequenceId));
  if (!linked.length && !placed) return;
  // Plans orphelins (cadre ou caméra disparus), doubles d'une même caméra.
  const seen = new Set<string>();
  for (const sh of linked) {
    const link = sh.interview!;
    const found = findSetup(doc, link.setupId);
    if (!found || !found.setup.cameras.some((c) => c.id === link.cameraId)) {
      removeShot(doc, sh.id);
      continue;
    }
    const key = `${link.setupId}/${link.cameraId}`;
    if (seen.has(key)) sh.interview = undefined;
    else seen.add(key);
  }
  for (const subject of doc.interview?.subjects ?? [])
    for (const setup of subject.setups ?? []) {
      const ids = setupShotIds(doc, setup.id);
      if (!ids.length) {
        if (setup.sequenceId) setup.sequenceId = undefined;
        continue;
      }
      const first = doc.shots[ids[0]];
      const seqId = first.sequenceId;
      const blockId = first.actionBlockId;
      if (setup.sequenceId !== seqId) setup.sequenceId = seqId;
      let moved = false;
      for (const cam of setup.cameras)
        if (!ids.some((id) => doc.shots[id].interview!.cameraId === cam.id)) {
          addShot(doc, seqId, { blockId, index: doc.sequences[seqId].shotIds.indexOf(ids[ids.length - 1]) + 1, init: cameraShot(subject, setup, cam, doc) });
          moved = true;
        }
      const byCam = new Map(setupShotIds(doc, setup.id).map((id) => [doc.shots[id].interview!.cameraId, id]));
      const group = setup.cameras.map((c) => byCam.get(c.id)!).filter(Boolean);
      // Groupe contigu, dans l'ordre des caméras, à la place du premier plan.
      const seq = doc.sequences[seqId];
      const at = seq.shotIds.indexOf(group.find((id) => seq.shotIds.includes(id))!);
      const rest = seq.shotIds.filter((id) => !group.includes(id));
      const before = seq.shotIds.slice(0, at).filter((id) => !group.includes(id)).length;
      const order = [...rest.slice(0, before), ...group, ...rest.slice(before)];
      const touched = new Set<ID>();
      for (const id of group) {
        const sh = doc.shots[id];
        if (sh.sequenceId !== seqId) {
          const from = doc.sequences[sh.sequenceId];
          if (from) from.shotIds = from.shotIds.filter((x) => x !== id);
          touched.add(sh.sequenceId);
          sh.sequenceId = seqId;
        }
        if (sh.actionBlockId !== blockId) {
          sh.actionBlockId = blockId;
          moved = true;
        }
      }
      if (!sameList(seq.shotIds, order)) {
        seq.shotIds = order;
        moved = true;
      }
      if (moved || touched.size) {
        touched.add(seqId);
        for (const t of touched) normalizeBlocks(doc, t);
      }
      // Champs tirés de la fiche.
      const text = interviewAction(subject, setup, doc.interview);
      const block = doc.blocks[doc.shots[group[0]].actionBlockId];
      if (block && block.text !== text) block.text = text;
      setup.cameras.forEach((cam, k) => {
        const sh = doc.shots[group[k]];
        if (!sh) return;
        const f = cameraFields(subject, cam, doc);
        if (sh.subject !== f.subject) {
          sh.subject = f.subject;
          sh.characterIds = recognizeCharacters(f.subject, Object.values(doc.characters));
        }
        if (sh.value !== f.value) sh.value = f.value;
        if (!sameList(sh.angle, f.angle)) sh.angle = f.angle;
        if (sh.focal.from !== f.focal.from || sh.focal.to !== f.focal.to) sh.focal = f.focal;
        const sound = setup.sound.trim() || undefined;
        if (sh.sound !== sound) sh.sound = sound;
        if (sh.interview!.subjectId !== subject.id) sh.interview!.subjectId = subject.id;
      });
    }
}

/** Regard de l'intervenant, en bref (bande du découpage). */
export const EYELINE_SHORT: Record<InterviewSetup['eyeline'], string> = { gauche: 'Regard à gauche', droite: 'Regard à droite', camera: 'Face caméra' };
