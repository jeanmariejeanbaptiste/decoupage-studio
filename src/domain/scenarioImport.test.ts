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
  it('page de garde de Fade In (FADE IN: juste après) ; l’ouverture reste au film', async () => {
    const { linesToFountain, textToLines } = await import('./scenarioImport');
    const src = linesToFountain(textToLines('VOX\n\nWritten by\n\nJean-Marie Jean-Baptiste\n\nFADE IN:\n\nINT. ENTREPRISE / SALLE D’ATTENTE - DAY\n\nFLORA s’arrête un instant.\n'));
    expect(src).toMatch(/^Title: VOX/);
    expect(src).toContain('Author: Jean-Marie Jean-Baptiste');
    expect(src).toMatch(/FADE IN:/);
  });
  it('première page d’un PDF avec le seul titre, centré', async () => {
    const { detectTitlePage } = await import('./scenarioImport');
    const r = detectTitlePage([
      { text: 'LA CONSIGNE', center: true, page: 1 },
      { text: 'INT. GARE - JOUR', page: 2 },
      { text: 'Léa arrive.', page: 2 },
    ]);
    expect(r?.title.Title).toBe('LA CONSIGNE');
    expect(r?.used).toBe(1);
  });
  it('un début de film sans en-tête (oubli) n’est pas une page de garde', async () => {
    const { detectTitlePage, textToLines } = await import('./scenarioImport');
    expect(detectTitlePage(textToLines('La pluie tombe sur la gare.\n\nLÉA\nTu es en retard.\n\nMARC\nJe sais.\n\nINT. GARE - JOUR\n\nIls entrent.\n'))).toBeNull();
    expect(detectTitlePage(textToLines('PARIS, 1942\n\nLa pluie tombe sur la gare.\n\nINT. GARE - JOUR\n\nIls entrent.\n'))).toBeNull();
  });
  it('page de garde dense mais typée : crédits, coordonnées, droits', async () => {
    const { detectTitlePage, textToLines } = await import('./scenarioImport');
    const r = detectTitlePage(textToLines('LES OMBRES DU QUAI\nUn film de Nina Roche\nD’après le roman de P. Lenoir\nScénario : Nina Roche et Paul Duval\nTroisième version — mars 2026\nProduction Les Films du Quai\n12 rue des Lilas, 75011 Paris\n© Tous droits réservés, dépôt SACD\n\nINT. QUAI - NUIT\n\nLe train arrive.\n'));
    expect(r?.title.Title).toBe('LES OMBRES DU QUAI');
    expect(r?.title.Source).toContain('roman');
  });
  it('page de garde restée dans le texte : reconnue dans les blocs avant la première séquence', async () => {
    const { titleFromBlocks } = await import('./scenarioImport');
    const blocks = [
      { id: 'a', type: 'action', text: 'VOX' },
      { id: 'b', type: 'action', text: 'Écrit par Jean-Marie Jean-Baptiste' },
      { id: 'c', type: 'transition', text: 'FADE IN:' },
      { id: 'd', type: 'heading', text: 'INT. ENTREPRISE - DAY' },
    ];
    expect(titleFromBlocks(blocks)).toEqual({ title: { Title: 'VOX', Credit: 'Écrit par', Author: 'Jean-Marie Jean-Baptiste' }, ids: ['a', 'b'] });
    expect(titleFromBlocks([{ id: 'd', type: 'heading', text: 'INT. GARE - JOUR' }])).toBeNull();
  });
  it('un scénario qui commence directement n’a pas de page de garde', async () => {
    const { linesToFountain, textToLines } = await import('./scenarioImport');
    expect(linesToFountain(textToLines('INT. GARE - JOUR\n\nLéa arrive.\n'))).not.toMatch(/^Title:/);
  });
});

describe('paragraphes trop longs pour une page', () => {
  it('coupés entre deux phrases ; répliques et en-têtes intacts', async () => {
    const { splitLongActions } = await import('./scenarioImport');
    const long = Array.from({ length: 120 }, (_, i) => `Phrase numéro ${i} du très long paragraphe.`).join(' ');
    const src = `INT. GARE - JOUR\n\n${long}\n\nLÉA\nCourt.\n`;
    const out = splitLongActions(src);
    const paras = out.split(/\n{2,}/);
    expect(paras.length).toBeGreaterThan(3);
    expect(paras.every((p) => p.length <= 2000)).toBe(true);
    expect(out.replace(/\s+/g, ' ')).toBe(src.replace(/\s+/g, ' '));
    expect(out).toContain('LÉA\nCourt.');
  });
});

describe('répliques trop longues', () => {
  it('suite marquée (SUITE), sans perdre un mot ; mots sans ponctuation coupés aussi', async () => {
    const { splitLongActions } = await import('./scenarioImport');
    const words = Array.from({ length: 700 }, (_, i) => `mot${i}`).join(' ');
    const out = splitLongActions(`MARC\n${words}\n\n${words}\n`);
    expect(out).toContain('MARC (SUITE)');
    expect(out.split(/\n{2,}/).every((p) => p.length <= 2000)).toBe(true);
    expect(out.replace(/MARC \(SUITE\)/g, '').replace(/MARC/, '').replace(/\s+/g, ' ').trim()).toBe(`${words} ${words}`);
  });
});
