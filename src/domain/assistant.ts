/**
 * Assistant de découpage (§15.6) : construction de la demande et validation stricte de la réponse.
 * Aucune dépendance réseau ici ; l'appel est fait par `features/assistant/aiClient.ts`.
 */
import { addShot } from './ops';
import type { ID, ProjectDoc } from './types';
import { ANGLES, COMMON_FOCALS, matchVocab, MOVEMENTS, SHOT_VALUES } from './vocabulary';

export interface ProposedShot {
  subject: string;
  value: string;
  angle: string[];
  movement: string[];
  focal: number;
  action: string;
}

/** Schéma JSON imposé à la réponse : uniquement le vocabulaire du §5. */
export function proposalSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['shots'],
    properties: {
      shots: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['subject', 'value', 'angle', 'movement', 'focal', 'action'],
          properties: {
            subject: { type: 'string' },
            value: { type: 'string', enum: SHOT_VALUES.map((v) => v.short) },
            angle: { type: 'array', items: { type: 'string', enum: ANGLES.map((a) => a.short) } },
            movement: { type: 'array', items: { type: 'string', enum: MOVEMENTS.map((m) => m.short) } },
            focal: { type: 'integer' },
            action: { type: 'string' },
          },
        },
      },
    },
  };
}

export const ASSISTANT_SYSTEM = `Tu es chef opérateur et réalisateur. Tu proposes un découpage technique de départ pour une séquence de film, en français.
Règles :
- Utilise exclusivement le vocabulaire fourni par le schéma (valeurs de cadre, angles = un axe et une hauteur, mouvements).
- Focales en millimètres parmi : ${COMMON_FOCALS.join(', ')}.
- « subject » : le personnage ou l'objet cadré, tel qu'écrit dans le texte.
- « action » : l'action couverte, reprise du texte ; plusieurs plans consécutifs qui couvrent la même action portent exactement le même texte d'action.
- Entre 3 et 12 plans, du plus large au plus serré quand c'est pertinent, en évitant deux plans consécutifs identiques.`;

/** Texte de la séquence soumis à l'assistant : passage du scénario, sinon résumé et actions. */
export function sequenceSourceText(doc: ProjectDoc, seqId: ID): string {
  const seq = doc.sequences[seqId];
  if (!seq) return '';
  if (doc.scenario && seq.scenarioAnchor) return doc.scenario.slice(seq.scenarioAnchor.start, seq.scenarioAnchor.end).trim();
  const actions = seq.actionBlockIds.map((id) => doc.blocks[id]?.text).filter(Boolean);
  return [seq.label, seq.summary, ...actions].filter(Boolean).join('\n');
}

export function buildUserPrompt(doc: ProjectDoc, seqId: ID): string {
  const seq = doc.sequences[seqId];
  const cast = Object.values(doc.characters).map((c) => c.name);
  return [
    `Séquence : ${seq?.label ?? ''} (${[seq?.intExt, seq?.effect].filter(Boolean).join(' · ') || 'INT/EXT non précisé'})`,
    `Format du projet : ${doc.project.format}`,
    cast.length ? `Personnages connus : ${cast.join(', ')}` : '',
    'Texte de la séquence :',
    sequenceSourceText(doc, seqId) || '(aucun texte : propose une couverture classique de la séquence)',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Valide et normalise la réponse : tout terme hors vocabulaire est écarté. */
export function parseProposal(json: unknown): ProposedShot[] {
  const shots = (json as { shots?: unknown })?.shots;
  if (!Array.isArray(shots)) throw new Error('Réponse inattendue de l’assistant.');
  const out: ProposedShot[] = [];
  for (const raw of shots.slice(0, 30)) {
    const r = raw as Partial<Record<keyof ProposedShot, unknown>>;
    const value = typeof r.value === 'string' ? matchVocab(r.value, SHOT_VALUES)?.short : undefined;
    if (!value) continue;
    const tokens = (list: unknown, vocab: typeof ANGLES) =>
      (Array.isArray(list) ? list : []).map((t) => (typeof t === 'string' ? matchVocab(t, vocab)?.short : undefined)).filter((t): t is string => !!t);
    const focal = typeof r.focal === 'number' && r.focal > 0 && r.focal < 1000 ? Math.round(r.focal) : 35;
    out.push({
      subject: typeof r.subject === 'string' ? r.subject.trim().slice(0, 80) : '',
      value,
      angle: tokens(r.angle, ANGLES),
      movement: tokens(r.movement, MOVEMENTS),
      focal,
      action: typeof r.action === 'string' ? r.action.trim().slice(0, 400) : '',
    });
  }
  return out;
}

/** Ajoute les plans proposés en fin de séquence ; les actions identiques consécutives sont liées. */
export function applyProposal(doc: ProjectDoc, seqId: ID, shots: readonly ProposedShot[]): ID[] {
  const ids: ID[] = [];
  let prevAction: string | undefined;
  let prevBlock: ID | undefined;
  for (const s of shots) {
    const sameAction = !!s.action && s.action === prevAction;
    const id = addShot(doc, seqId, {
      blockId: sameAction ? prevBlock : undefined,
      action: { text: s.action },
      init: { subject: s.subject, value: s.value, angle: s.angle, movement: s.movement, focal: { from: s.focal } },
    });
    ids.push(id);
    prevAction = s.action;
    prevBlock = doc.shots[id].actionBlockId;
  }
  return ids;
}
