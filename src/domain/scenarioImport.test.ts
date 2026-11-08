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

describe('page de garde à l’import', () => {
  it('titre, crédit et auteur, date, coordonnées reconnus avant la première séquence', async () => {
    const { linesToFountain, textToLines } = await import('./scenarioImport');
    const { blocksFromSource, parseTitlePage } = await import('./screenplay');
    const txt = `LUNDI\n\nÉcrit par Jean-Marie Jean-Baptiste\n\nD'après une idée de la Mission Locale\n\nVersion du 12/10/2026\n\njm@exemple.fr\n06 12 34 56 78\n\nINT. OPEN SPACE - JOUR\n\nFlora entre.\n`;
    const src = linesToFountain(textToLines(txt));
    const tb = blocksFromSource(src).blocks.find((b) => b.type === 'title');
    expect(tb).toBeDefined();
    expect(parseTitlePage(tb!.text)).toMatchObject({ Title: 'LUNDI', Credit: 'Écrit par', Author: 'Jean-Marie Jean-Baptiste', 'Draft date': 'Version du 12/10/2026' });
    expect(parseTitlePage(tb!.text).Contact).toContain('jm@exemple.fr');
    expect(src).toContain('INT. OPEN SPACE - JOUR');
  });
  it('un scénario qui commence directement n’a pas de page de garde', async () => {
    const { linesToFountain, textToLines } = await import('./scenarioImport');
    expect(linesToFountain(textToLines('INT. GARE - JOUR\n\nLéa arrive.\n'))).not.toMatch(/^Title:/);
  });
});
