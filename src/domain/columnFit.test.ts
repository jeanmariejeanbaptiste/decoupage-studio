import { describe, expect, it } from 'vitest';
import { nudgeWidths, wordDeficit } from './columnFit';

const prefix = (n: number, w = 10) => Array.from({ length: n }, (_, i) => (i + 1) * w);

describe('ajustement léger des colonnes', () => {
  it('ne compte que les mots qui débordent d’une ou deux lettres', () => {
    expect(wordDeficit(prefix(10), 100)).toBe(0); // tient
    expect(wordDeficit(prefix(10), 90)).toBe(10); // « Secrétair / e »
    expect(wordDeficit(prefix(10), 80)).toBe(20); // deux lettres
    expect(wordDeficit(prefix(10), 70)).toBe(0); // trois lettres : on laisse le retour à la ligne
  });
  it('prend la place aux colonnes qui en ont de reste, sans dépasser leur marge', () => {
    const w = nudgeWidths([
      { key: 'subject', width: 80, deficit: 10, slack: 0 },
      { key: 'angle', width: 150, deficit: 0, slack: 30 },
      { key: 'action', width: 200, deficit: 0, slack: 0 },
    ]);
    expect(w).toEqual({ subject: 90, angle: 140, action: 200 });
  });
  it('ne touche à rien quand la marge ne suffit pas', () => {
    const w = nudgeWidths([
      { key: 'subject', width: 80, deficit: 20, slack: 0 },
      { key: 'angle', width: 150, deficit: 0, slack: 5 },
    ]);
    expect(w).toEqual({ subject: 80, angle: 150 });
  });
});
