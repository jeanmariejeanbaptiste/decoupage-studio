import { describe, expect, it } from 'vitest';
import { canon, capitalizeFirst, countWords, fold, mergeKey } from './text';
import { addToken, parseTokens, removeTokenAt, renderTokens, tokensKey } from './tokens';

describe('texte', () => {
  it('fold retire accents, casse et espaces superflus', () => {
    expect(fold('  Plongée   Totale ')).toBe('plongee totale');
  });
  it('canon unifie traveling / travelling / trav.', () => {
    expect(canon('Traveling arrière')).toBe('trav arriere');
    expect(canon('Travelling avant')).toBe('trav avant');
    expect(canon('Trav. avant')).toBe('trav avant');
    expect(canon('Contre-plongée')).toBe('contre plongee');
  });
  it('mergeKey ignore casse et espaces', () => {
    expect(mergeKey(' Face,  Hauteur regard')).toBe(mergeKey('face, hauteur regard'));
  });
  it('capitalizeFirst ne touche pas un début non alphabétique', () => {
    expect(capitalizeFirst('3/4 Face')).toBe('3/4 Face');
    expect(capitalizeFirst('tilt haut')).toBe('Tilt haut');
    expect(capitalizeFirst('')).toBe('');
  });
  it('countWords compte les mots porteurs de sens', () => {
    expect(countWords('Elle prend l’affiche — vite !')).toBe(4);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('jetons', () => {
  it('découpe par virgule et mémorise le séparateur', () => {
    expect(parseTokens('Tilt haut, trav avant')).toEqual({ tokens: ['Tilt haut', 'trav avant'], sep: ', ' });
    expect(parseTokens('Trav circulaire + suivi')).toEqual({ tokens: ['Trav circulaire', 'suivi'], sep: ' + ' });
    expect(parseTokens(' , ').tokens).toEqual([]);
  });
  it('rend les jetons avec majuscule initiale et le séparateur saisi', () => {
    expect(renderTokens(['3/4 Face', 'Hauteur regard'])).toBe('3/4 Face, Hauteur regard');
    expect(renderTokens(['trav circulaire', 'suivi'], ' + ')).toBe('Trav circulaire + suivi');
    expect(renderTokens(['-'])).toBe('-');
    expect(renderTokens([])).toBe('');
  });
  it('compare les tableaux de jetons en ordre', () => {
    expect(tokensKey(['Face', 'Hauteur regard'])).toBe(tokensKey(['face', 'hauteur  regard']));
    expect(tokensKey(['Face', 'Hauteur regard'])).not.toBe(tokensKey(['Hauteur regard', 'Face']));
  });
  it('ajoute sans doublon et retire par index', () => {
    expect(addToken(['Face'], ' face ')).toEqual(['Face']);
    expect(addToken(['Face'], 'Plongée')).toEqual(['Face', 'Plongée']);
    expect(addToken(['Face'], '  ')).toEqual(['Face']);
    expect(removeTokenAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
});
