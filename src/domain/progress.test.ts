import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { createProjectDoc } from './factory';
import { addSequence } from './ops';
import { stepProgress } from './progress';

describe('avancement des étapes', () => {
  it('projet vide', () => {
    const doc = createProjectDoc({ title: 'x', format: 'fiction' });
    expect(stepProgress(doc)).toEqual({ 1: 0, 4: 0, 7: 0, 10: 0 });
    addSequence(doc);
    expect(stepProgress(doc)[4]).toBe(0);
  });
  it('seed RAV3 et étapes validées', () => {
    const doc = buildRav3();
    doc.intention = 'Un clip solaire.';
    doc.scenario = '';
    doc.validatedSteps = [10];
    const p = stepProgress(doc);
    expect(p[4]).toBe(100);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[2]).toBe(0);
    expect(p[7]).toBe(50);
    expect(p[10]).toBe(100);
  });
});
