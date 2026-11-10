import { describe, expect, it } from 'vitest';
import { diffItems, diffScripts } from './scriptDiff';
import { foldLabel, layoutDiff, movedLines, summaryLines, wrapRanges, wrapRuns } from './scriptDiffLayout';
import { SCRIPT_PAGE, wrapText } from './scriptLayout';

describe('coupure des lignes', () => {
  const samples = [
    'Léa traverse le hall en tirant une valise cabossée dont une roue grince à chaque pas, puis s’arrête net.',
    'Un mot-composé-très-long-qui-ne-tient-pas-sur-une-seule-ligne-de-la-colonne-de-dialogue sans espace.',
    'Deux paragraphes.\n\nAvec une ligne vide entre eux.   ',
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    '   Retrait de tête gardé, espaces    multiples au milieu.',
    '',
  ];
  it('mêmes coupures que wrapText (colonnes du modèle)', () => {
    for (const t of samples)
      for (const chars of [61, 35, 26])
        expect(wrapRanges(t, chars).map(([a, z]) => t.slice(a, z))).toEqual(wrapText(t, chars));
  });

  it('les morceaux gardent leur nature d’une ligne à l’autre', () => {
    const lines = wrapRuns(
      [
        { op: 'eq', text: 'Léa traverse le hall en tirant ' },
        { op: 'del', text: 'une valise ' },
        { op: 'add', text: 'sa vieille valise cabossée ' },
        { op: 'eq', text: 'jusqu’au bout du quai.' },
      ],
      35,
    );
    expect(lines.map((l) => l.map((r) => r.text).join(''))).toEqual(wrapText('Léa traverse le hall en tirant une valise sa vieille valise cabossée jusqu’au bout du quai.', 35));
    expect(lines.flat().filter((r) => r.op === 'add').map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim()).toBe('sa vieille valise cabossée');
  });
});

const V1 = 'INT. GARE - JOUR\n\nLéa attend.\n\nEXT. QUAI - NUIT\n\nUn train passe.\n\nINT. CAFÉ - JOUR\n\nMarc boit un café.\n\nINT. HÔTEL - NUIT\n\nLa chambre est vide, la fenêtre ouverte sur la ville.\n';
const V2 = 'INT. HÔTEL - NUIT\n\nLa chambre est vide, la fenêtre ouverte sur la ville.\n\nINT. GARE - JOUR\n\nLéa attend encore.\n\nEXT. QUAI - NUIT\n\nUn train passe.\n\nINT. CAFÉ - JOUR\n\nMarc boit un café.\n';

describe('pages de la comparaison', () => {
  it('en-tête, numéros dans la marge, mention de déplacement, lignes repliées', () => {
    const d = diffScripts(V1, V2);
    expect(d.scenes.map((s) => s.status)).toEqual(['moved', 'changed', 'same', 'same']);
    const pages = layoutDiff(d, diffItems(d, true), ['Comparaison : V2 avec V1', ...summaryLines(d.stats, 'V2', 'V1')]);
    expect(pages).toHaveLength(1);
    const lines = pages[0].lines;
    expect(lines[0]).toMatchObject({ kind: 'head', row: 0 });
    expect(lines.filter((l) => l.kind === 'head')).toHaveLength(5);
    const hotel = lines.find((l) => l.runs.some((r) => r.text.includes('HÔTEL')))!;
    expect(hotel).toMatchObject({ sceneNumber: '1', margin: movedLines(4) });
    // Deux lignes blanches après l'en-tête.
    expect(hotel.row).toBe(lines.filter((l) => l.kind === 'head').length + 2);
    expect(lines.find((l) => l.kind === 'fold')!.runs[0].text).toBe(foldLabel(3, 4, 2));
    // Le mot ajouté, dans sa ligne.
    expect(lines.some((l) => l.runs.some((r) => r.op === 'add' && r.text.trim() === 'encore'))).toBe(true);
  });

  it('un long texte va à la page suivante, rien ne dépasse 58 lignes', () => {
    const long = V1 + '\n' + Array.from({ length: 60 }, (_, k) => `INT. LIEU ${k} - JOUR\n\nUne action qui tient sur une ligne.`).join('\n\n');
    const d = diffScripts(V1, long);
    const pages = layoutDiff(d, diffItems(d, false), ['Comparaison']);
    expect(pages.length).toBeGreaterThan(2);
    for (const p of pages) for (const l of p.lines) expect(l.row).toBeLessThan(SCRIPT_PAGE.lines);
    // Un en-tête n'est jamais seul en bas de page.
    for (const p of pages) {
      const last = p.lines[p.lines.length - 1];
      expect(last.type === 'heading' && last.kind === 'text').toBe(false);
    }
  });

  it('un retrait et l’ajout qui le suit ne sont pas collés : « JOUR NUIT »', () => {
    const d = diffScripts('INT. GARE - JOUR\n\nLéa attend sous la verrière, un deux trois\n', 'INT. GARE - NUIT\n\nLéa attend sous la verrière, quatre cinq six\n');
    expect(d.scenes[0].blocks.map((b) => b.op)).toEqual(['mod', 'mod']);
    const pages = layoutDiff(d, diffItems(d, false), []);
    const texts = pages[0].lines.map((l) => l.runs.map((r) => r.text).join(''));
    expect(texts).toContain('INT. GARE - JOUR NUIT');
    expect(texts.some((t) => /trois quatre/.test(t))).toBe(true);
  });

  it('la mention d’une séquence déplacée tient en deux lignes courtes', () => {
    expect(movedLines(12)).toEqual(['déplacée', 'était 12']);
    // Alignée à droite sur le numéro (98 pt), elle reste à plus de 36 pt du bord.
    const smallCw = (1228 / 2048) * 8;
    for (const t of movedLines(128)) expect(SCRIPT_PAGE.sceneNumberRight - t.length * smallCw).toBeGreaterThan(36);
  });

  it('résumé chiffré', () => {
    const d = diffScripts(V1, V2);
    expect(summaryLines(d.stats, 'V2', 'V1')).toEqual([
      'Séquences : 1 modifiée, 1 déplacée',
      'Mots : 1 ajouté, 0 retiré',
      `Pages : 1 (V2), 1 (V1)`,
      `Durée : ${'0:'}${String(d.stats.after.seconds).padStart(2, '0')} (V2), 0:${String(d.stats.before.seconds).padStart(2, '0')} (V1)`,
    ]);
  });
});
