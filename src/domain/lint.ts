import { recognizeCharacters } from './characters';
import { shotCode, sequenceHeading } from './numbering';
import { fold, mergeKey } from './text';
import type { Timing } from './timing';
import { tokensKey } from './tokens';
import type { ID, ProjectDoc } from './types';
import { isZoom, matchVocab, MOVEMENTS, valueRank, WIDE_VALUE_KEYS, SHOT_VALUES } from './vocabulary';

export type CheckCode =
  | 'zoom-focal'
  | 'missing-value'
  | 'missing-subject'
  | 'jump-cut'
  | 'empty-sequence'
  | 'doc-open-wide'
  | 'doc-close-wide'
  | 'estimate-gap'
  | 'drone'
  | 'stabilizer-safety'
  | 'unknown-subject';

export interface Issue {
  /** Identifiant stable, utilisé pour « ignorer ici ». */
  id: string;
  code: CheckCode;
  level: 'warn' | 'info';
  sequenceId: ID;
  shotId?: ID;
  where: string;
  message: string;
}

export const CHECK_LABELS: Readonly<Record<CheckCode, string>> = {
  'zoom-focal': 'Zoom sans focales de départ et d’arrivée',
  'missing-value': 'Plan sans valeur de cadre',
  'missing-subject': 'Plan sans sujet',
  'jump-cut': 'Plans consécutifs identiques (risque de saute)',
  'empty-sequence': 'Séquence sans plan',
  'doc-open-wide': 'Documentaire : ouverture sans plan large',
  'doc-close-wide': 'Documentaire : fermeture sans plan large',
  'estimate-gap': 'Écart estimé / calculé supérieur à 25 %',
  drone: 'Rappel réglementaire drone',
  'stabilizer-safety': 'Rappel sécurité machiniste',
  'unknown-subject': 'Sujet absent de la base des personnages',
};

const DRONE_MSG =
  'Drone : catégorie ouverte, 120 m maximum au-dessus du sol, distances de sécurité avec les personnes, formation A1/A3 selon la classe ; vérifier les zones sur Géoportail.';
const SAFETY_MSG = 'Épaule ou steadicam : prévoir un machiniste de sécurité pour guider l’opérateur.';

function isWide(value: string): boolean {
  const rank = valueRank(value);
  return rank >= 0 && WIDE_VALUE_KEYS.includes(SHOT_VALUES[rank].key);
}

/** Contrôles de la scripte (§9) : avertissements non bloquants. */
export function runChecks(doc: ProjectDoc, timing: Timing): Issue[] {
  const issues: Issue[] = [];
  const ignored = new Set(doc.ignoredChecks);
  const chars = Object.values(doc.characters);
  const push = (i: Omit<Issue, 'id'>) => {
    const id = `${i.code}:${i.shotId ?? i.sequenceId}`;
    if (!ignored.has(id)) issues.push({ ...i, id });
  };

  for (const seqId of doc.project.sequenceIds) {
    const seq = doc.sequences[seqId];
    if (!seq) continue;
    const where = sequenceHeading(doc, seqId);
    if (seq.shotIds.length === 0) {
      push({ code: 'empty-sequence', level: 'warn', sequenceId: seqId, where, message: 'Cette séquence ne contient aucun plan.' });
    } else if (doc.project.format === 'documentaire') {
      const first = doc.shots[seq.shotIds[0]];
      const last = doc.shots[seq.shotIds[seq.shotIds.length - 1]];
      if (first && !isWide(first.value))
        push({ code: 'doc-open-wide', level: 'warn', sequenceId: seqId, shotId: first.id, where, message: 'La séquence ne s’ouvre pas sur un plan large (général, ensemble ou moyen).' });
      if (last && !isWide(last.value))
        push({ code: 'doc-close-wide', level: 'warn', sequenceId: seqId, shotId: last.id === first?.id ? undefined : last.id, where, message: 'La séquence ne se ferme pas sur un plan large (général, ensemble ou moyen).' });
    }

    const gap = timing.sequences.get(seqId)?.gap;
    if (gap && Math.abs(gap.pct) > 25) {
      push({ code: 'estimate-gap', level: 'warn', sequenceId: seqId, where, message: `Écart de ${Math.round(gap.pct)} % entre durée estimée et durée calculée.` });
    }

    seq.shotIds.forEach((shotId, i) => {
      const shot = doc.shots[shotId];
      if (!shot) return;
      const at = shotCode(doc, shotId);
      const base = { sequenceId: seqId, shotId, where: `Plan ${at}` };
      if (isZoom(shot.movement) && (shot.focal.from === undefined || shot.focal.to === undefined))
        push({ ...base, code: 'zoom-focal', level: 'warn', message: 'Zoom présent dans le mouvement : renseigner la focale de départ et d’arrivée.' });
      if (!shot.value.trim()) push({ ...base, code: 'missing-value', level: 'warn', message: 'Valeur de cadre manquante.' });
      if (!shot.subject.trim()) push({ ...base, code: 'missing-subject', level: 'warn', message: 'Sujet manquant.' });
      const prev = i > 0 ? doc.shots[seq.shotIds[i - 1]] : undefined;
      if (
        prev &&
        shot.value.trim() &&
        mergeKey(prev.value) === mergeKey(shot.value) &&
        tokensKey(prev.angle) === tokensKey(shot.angle) &&
        mergeKey(prev.subject) === mergeKey(shot.subject) &&
        tokensKey(prev.movement) === tokensKey(shot.movement)
      ) {
        push({ ...base, code: 'jump-cut', level: 'warn', message: `Identique au plan précédent en valeur, angle et sujet : risque de saute.` });
      }
      const moves = shot.movement.map((m) => matchVocab(m, MOVEMENTS)?.key ?? fold(m));
      if (moves.some((m) => m.includes('drone'))) push({ ...base, code: 'drone', level: 'info', message: DRONE_MSG });
      if (moves.some((m) => m === 'epaule' || m === 'steadicam' || m.includes('epaule') || m.includes('steadicam')))
        push({ ...base, code: 'stabilizer-safety', level: 'info', message: SAFETY_MSG });
      if (shot.subject.trim() && recognizeCharacters(shot.subject, chars).length === 0)
        push({ ...base, code: 'unknown-subject', level: 'info', message: `« ${shot.subject.trim()} » n’est pas dans la base des personnages.` });
    });
  }
  return issues;
}
