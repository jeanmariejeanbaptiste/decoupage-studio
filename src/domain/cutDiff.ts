import { sequenceHeading, shotCode } from './numbering';
import { orderAngles } from './vocabulary';
import { sliceOf, type VersionSlice } from './versions';
import type { ID, ProjectDoc, Shot } from './types';

/**
 * Comparaison du découpage de deux versions du film. Les versions gardent les mêmes identifiants :
 * une séquence ou un plan se retrouve d'une version à l'autre par son identifiant. On liste ce qui
 * a été ajouté, retiré ou modifié (champ par champ), dans l'ordre de la version la plus récente.
 */
export interface FieldChange {
  label: string;
  before: string;
  after: string;
}
export interface ShotChange {
  status: 'added' | 'removed' | 'changed';
  code: string;
  label: string;
  fields: FieldChange[];
}
export interface SequenceChange {
  status: 'added' | 'removed' | 'changed';
  heading: string;
  shots: ShotChange[];
}

/** Le projet vu dans une version donnée (la courante vit dans le projet, les autres sont rangées). */
export function docOfVersion(doc: ProjectDoc, versionId: ID): ProjectDoc | null {
  const v = doc.versions?.find((x) => x.id === versionId);
  if (!v) return null;
  const s: VersionSlice = v.slice ?? sliceOf(doc);
  return { ...doc, scenario: s.scenario, project: { ...doc.project, sequenceIds: s.sequenceIds }, sequences: s.sequences, shots: s.shots, blocks: s.blocks };
}

const focalText = (s: Shot) => (s.focal.from === undefined ? '' : s.focal.to !== undefined && s.focal.to !== s.focal.from ? `${s.focal.from} → ${s.focal.to} mm` : `${s.focal.from} mm`);

function fields(d: ProjectDoc, s: Shot): [string, string][] {
  const b = d.blocks[s.actionBlockId];
  return [
    ['Sujet', s.subject],
    ['Valeur', s.value],
    ['Angle', orderAngles(s.angle).join(', ')],
    ['Mouvement', s.movement.join(s.movementSep ?? ', ')],
    ['Focale', focalText(s)],
    ['Action', b?.text ?? ''],
    ['Dialogue', b?.dialogue ?? ''],
    ['Son', s.sound ?? ''],
    ['Image', s.notes ?? ''],
    ['Statut', s.status ?? ''],
  ].map(([k, v]) => [k, (v ?? '').trim()]);
}

const shotLabel = (_d: ProjectDoc, s: Shot) => [s.subject, s.value].filter((x) => x?.trim()).join(' · ') || '—';

/** Différences du découpage de `a` (avant) à `b` (après). */
export function cutDiff(doc: ProjectDoc, aId: ID, bId: ID): SequenceChange[] {
  const A = docOfVersion(doc, aId);
  const B = docOfVersion(doc, bId);
  if (!A || !B) return [];
  const out: SequenceChange[] = [];
  const seen = new Set<ID>();
  const seqIds = [...B.project.sequenceIds, ...A.project.sequenceIds.filter((id) => !B.sequences[id] || !B.project.sequenceIds.includes(id))];
  for (const seqId of seqIds) {
    if (seen.has(seqId)) continue;
    seen.add(seqId);
    const inA = A.project.sequenceIds.includes(seqId) && !!A.sequences[seqId];
    const inB = B.project.sequenceIds.includes(seqId) && !!B.sequences[seqId];
    const src = inB ? B : A;
    const heading = sequenceHeading(src, seqId);
    if (!inA || !inB) {
      out.push({ status: inB ? 'added' : 'removed', heading, shots: src.sequences[seqId].shotIds.filter((id) => src.shots[id]).map((id) => ({ status: inB ? 'added' : 'removed', code: shotCode(src, id), label: shotLabel(src, src.shots[id]), fields: [] })) });
      continue;
    }
    const shots: ShotChange[] = [];
    const aIds = A.sequences[seqId].shotIds.filter((id) => A.shots[id]);
    const bIds = B.sequences[seqId].shotIds.filter((id) => B.shots[id]);
    for (const id of bIds) {
      if (!aIds.includes(id)) {
        shots.push({ status: 'added', code: shotCode(B, id), label: shotLabel(B, B.shots[id]), fields: [] });
        continue;
      }
      const fa = fields(A, A.shots[id]);
      const fb = fields(B, B.shots[id]);
      const diff = fb.flatMap(([label, after], k) => (after !== fa[k][1] ? [{ label, before: fa[k][1], after }] : []));
      if (diff.length) shots.push({ status: 'changed', code: shotCode(B, id), label: shotLabel(B, B.shots[id]), fields: diff });
    }
    for (const id of aIds) if (!bIds.includes(id)) shots.push({ status: 'removed', code: shotCode(A, id), label: shotLabel(A, A.shots[id]), fields: [] });
    const meta = [A.sequences[seqId], B.sequences[seqId]].map((q) => [q.label, q.intExt, q.effect].join('|'));
    if (shots.length || meta[0] !== meta[1]) out.push({ status: 'changed', heading, shots });
  }
  return out;
}

/** Efface le découpage de la version courante (séquences, plans, actions) ; le scénario reste. */
export function clearCut(doc: ProjectDoc, remove: (d: ProjectDoc, seqId: ID) => void): number {
  const ids = [...doc.project.sequenceIds];
  for (const id of ids) remove(doc, id);
  return ids.length;
}
