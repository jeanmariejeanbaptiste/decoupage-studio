/**
 * Découpage institutionnel, volet A-roll : l'interview face caméra. Une fiche par intervenant
 * (dispositif caméra, regard, son, décor et lumière, questions) ; les plans d'illustration (B-roll)
 * restent dans la grille classique, avec un créneau horaire par séquence au lieu d'un minutage.
 */
import { newId } from './factory';
import type { ID, ProjectDoc } from './types';

export interface InterviewCamera {
  id: ID;
  /** A, B, C… */
  name: string;
  value: string;
  angle: string;
  focal: string;
  note?: string;
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

export function makeSetup(index: number, eyeline: InterviewSetup['eyeline'] = 'gauche'): InterviewSetup {
  return { id: newId(), name: `Cadre ${index + 1}`, eyeline, cameras: defaultCameras(), place: '', background: '', light: '', sound: 'Micro-cravate + perche' };
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
    ? { ...structuredClone(base), id: newId(), name: `Cadre ${s.setups.length + 1}`, cameras: base.cameras.map((c) => ({ ...c, id: newId() })) }
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
        name: 'Cadre 1',
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
