import { describe, expect, it } from 'vitest';
import { backdropFor, iconSpec, isPersonSubject, objectFor, type IconInput } from './thumbnail';
import { formatAperture, parseAperture } from './focal';

const base: IconInput = { value: 'Moyen', angle: ['Face'], movement: [], focal: 35, subject: 'Léa', person: true, backdrop: 'interior', seed: 's1' };

describe('icônes provisoires du storyboard', () => {
  it('combine valeur, axe, hauteur, mouvement et focale', () => {
    const s = iconSpec({ ...base, value: 'Gros plan', angle: ['Profil gauche', 'Plongée'], movement: ['Pano droite'], focal: 16 });
    expect(s).toMatchObject({ valueKey: 'gros_plan', axis: 'profil', side: -1, height: 'high', move: 'right' });
    expect(s.wide).toBeGreaterThan(iconSpec({ ...base, focal: 135 }).wide);
    expect(iconSpec({ ...base, movement: ['Travelling avant', 'Roll'] })).toMatchObject({ move: 'in', roll: true });
  });
  it('estompe le fond selon l’ouverture, seulement si elle est donnée', () => {
    expect(iconSpec({ ...base, value: 'Gros plan', focal: 85 }).soft).toBe(0);
    expect(iconSpec({ ...base, value: 'Gros plan', focal: 85, aperture: 1.4 }).soft).toBeGreaterThan(iconSpec({ ...base, value: 'Gros plan', focal: 85, aperture: 8 }).soft);
  });
  it('dessine un objet pour un insert ou un sujet non humain', () => {
    expect(iconSpec({ ...base, value: 'Insert', subject: 'Main de Léa', person: false }).object).toBe('hand');
    expect(iconSpec(base).object).toBeUndefined();
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
