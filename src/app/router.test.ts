import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('reconnaît une route et ses paramètres', () => {
    const l = parseHash('#/grid?seq=abc');
    expect(l.route).toBe('grid');
    expect(l.params.get('seq')).toBe('abc');
  });
  it('retombe sur l’accueil pour une route inconnue', () => {
    expect(parseHash('#/nimporte').route).toBe('home');
    expect(parseHash('').route).toBe('home');
  });
});
