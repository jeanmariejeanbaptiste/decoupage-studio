import { describe, expect, it } from 'vitest';
import {
  ANGLES,
  angleKind,
  hasAngleConflict,
  isZoom,
  matchVocab,
  MOVEMENTS,
  SHOT_VALUES,
  suggest,
  valueLabel,
  valueRank,
  vocabularyFor,
} from './vocabulary';

describe('vocabulaire', () => {
  it('ordonne les valeurs du plus large au plus serré', () => {
    expect(SHOT_VALUES.map((v) => v.abbr)).toEqual(['PG', 'PE', 'PM', 'PI', 'PA', 'PT', 'PRP', 'GP', 'TGP', 'INS']);
    expect(valueRank('Plan général')).toBe(0);
    expect(valueRank('insert')).toBe(9);
    expect(valueRank('truc')).toBe(-1);
  });
  it('suggère par préfixe puis sous-chaîne, sans accents ni casse', () => {
    expect(suggest('rap', SHOT_VALUES)[0].key).toBe('rapproche');
    expect(suggest('GP', SHOT_VALUES).map((v) => v.key)).toContain('gros_plan');
    expect(suggest('ensemble', SHOT_VALUES).map((v) => v.key)).toEqual(['ensemble', 'general']);
    expect(suggest('plongee', ANGLES)[0].key).toBe('plongee');
    expect(suggest('tilt haut', MOVEMENTS)[0].key).toBe('tilt_up');
    expect(suggest('traveling', MOVEMENTS).length).toBeGreaterThan(3);
    expect(suggest('', SHOT_VALUES, 3)).toHaveLength(3);
    expect(suggest('zzz', SHOT_VALUES)).toEqual([]);
  });
  it('rattache un jeton libre à une entrée', () => {
    expect(matchVocab('Traveling arrière', MOVEMENTS)?.key).toBe('trav_arriere');
    expect(matchVocab('Trav. avant', MOVEMENTS)?.key).toBe('trav_avant');
    expect(matchVocab('Plongé', ANGLES)?.key).toBe('plongee');
    expect(matchVocab('contre plongée', ANGLES)?.key).toBe('contre_plongee');
    expect(matchVocab('Pano', MOVEMENTS)?.key).toBe('pano');
    expect(matchVocab('', MOVEMENTS)).toBeUndefined();
  });
  it('classe axes et hauteurs, et détecte les conflits', () => {
    expect(angleKind('3/4 Face')).toBe('axis');
    expect(angleKind('Hauteur regard')).toBe('height');
    expect(angleKind('POV')).toBe('pov');
    expect(angleKind('bizarre')).toBeUndefined();
    expect(hasAngleConflict(['Face', 'Hauteur regard'])).toBe(false);
    expect(hasAngleConflict(['Face', 'Dos'])).toBe(true);
    expect(hasAngleConflict(['Plongée', 'Contre-plongée'])).toBe(true);
  });
  it('libellé long ou court', () => {
    expect(valueLabel('Taille', 'long')).toBe('Plan taille');
    expect(valueLabel('Taille', 'court')).toBe('Taille');
    expect(valueLabel('inconnu', 'long')).toBe('inconnu');
  });
  it('détecte le zoom et fusionne le vocabulaire personnalisé', () => {
    expect(isZoom(['Trav avant', 'zoom avant'])).toBe(true);
    expect(isZoom(['Fixe'])).toBe(false);
    const custom = { value: [], angle: [], movement: [{ key: 'x', short: 'Dolly zoom', long: 'Vertigo', aliases: ['vertigo'] }] };
    expect(vocabularyFor('movement', custom).at(-1)?.short).toBe('Dolly zoom');
    expect(vocabularyFor('value')).toHaveLength(SHOT_VALUES.length);
    expect(vocabularyFor('angle')).toHaveLength(ANGLES.length);
  });
});
