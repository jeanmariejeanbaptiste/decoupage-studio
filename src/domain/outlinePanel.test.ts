import { describe, expect, it } from 'vitest';
import { findSequence, panelRows } from './outlinePanel';

const SRC = ['Title: Essai', '', '# Acte I', '', 'int. gare - jour', '', '= Léa arrive. [[ds:etape=4]]', '', 'Léa entre.', '', 'EXT. QUAI - NUIT', '', 'Le train part.', '', 'INT. GARE - JOUR', '', 'Elle revient.', ''].join('\n');

describe('panneau Séquences', () => {
  it('liste parties et séquences, en capitales, avec phrase et page', () => {
    const rows = panelRows(SRC, (n) => n + 10);
    expect(rows.map((r) => (r.kind === 'part' ? `# ${r.title}` : `${r.n} ${r.heading} | ${r.phrase} | ${r.page} | ${r.rank}`))).toEqual([
      '# Acte I',
      '1 INT. GARE - JOUR | Léa arrive. | 11 | 0',
      '2 EXT. QUAI - NUIT |  | 12 | 0',
      '3 INT. GARE - JOUR |  | 13 | 1',
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('rien avant le premier en-tête, aucune ligne sans texte', () => {
    expect(panelRows('')).toEqual([]);
    expect(panelRows('Title: Seul\n\nUne ouverture.\n')).toEqual([]);
  });

  it('retrouve la séquence après un changement du texte', () => {
    expect(findSequence(SRC, 3, 'INT. GARE - JOUR')).toBe(3);
    const shifted = 'EXT. RUE - JOUR\n\nAvant.\n\n' + SRC;
    expect(findSequence(shifted, 3, 'INT. GARE - JOUR', 1)).toBe(4);
    expect(findSequence(shifted, 1, 'INT. GARE - JOUR', 0)).toBe(2);
    expect(findSequence(shifted, 6, 'INT. GARE - JOUR')).toBe(4);
    expect(findSequence(SRC, 2, 'EXT. PLAGE - JOUR')).toBeUndefined();
  });
});
