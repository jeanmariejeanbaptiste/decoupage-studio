import { describe, expect, it } from 'vitest';
import { AI_PLAN_INSTRUCTIONS, parsePlanMarkdown } from './planImport';

describe('import d’un plan de locaux décrit par une IA', () => {
  it('relit l’exemple des consignes et le met à l’échelle du plan', () => {
    const plan = parsePlanMarkdown(AI_PLAN_INSTRUCTIONS.slice(AI_PLAN_INSTRUCTIONS.indexOf('# PLAN')).replace(/<[^>]+>/g, '850').replace('hauteur: 850', 'hauteur: 520'))!;
    expect(plan.walls).toHaveLength(2);
    expect(plan.walls[0].white).toBe(true);
    expect(plan.doors).toHaveLength(1);
    expect(plan.windows).toHaveLength(1);
    // Mur du haut horizontal, à l'intérieur du plan.
    expect(plan.walls[0].y).toBe(plan.walls[0].y2);
    expect(plan.walls[1].x2).toBeLessThanOrEqual(1000);
  });
  it('refuse un texte qui n’est pas au format', () => {
    expect(parsePlanMarkdown('bonjour')).toBeNull();
  });
});
