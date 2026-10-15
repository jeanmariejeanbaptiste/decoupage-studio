import { describe, expect, it } from 'vitest';
import { linesToFountain, stripMarkdown, textToLines } from './scenarioImport';
import { scenesOf, parseFountain } from './fountain';

describe('import de scénarios mis en page', () => {
  it('PDF : répliques centrées, nom au-dessus, actions sur plusieurs lignes', () => {
    const L = (text: string, x0: number, extra: object = {}) => ({ text, x0, ...extra });
    const f = linesToFountain([
      L('1.', 0.9),
      L('1. INT. CUISINE - NUIT 1', 0.12, { gapBefore: true }),
      L('Léa entre, trempée. Elle pose', 0.12, { gapBefore: true }),
      L('son sac sur la table.', 0.12),
      L('LÉA', 0.42, { gapBefore: true, center: true }),
      L('(essoufflée)', 0.32),
      L('Il pleut des cordes.', 0.28),
      L('Tu as vu ça ?', 0.28),
      L('MARC (O.S.)', 0.42, { gapBefore: true, center: true }),
      L('Oui.', 0.28),
      L('CUT TO:', 0.7, { gapBefore: true }),
      L('EXT. RUE - JOUR', 0.12, { gapBefore: true }),
      L('Le soleil revient.', 0.12, { gapBefore: true }),
    ]);
    const els = parseFountain(f);
    expect(els.filter((e) => e.type === 'heading').map((e) => e.text)).toEqual(['INT. CUISINE - NUIT', 'EXT. RUE - JOUR']);
    expect(els.filter((e) => e.type === 'character').map((e) => e.text)).toEqual(['LÉA', 'MARC (O.S.)']);
    expect(els.find((e) => e.type === 'parenthetical')?.text).toBe('(essoufflée)');
    expect(els.find((e) => e.type === 'dialogue')?.text).toBe('Il pleut des cordes. Tu as vu ça ?');
    expect(els.find((e) => e.type === 'action')?.text).toBe('Léa entre, trempée. Elle pose son sac sur la table.');
    expect(els.find((e) => e.type === 'transition')?.text).toBe('CUT TO:');
    expect(scenesOf(f)[0].speakers).toEqual(['LÉA', 'MARC']);
  });

  it('texte et Markdown sans mise en page', () => {
    const md = '# INT. SALON - JOUR\n\n**Nina** range.\n\nNINA\nOù sont les clés ?\n\n## EXT. JARDIN - SOIR\n\nSilence.\n';
    const f = linesToFountain(textToLines(stripMarkdown(md)));
    const scenes = scenesOf(f);
    expect(scenes.map((s) => s.location)).toEqual(['SALON', 'JARDIN']);
    expect(scenes[0].speakers).toEqual(['NINA']);
    expect(parseFountain(f).find((e) => e.type === 'action')?.text).toBe('Nina range.');
  });
});
