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
  it('lien de relecture : le fichier (et sa clé) dans le chemin', () => {
    const l = parseHash('#/review/1AbC-def_9~0-KeY');
    expect(l.route).toBe('review');
    expect(l.params.get('file')).toBe('1AbC-def_9~0-KeY');
    expect(parseHash('#/grid/x').route).toBe('home');
  });
});
