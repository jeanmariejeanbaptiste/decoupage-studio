import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { checkInvariants } from './ops';
import { applyTemplate, templatesFor, TEMPLATES } from './templates';
import { matchVocab, SHOT_VALUES, ANGLES, MOVEMENTS } from './vocabulary';

describe('modèles de séquence', () => {
  it('n’utilisent que le vocabulaire du §5', () => {
    for (const t of TEMPLATES)
      for (const s of t.shots) {
        expect(matchVocab(s.value, SHOT_VALUES), `${t.key} ${s.value}`).toBeDefined();
        for (const a of s.angle) expect(matchVocab(a, ANGLES), `${t.key} ${a}`).toBeDefined();
        for (const m of s.movement) expect(matchVocab(m, MOVEMENTS), `${t.key} ${m}`).toBeDefined();
      }
  });

  it('insèrent une séquence documentaire structurée', () => {
    const doc = produce(createProjectDoc({ title: 'doc', format: 'documentaire' }), (d) => {
      applyTemplate(d, 'documentaire');
      applyTemplate(d, 'inconnu');
    });
    const seq = doc.sequences[doc.project.sequenceIds[0]];
    expect(seq.label).toBe('SÉQUENCE DOCUMENTAIRE');
    expect(seq.shotIds).toHaveLength(12);
    expect(seq.actionBlockIds).toHaveLength(7);
    expect(doc.shots[seq.shotIds[0]].value).toBe('Général');
    expect(doc.shots[seq.shotIds[11]].value).toBe('Général');
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('couverture performance en TOUT pour un clip', () => {
    const doc = produce(createProjectDoc({ title: 'clip', format: 'clip' }), (d) => {
      applyTemplate(d, 'clip-narratif');
      applyTemplate(d, 'clip-performance', 0);
    });
    const perf = doc.sequences[doc.project.sequenceIds[0]];
    expect(perf.label).toBe('PERFORMANCE');
    expect(perf.actionBlockIds).toHaveLength(1);
    expect(doc.blocks[perf.actionBlockIds[0]].tc).toEqual({ all: true });
    expect(checkInvariants(doc)).toEqual([]);
  });

  it('propose d’abord les modèles du format', () => {
    expect(templatesFor('institutionnel')[0].key).toBe('interview');
    expect(templatesFor('clip')[0].formats).toContain('clip');
  });
});
