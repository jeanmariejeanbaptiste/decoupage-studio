import { describe, expect, it } from 'vitest';
import { backdropFor, blurFraction, buildThumbScene, isPersonSubject, objectFor, type ThumbInput } from './thumbnail';
import { formatAperture, parseAperture } from './focal';

const base: ThumbInput = { value: 'Moyen', angle: ['Face'], movement: [], focal: 35, crop: 1, ratio: 16 / 9, subject: 'Léa', person: true, backdrop: 'interior', seed: 's1' };

describe('vignettes provisoires du storyboard', () => {
  it('place la caméra selon la valeur et la focale : plus serré ou plus large angle = plus près', () => {
    const moyen = buildThumbScene(base).distanceCm;
    expect(buildThumbScene({ ...base, value: 'Gros plan' }).distanceCm).toBeLessThan(moyen / 4);
    expect(buildThumbScene({ ...base, focal: 16 }).distanceCm).toBeLessThan(moyen);
    expect(buildThumbScene({ ...base, focal: 16 }).fovH).toBeGreaterThan(buildThumbScene(base).fovH);
  });
  it('dessine le visage en détail en très gros plan, un objet pour un insert', () => {
    const tgp = buildThumbScene({ ...base, value: 'Très gros plan' });
    expect(tgp.subject.some((p) => p.cls === 'lash')).toBe(true);
    expect(tgp.subject.some((p) => p.cls === 'iris')).toBe(true);
    const ins = buildThumbScene({ ...base, value: 'Insert', subject: 'Main de Léa', person: false });
    expect(ins.object?.kind).toBe('hand');
    expect(ins.subject).toEqual([]);
  });
  it('ne montre pas le visage de dos', () => {
    const dos = buildThumbScene({ ...base, value: 'Gros plan', angle: ['Dos'] });
    expect(dos.subject.some((p) => p.cls === 'eyeWhite' || p.cls === 'feature')).toBe(false);
  });
  it('floute l’arrière-plan selon l’ouverture, seulement si elle est donnée', () => {
    expect(buildThumbScene({ ...base, value: 'Gros plan', focal: 85 }).blur).toBe(0);
    const f14 = buildThumbScene({ ...base, value: 'Taille', focal: 50, aperture: 1.4 }).blur;
    const f8 = buildThumbScene({ ...base, value: 'Taille', focal: 50, aperture: 8 }).blur;
    expect(f8).toBeGreaterThan(0);
    expect(f14).toBeGreaterThan(f8);
    // Même focale, capteur plus petit : le cercle de flou pèse plus dans l'image.
    expect(blurFraction(50, 2, 200, 1000, 2)).toBeCloseTo(2 * blurFraction(50, 2, 200, 1000, 1), 6);
  });
  it('traduit le mouvement en flou de bougé et le roulis en image penchée', () => {
    expect(buildThumbScene({ ...base, movement: ['Pano gauche'] }).motion).toEqual({ kind: 'h', dir: -1 });
    expect(buildThumbScene({ ...base, movement: ['Travelling avant'] }).motion?.kind).toBe('radial');
    expect(buildThumbScene({ ...base, movement: ['Roll'] }).roll).not.toBe(0);
    expect(buildThumbScene(base).motion).toBeUndefined();
  });
  it('distingue personnage et objet, intérieur, rue et nature', () => {
    expect(isPersonSubject('Candice', [])).toBe(true);
    expect(isPersonSubject('Affiche', [])).toBe(false);
    expect(isPersonSubject('Main candice', ['Candice'])).toBe(false);
    expect(isPersonSubject('la vedette', [])).toBe(false);
    expect(isPersonSubject('la vedette', ['vedette'])).toBe(true);
    expect(objectFor('une tasse de café', 'x')).toBe('mug');
    expect(backdropFor('INT', 'rue')).toBe('interior');
    expect(backdropFor('EXT', 'Rue des Lilas')).toBe('street');
    expect(backdropFor('EXT', 'Parc des coquelicots')).toBe('nature');
  });
  it('lit et écrit l’ouverture', () => {
    expect(parseAperture('f/2,8')).toBe(2.8);
    expect(parseAperture('T2.1')).toBe(2.1);
    expect(parseAperture('abc')).toBeUndefined();
    expect(formatAperture(2.8)).toBe('f/2,8');
  });
});
