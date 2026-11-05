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
  asked?: boolean;
  note?: string;
}

export interface Interviewee {
  id: ID;
  name: string;
  /** Fonction, telle qu'elle apparaîtra au synthé. */
  role: string;
  /** Regard vers l'intervieweur, à gauche ou à droite de la caméra, ou face caméra. */
  eyeline: 'gauche' | 'droite' | 'camera';
  cameras: InterviewCamera[];
  place: string;
  background: string;
  light: string;
  sound: string;
  notes?: string;
  /** Points vérifiés avant de tourner (clés de CHECKLIST). */
  checked: string[];
}

export interface Interview {
  subjects: Interviewee[];
  questions: InterviewQuestion[];
}

/** Ce qu'on vérifie avant chaque interview (usage courant en tournage institutionnel). */
export const CHECKLIST: ReadonlyArray<[string, string]> = [
  ['droit', 'Autorisation de droit à l’image signée'],
  ['synthe', 'Nom et fonction vérifiés (orthographe du synthé)'],
  ['tenue', 'Tenue : ni rayures fines, ni logo, ni tissu qui frotte le micro'],
  ['micro', 'Micro-cravate posé et testé, perche en secours'],
  ['bruit', 'Bruits coupés : climatisation, téléphones, portes'],
  ['balance', 'Même balance des blancs sur toutes les caméras'],
  ['clap', 'Clap ou top de synchronisation entre les caméras'],
  ['reformuler', 'Consigne donnée : reprendre la question dans la réponse'],
  ['ambiance', '30 secondes de silence plateau enregistrées'],
];

export function defaultCameras(): InterviewCamera[] {
  return [
    { id: newId(), name: 'A', value: 'Rapproché', angle: '3/4 Face, Hauteur regard', focal: '50' },
    { id: newId(), name: 'B', value: 'Gros plan', angle: 'Profil (≈ 30° de A)', focal: '85' },
  ];
}

export function makeInterviewee(index: number, eyeline: Interviewee['eyeline'] = index % 2 ? 'droite' : 'gauche'): Interviewee {
  return {
    id: newId(),
    name: '',
    role: '',
    eyeline,
    cameras: defaultCameras(),
    place: '',
    background: '',
    light: '',
    sound: 'Micro-cravate + perche',
    checked: [],
  };
}

/** L'interview du projet, créée au besoin avec un intervenant (cas par défaut). */
export function ensureInterview(doc: ProjectDoc): Interview {
  doc.interview ??= { subjects: [makeInterviewee(0)], questions: [] };
  if (doc.interview.subjects.length === 0) doc.interview.subjects.push(makeInterviewee(0));
  return doc.interview;
}

/** Ajoute un intervenant ; son regard est opposé au précédent, pour pouvoir les monter en dialogue. */
export function addInterviewee(doc: ProjectDoc): ID {
  const itw = ensureInterview(doc);
  const prev = itw.subjects.at(-1);
  const eyeline = prev?.eyeline === 'gauche' ? 'droite' : prev?.eyeline === 'droite' ? 'gauche' : 'gauche';
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

/** Questions vues par un intervenant : les communes, puis les siennes, dans l'ordre de la liste. */
export function questionsFor(itw: Interview, subjectId: ID): InterviewQuestion[] {
  return itw.questions.filter((q) => !q.subjectId || q.subjectId === subjectId);
}

/** Déplace une question d'un cran parmi celles que voit cet intervenant. */
export function moveQuestion(itw: Interview, subjectId: ID, qId: ID, delta: -1 | 1): void {
  const visible = questionsFor(itw, subjectId);
  const i = visible.findIndex((q) => q.id === qId);
  const other = visible[i + delta];
  if (i < 0 || !other) return;
  const a = itw.questions.findIndex((q) => q.id === qId);
  const b = itw.questions.findIndex((q) => q.id === other.id);
  [itw.questions[a], itw.questions[b]] = [itw.questions[b], itw.questions[a]];
}
