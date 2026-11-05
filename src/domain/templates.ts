import { addSequence, addShot } from './ops';
import { applyFormat } from './factory';
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
    key: 'fiction-dialogue',
    label: 'Fiction — dialogue champ / contrechamp',
    sequenceLabel: 'SCÈNE DE DIALOGUE',
    formats: ['fiction'],
    description: 'Plan d’installation, deux-plan, champ et contrechamp qui se resserrent, réaction, insert.',
    actions: {
      installe: 'Installation : les deux personnages dans le décor',
      echange: 'Échange : A parle, B écoute',
      reponse: 'Réponse : B parle, A écoute',
      bascule: 'Moment de bascule',
      detail: 'Détail qui porte la scène',
    },
    shots: [
      sh('installe', 'Ensemble', ['Face', HR], ['Fixe'], 'A, B'),
      sh('installe', 'Américain', ['3/4 Face', HR], ['Fixe'], 'A, B'),
      sh('echange', 'Rapproché', ['3/4 Face', HR], ['Fixe'], 'A'),
      sh('reponse', 'Rapproché', ['3/4 Face', HR], ['Fixe'], 'B'),
      sh('bascule', 'Gros plan', ['3/4 Face', HR], ['Fixe'], 'A'),
      sh('bascule', 'Gros plan', ['3/4 Face', HR], ['Fixe'], 'B'),
      sh('detail', 'Insert', ['Plongée'], ['Fixe']),
    ],
  },
  {
    key: 'fiction-action',
    label: 'Fiction — scène d’action',
    sequenceLabel: 'SCÈNE D’ACTION',
    formats: ['fiction'],
    description: 'Large pour situer, caméra qui accompagne le mouvement, réactions, détails, plan de résolution.',
    actions: {
      situe: 'Situer l’espace et les enjeux',
      mouvement: 'Le mouvement : on suit l’action',
      reaction: 'Réactions',
      detail: 'Détails de l’action',
      fin: 'Résolution',
    },
    shots: [
      sh('situe', 'Général', ['Face', 'Plongée'], ['Fixe'], 'Lieu'),
      sh('mouvement', 'Moyen', ['3/4 Face', HR], ['Épaule']),
      sh('mouvement', 'Taille', ['Profil gauche', HR], ['Trav latéral']),
      sh('reaction', 'Gros plan', ['Face', HR], ['Fixe']),
      sh('detail', 'Insert', ['Low angle'], ['Fixe'], 'Mains'),
      sh('detail', 'Insert', ['Plongée'], ['Fixe'], 'Objet'),
      sh('fin', 'Ensemble', ['Face', 'Contre-plongée'], ['Trav arrière']),
    ],
  },
  {
    key: 'interview',
    label: 'Interview institutionnelle',
    sequenceLabel: 'INTERVIEW',
    formats: ['institutionnel'],
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
    formats: ['clip'],
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
    formats: ['clip'],
    description: 'Une action racontée sur la musique : du plan moyen au gros plan, puis un insert.',
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

/**
 * Modèles proposés dans un projet : seulement ceux de son format (un clip ne propose pas de scène de
 * fiction, et inversement). Projet encore vide : tous, puisque le premier modèle choisit le format.
 */
export function templatesForProject(doc: ProjectDoc): SequenceTemplate[] {
  if (doc.project.sequenceIds.length === 0) return templatesFor(doc.project.format);
  const own = TEMPLATES.filter((t) => t.formats.includes(doc.project.format));
  return own.length ? own : templatesFor(doc.project.format);
}

/** Insère une séquence pré-remplie à l'index donné (fin par défaut). Renvoie son identifiant. */
export function applyTemplate(doc: ProjectDoc, key: string, index?: number): ID | undefined {
  const tpl = TEMPLATES.find((t) => t.key === key);
  if (!tpl) return undefined;
  // Premier modèle d'un projet vide : le projet prend le format du modèle, et son minutage avec
  // (piste musicale pour un clip, durée de chaque plan pour une fiction).
  if (doc.project.sequenceIds.length === 0 && !tpl.formats.includes(doc.project.format)) applyFormat(doc, tpl.formats[0]);
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
