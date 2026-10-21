import { describe, expect, it } from 'vitest';
import { aspectRatio, formatAspect, parseAspect } from './aspect';

describe('format d’image du storyboard', () => {
  it('lit les écritures usuelles et calcule le rapport', () => {
    expect(parseAspect('2.39:1')).toEqual({ w: 2.39, h: 1 });
    expect(parseAspect('16/9')).toEqual({ w: 16, h: 9 });
    expect(parseAspect('1,85')).toEqual({ w: 1.85, h: 1 });
    expect(parseAspect('4 x 3')).toEqual({ w: 4, h: 3 });
    expect(parseAspect('abc')).toBeNull();
    expect(aspectRatio({ w: 9, h: 16 })).toBeCloseTo(0.5625);
    expect(aspectRatio(undefined)).toBeCloseTo(16 / 9);
    expect(formatAspect({ w: 2.39, h: 1 })).toBe('2.39:1');
  });
});
