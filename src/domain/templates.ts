import { addSequence, addShot } from './ops';
import type { ID, ProjectDoc, ProjectFormat } from './types';

interface TemplateShot {
  subject?: string;
  value: string;
  angle: string[];
  movement: string[];
  /** Plans d'un même groupe partagent l'action (couverture). */
  group: string;
}

export interface SequenceTemplate {
  key: string;
  label: string;
  sequenceLabel: string;
  formats: ProjectFormat[];
  description: string;
  actions: Record<string, string>;
  shots: TemplateShot[];
  /** Mode piste : les actions de ces groupes couvrent toute la piste (« TOUT »). */
  allTrackGroups?: string[];
}

const HR = 'Hauteur regard';
const sh = (group: string, value: string, angle: string[], movement: string[], subject?: string): TemplateShot => ({ group, value, angle, movement, subject });

/** Gabarits de séquence (§14 P12) : des plans pré-remplis (valeur, axe) à compléter. */
export const TEMPLATES: readonly SequenceTemplate[] = [
  {
    key: 'documentaire',
    label: 'Documentaire',
    sequenceLabel: 'SÉQUENCE DOCUMENTAIRE',
    formats: ['documentaire'],
    description: 'Exposition du lieu → arrivée → action → plans de coupe → interview → beauty → plan de fin.',
    actions: {
      expo: 'Plan d’exposition du lieu',
      arrivee: 'Arrivée du personnage',
      action: 'Action / interaction',
      coupe: 'Plans de coupe : mains, regards, écoute, amorce',
      itw: 'Interview',
      beauty: 'Illustrations « beauty »',
      fin: 'Plan de fin',
    },
    shots: [
      sh('expo', 'Général', ['Face', HR], ['Fixe'], 'Lieu'),
      sh('arrivee', 'Ensemble', ['3/4 Face', HR], ['Pano droite']),
      sh('action', 'Moyen', ['3/4 Face', HR], ['Épaule']),
      sh('action', 'Taille', ['Face', HR], ['Épaule']),
      sh('coupe', 'Insert', ['Plongée'], ['Fixe'], 'Mains'),
      sh('coupe', 'Gros plan', ['3/4 Face', HR], ['Fixe'], 'Regard'),
      sh('coupe', 'Rapproché', ['Profil gauche', HR], ['Fixe'], 'Écoute'),
      sh('coupe', 'Rapproché', ['3/4 Dos', HR], ['Fixe'], 'Amorce'),
      sh('itw', 'Rapproché', ['3/4 Face', HR], ['Fixe']),
      sh('beauty', 'Général', ['Face', HR], ['Trav latéral'], 'Lieu'),
      sh('beauty', 'Insert', ['Low angle'], ['Trav avant'], 'Détail'),
      sh('fin', 'Général', ['Face', HR], ['Fixe'], 'Lieu'),
    ],
  },
  {
    key: 'interview',
    label: 'Interview institutionnelle',
    sequenceLabel: 'INTERVIEW',
    formats: ['institutionnel', 'documentaire'],
    description: 'Large d’ouverture, axe épaule hauteur regard, gros plan aux questions, plans de coupe, large de fin.',
    actions: {
      ouverture: 'Large d’ouverture',
      itw: 'Interview — axe principal',
      questions: 'Gros plan à chaque question',
      coupe: 'Plans de coupe',
      fin: 'Large de fin',
    },
    shots: [
      sh('ouverture', 'Ensemble', ['3/4 Face', HR], ['Fixe'], 'Intervenant·e'),
      sh('itw', 'Rapproché', ['3/4 Face', HR], ['Fixe'], 'Intervenant·e'),
      sh('questions', 'Gros plan', ['3/4 Face', HR], ['Fixe'], 'Intervenant·e'),
      sh('coupe', 'Insert', ['Plongée'], ['Fixe'], 'Mains'),
      sh('coupe', 'Taille', ['Profil droit', HR], ['Trav latéral'], 'Intervenant·e'),
      sh('coupe', 'Général', ['Face', HR], ['Fixe'], 'Locaux'),
      sh('fin', 'Ensemble', ['Face', HR], ['Trav arrière'], 'Intervenant·e'),
    ],
  },
  {
    key: 'clip-performance',
    label: 'Clip — couverture performance',
    sequenceLabel: 'PERFORMANCE',
    formats: ['clip', 'pub'],
    description: 'La performance couverte sur toute la piste (TOUT), du large au détail.',
    actions: { perf: 'Performance — couverture intégrale du morceau' },
    allTrackGroups: ['perf'],
    shots: [
      sh('perf', 'Ensemble', ['Face', HR], ['Fixe'], 'Artiste'),
      sh('perf', 'Moyen', ['Face', 'Contre-plongée'], ['Trav avant'], 'Artiste'),
      sh('perf', 'Taille', ['3/4 Face', HR], ['Trav circulaire'], 'Artiste'),
      sh('perf', 'Rapproché', ['Profil gauche', HR], ['Gimbal'], 'Artiste'),
      sh('perf', 'Gros plan', ['3/4 Face', HR], ['Fixe'], 'Artiste'),
      sh('perf', 'Insert', ['Plongée'], ['Fixe'], 'Mains'),
    ],
  },
  {
    key: 'clip-narratif',
    label: 'Clip — séquence narrative',
    sequenceLabel: 'SÉQUENCE NARRATIVE',
    formats: ['clip', 'pub', 'fiction'],
    description: 'Une action racontée : du plan moyen au gros plan, puis un insert.',
    actions: { recit: 'Action narrative', detail: 'Détail' },
    shots: [
      sh('recit', 'Moyen', ['Face', HR], ['Trav arrière']),
      sh('recit', 'Taille', ['Face', HR], ['Trav arrière']),
      sh('recit', 'Rapproché', ['3/4 Face', HR], ['Trav circulaire']),
      sh('recit', 'Gros plan', ['3/4 Face', HR], ['Fixe']),
      sh('detail', 'Insert', ['Plongée'], ['Fixe']),
    ],
  },
];

export function templatesFor(format: ProjectFormat): SequenceTemplate[] {
  return [...TEMPLATES].sort((a, b) => Number(b.formats.includes(format)) - Number(a.formats.includes(format)));
}

/** Insère une séquence pré-remplie à l'index donné (fin par défaut). Renvoie son identifiant. */
export function applyTemplate(doc: ProjectDoc, key: string, index?: number): ID | undefined {
  const tpl = TEMPLATES.find((t) => t.key === key);
  if (!tpl) return undefined;
  const seqId = addSequence(doc, index, { label: tpl.sequenceLabel }, false);
  const piste = doc.project.settings.tcMode === 'piste';
  const blocks = new Map<string, ID>();
  for (const s of tpl.shots) {
    const shotId = addShot(doc, seqId, {
      blockId: blocks.get(s.group),
      action: { text: tpl.actions[s.group] ?? '', tc: piste && tpl.allTrackGroups?.includes(s.group) ? { all: true } : undefined },
      init: { subject: s.subject ?? '', value: s.value, angle: [...s.angle], movement: [...s.movement] },
    });
    blocks.set(s.group, doc.shots[shotId].actionBlockId);
  }
  return seqId;
}
