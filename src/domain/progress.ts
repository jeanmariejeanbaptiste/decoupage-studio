import { aggregateEquipment, EQUIPMENT_CATEGORIES } from './equipment';
import type { ProjectDoc } from './types';

/** Avancement (0–100) des étapes de préparation qui disposent d'un outil. */
export function stepProgress(doc: ProjectDoc): Record<number, number> {
  const out: Record<number, number> = {};
  out[1] = (doc.intention?.trim().length ?? 0) > 0 ? Math.min(100, Math.round(((doc.intention ?? '').trim().split(/\s+/).length / 150) * 100)) : 0;
  if (doc.scenario !== undefined) out[2] = doc.scenario.trim() ? 100 : 0;
  const shots = Object.values(doc.shots);
  if (shots.length === 0) out[4] = 0;
  else {
    // Un plan est complet quand sujet, valeur, angle, mouvement, focale et action sont renseignés.
    const filled = shots.reduce((n, s) => {
      const parts = [s.subject.trim(), s.value.trim(), s.angle.length, s.movement.length, s.focal.from ?? s.focal.to, doc.blocks[s.actionBlockId]?.text.trim()];
      return n + parts.filter(Boolean).length / parts.length;
    }, 0);
    out[4] = Math.round((filled / shots.length) * 100);
  }
  const eq = aggregateEquipment(doc);
  out[7] = EQUIPMENT_CATEGORIES.some((c) => eq[c].length) ? (doc.validatedSteps.includes(7) ? 100 : 50) : 0;
  out[10] = doc.validatedSteps.includes(10) ? 100 : 0;
  for (const n of doc.validatedSteps) out[n] = 100;
  return out;
}
