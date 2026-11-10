import { describe, expect, it } from 'vitest';
import { readReportPrefs, reportPrintHtml } from './BreakdownReports';

describe('rapports du dépouillement', () => {
  it('page imprimable : titre échappé, filtre nommé, réglages masqués', () => {
    const html = reportPrintHtml('A & <B>', 'Éléments', 'Machinerie', '<div data-print-hide=""><label><span>Catégorie</span></label></div><table></table>');
    expect(html).toContain('<h1>A &amp; &lt;B&gt; — Dépouillement, éléments — Machinerie</h1>');
    expect(html).toContain('[data-print-hide]{display:none}');
    expect(reportPrintHtml('Film', 'Séquences', undefined, '')).toContain('<h1>Film — Dépouillement, séquences</h1>');
  });

  it('retient rapport, catégorie et tri ; une valeur inconnue revient au défaut', () => {
    const cats = ['accessoires', 'machinerie'];
    expect(readReportPrefs(JSON.stringify({ report: 'sequences', cat: 'machinerie', sort: 'often' }), cats)).toEqual({ report: 'sequences', cat: 'machinerie', sort: 'often' });
    expect(readReportPrefs(JSON.stringify({ report: 'x', cat: 'perso:Animaux', sort: 'y' }), cats)).toEqual({ report: 'items', cat: '', sort: 'film' });
    expect(readReportPrefs('{pas du json', cats)).toEqual({ report: 'items', cat: '', sort: 'film' });
    expect(readReportPrefs(null, cats)).toEqual({ report: 'items', cat: '', sort: 'film' });
    expect(readReportPrefs('null', cats)).toEqual({ report: 'items', cat: '', sort: 'film' });
  });
});
