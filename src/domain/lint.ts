import { shotCode } from './numbering';
import { fold, mergeKey } from './text';
import { formatGap, type Timing } from './timing';
import { tokensKey } from './tokens';
import type { ID, ProjectDoc } from './types';
import { hasAngleConflict, isZoom, matchVocab, MOVEMENTS, valueRank, WIDE_VALUE_KEYS, SHOT_VALUES } from './vocabulary';

export type CheckCode =
  | 'zoom-focal'
  | 'missing-value'
  | 'missing-subject'
  | 'jump-cut'
  | 'angle-conflict'
  | 'empty-sequence'
  | 'doc-open-wide'
  | 'doc-close-wide'
  | 'estimate-gap'
  | 'drone'
  | 'stabilizer-safety';

export interface Issue {
  /** Identifiant stable, utilisé pour « ignorer ici ». */
  id: string;
  code: CheckCode;
  level: 'warn' | 'info';
  sequenceId: ID;
  shotId?: ID;
  message: string;
  /** Ce qui distingue cet avertissement des autres du même type (écart, plan voisin) ; absent sinon. */
  detail?: string;
}

export const CHECK_LABELS: Readonly<Record<CheckCode, string>> = {
  'zoom-focal': 'Zoom sans focales de départ et d’arrivée',
  'missing-value': 'Plan sans valeur de cadre',
  'missing-subject': 'Plan sans sujet',
  'jump-cut': 'Plans consécutifs identiques (risque de saute)',
  'angle-conflict': 'Angle : deux axes ou deux hauteurs incompatibles',
  'empty-sequence': 'Séquence sans plan',
  'doc-open-wide': 'Documentaire : ouverture sans plan large',
  'doc-close-wide': 'Documentaire : fermeture sans plan large',
  'estimate-gap': 'Écart estimé / calculé supérieur à 25\u202f%',
  drone: 'Rappel réglementaire drone',
  'stabilizer-safety': 'Rappel sécurité machiniste',
};

const DRONE_NOTE =
  'Catégorie ouverte, 120 m maximum au-dessus du sol, distances de sécurité avec les personnes, formation A1/A3 selon la classe ; vérifier les zones sur Géoportail.';
const DRONE_MSG = `Drone : ${DRONE_NOTE.charAt(0).toLowerCase()}${DRONE_NOTE.slice(1)}`;
const SAFETY_MSG = 'Épaule ou steadicam : prévoir un machiniste de sécurité pour guider l’opérateur.';

/**
 * Rappels : même texte pour chaque plan concerné, montré une fois en tête du groupe plutôt qu'à
 * chaque ligne.
 */
export const CHECK_NOTES: Readonly<Partial<Record<CheckCode, string>>> = { drone: DRONE_NOTE, 'stabilizer-safety': SAFETY_MSG };

export interface CheckGroup {
  code: CheckCode;
  level: Issue['level'];
  issues: Issue[];
}

/**
 * Regroupe les avertissements par type de contrôle : les avertissements d'abord, puis les rappels,
 * chacun dans l'ordre des contrôles ; à l'intérieur, l'ordre du découpage.
 */
export function groupChecks(issues: readonly Issue[]): CheckGroup[] {
  const order = Object.keys(CHECK_LABELS) as CheckCode[];
  const by = new Map<CheckCode, Issue[]>();
  for (const i of issues) by.set(i.code, [...(by.get(i.code) ?? []), i]);
  const groups = order.filter((c) => by.has(c)).map((code) => ({ code, level: by.get(code)![0].level, issues: by.get(code)! }));
  return [...groups.filter((g) => g.level === 'warn'), ...groups.filter((g) => g.level !== 'warn')];
}

function isWide(value: string): boolean {
  const rank = valueRank(value);
  return rank >= 0 && WIDE_VALUE_KEYS.includes(SHOT_VALUES[rank].key);
}

/** Contrôles de la scripte (§9) : avertissements non bloquants. */
export function runChecks(doc: ProjectDoc, timing: Timing): Issue[] {
  const issues: Issue[] = [];
  const ignored = new Set(doc.ignoredChecks);
  const push = (i: Omit<Issue, 'id'>) => {
    const id = `${i.code}:${i.shotId ?? i.sequenceId}`;
    if (!ignored.has(id)) issues.push({ ...i, id });
  };

  for (const seqId of doc.project.sequenceIds) {
    const seq = doc.sequences[seqId];
    if (!seq) continue;
    if (seq.shotIds.length === 0) {
      push({ code: 'empty-sequence', level: 'warn', sequenceId: seqId, message: 'Cette séquence ne contient aucun plan.' });
    } else if (doc.project.format === 'institutionnel') {
      // Les plans d'interview ne comptent pas : la règle vaut pour les illustrations.
      const broll = seq.shotIds.filter((id) => doc.shots[id] && !doc.shots[id].interview);
      const first = doc.shots[broll[0]];
      const last = doc.shots[broll[broll.length - 1]];
      if (first && !isWide(first.value))
        push({ code: 'doc-open-wide', level: 'warn', sequenceId: seqId, shotId: first.id, message: 'La séquence ne s’ouvre pas sur un plan large (général, ensemble ou moyen).' });
      if (last && !isWide(last.value))
        push({ code: 'doc-close-wide', level: 'warn', sequenceId: seqId, shotId: last.id === first?.id ? undefined : last.id, message: 'La séquence ne se ferme pas sur un plan large (général, ensemble ou moyen).' });
    }

    const gap = timing.sequences.get(seqId)?.gap;
    if (gap && Math.abs(gap.pct) > 25) {
      push({ code: 'estimate-gap', level: 'warn', sequenceId: seqId, message: `Écart de ${Math.round(gap.pct)}\u202f% entre durée estimée et durée calculée.`, detail: formatGap(gap).replace(' %', '\u202f%') });
    }

    seq.shotIds.forEach((shotId, i) => {
      const shot = doc.shots[shotId];
      if (!shot) return;
      const base = { sequenceId: seqId, shotId };
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
        push({ ...base, code: 'jump-cut', level: 'warn', message: `Identique au plan ${shotCode(doc, prev.id)} en valeur, angle et sujet : risque de saute.` });
      }
      if (hasAngleConflict(shot.angle))
        push({ ...base, code: 'angle-conflict', level: 'warn', message: 'Deux axes ou deux hauteurs incompatibles dans l’angle.', detail: shot.angle.join(', ') });
      const moves = shot.movement.map((m) => matchVocab(m, MOVEMENTS)?.key ?? fold(m));
      if (moves.some((m) => m.includes('drone'))) push({ ...base, code: 'drone', level: 'info', message: DRONE_MSG });
      if (moves.some((m) => m === 'epaule' || m === 'steadicam' || m.includes('epaule') || m.includes('steadicam')))
        push({ ...base, code: 'stabilizer-safety', level: 'info', message: SAFETY_MSG });
    });
  }
  return issues;
}
