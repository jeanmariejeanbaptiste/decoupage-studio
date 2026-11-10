import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildRav3 } from '../../seed/rav3';
import { addKeyframe, downscaleSize, framesOf, imageCount, removeFrame, setFrame } from './keyframes';

describe('keyframes d’un plan', () => {
  it('ajoute, renseigne et retire des keyframes sans dupliquer le plan', () => {
    const doc = buildRav3();
    const id = doc.sequences[doc.project.sequenceIds[0]].shotIds[0];
    const next = produce(doc, (d) => {
      setFrame(d, id, 0, { blobKey: 'a' });
      addKeyframe(d, id);
      setFrame(d, id, 1, { blobKey: 'b', note: 'fin du travelling' });
    });
    expect(framesOf(next.shots[id]).map((f) => f.blobKey)).toEqual(['a', 'b']);
    expect(imageCount(next.shots[id])).toBe(2);
    const promoted = produce(next, (d) => removeFrame(d, id, 0));
    expect(promoted.shots[id].storyboard).toMatchObject({ blobKey: 'b', note: 'fin du travelling' });
    expect(promoted.shots[id].keyframes).toBeUndefined();
    expect(next.project.sequenceIds.flatMap((s) => next.sequences[s].shotIds)).toHaveLength(doc.project.sequenceIds.flatMap((s) => doc.sequences[s].shotIds).length);
  });
});

describe('réduction des images importées', () => {
  it('ramène le plus grand côté à 2400 px en gardant les proportions', () => {
    expect(downscaleSize(6000, 4000)).toEqual({ width: 2400, height: 1600 });
    expect(downscaleSize(3000, 6000)).toEqual({ width: 1200, height: 2400 });
  });
  it('laisse les images qui tiennent déjà, et les tailles inconnues', () => {
    expect(downscaleSize(2400, 1000)).toBeNull();
    expect(downscaleSize(800, 600)).toBeNull();
    expect(downscaleSize(0, 0)).toBeNull();
    expect(downscaleSize(NaN, 10)).toBeNull();
  });
});
