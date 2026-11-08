/**
 * Demandes toutes faites à l'assistant, lancées depuis les pages (dépouillement, découpage) :
 * l'assistant lit le scénario et agit sur le projet avec ses outils ; tout s'annule en une fois.
 */
import { sequenceHeading } from '../../domain/numbering';
import type { ID, ProjectDoc } from '../../domain/types';
import { askAssistant, toggleAssistant } from './assistant';

const label = (doc: ProjectDoc, seqId: ID) => `la séquence ${doc.project.sequenceIds.indexOf(seqId) + 1} « ${sequenceHeading(doc, seqId).replace(/^\d+,\s*/, '')} »`;

/** Dépouillement d'une séquence (ou d'une scène du scénario pas encore au découpage). */
export function suggestBreakdown(doc: ProjectDoc, target: { seqId?: ID; heading?: string }): void {
  const which = target.seqId ? label(doc, target.seqId) : `la séquence « ${target.heading ?? ''} » du scénario (crée sa séquence au découpage si besoin)`;
  toggleAssistant(true);
  void askAssistant(
    `Dépouillement de ${which} : relis son texte dans le scénario et relève tout ce que la préparation doit prévoir (personnages et figurants, accessoires, costumes, maquillage et coiffure, décors et décoration, véhicules, animaux, effets spéciaux et visuels, cascades, son, matériel particulier). Ajoute-les avec add_breakdown_items dans les bonnes catégories, sans doublonner ce qui est déjà relevé. Termine par la liste de ce que tu as ajouté.`,
  );
}

/** Découpage technique proposé pour une séquence, ajouté à la suite de ses plans. */
export function suggestShots(doc: ProjectDoc, seqId: ID): void {
  toggleAssistant(true);
  void askAssistant(
    `Découpage technique de ${label(doc, seqId)} : en t'appuyant sur son texte dans le scénario, propose une suite de plans qui raconte la séquence clairement (valeur, angle, mouvement, focale, sujet, action liée au passage du scénario, durée estimée), puis ajoute-les avec add_shots à la fin de la séquence. Ne supprime ni ne modifie les plans existants. Explique en deux phrases tes choix de mise en scène.`,
  );
}
