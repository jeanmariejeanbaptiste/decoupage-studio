import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectDoc } from '../../domain/factory';
import { insertEntry, insertPart, setOutlineTag } from '../../domain/outline';
import type { ProjectDoc } from '../../domain/types';
import { outlineDocx, outlineFileBase, outlinePdf } from './outlineExport';

const FONTS = resolve(__dirname, '../../assets/fonts/inter');

/** Le Blob de jsdom n'a pas arrayBuffer() : lecture par FileReader. */
const bytesOf = (b: Blob) =>
  new Promise<Uint8Array>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => ko(r.error);
    r.readAsArrayBuffer(b);
  });

function film(): ProjectDoc {
  const doc = createProjectDoc({ title: 'La Consigne', format: 'fiction' });
  let src = '';
  const places = ['GARE — CONSIGNE', 'APPARTEMENT DE LÉA', 'RUE DE LA GARE', 'QUAI NUMÉRO 3', 'CAFÉ DU NORD'];
  for (let i = 1; i <= 24; i++)
    src = insertEntry(src, 'end', {
      intExt: i % 3 ? 'INT.' : 'EXT.',
      location: places[i % places.length],
      effect: i % 2 ? 'JOUR' : 'NUIT',
      phrase: i % 5 === 0 ? '' : `Léa ${['ouvre le casier et trouve la lettre', 'relit la lettre à voix basse, sans comprendre qui a pu l’écrire ni pourquoi elle lui revient aujourd’hui', 'attend le train de 7 h 12', 'interroge le gardien'][i % 4]}.`,
    }).source;
  src = insertPart(src, 1, 'Acte I').source;
  src = insertPart(src, 9, 'Acte II').source;
  for (const n of [3, 7, 12, 19]) src = setOutlineTag(src, n, { step: n === 19 ? 19 : 9, plot: n % 2 ? 'B' : 'A' }).source;
  doc.scenario = src;
  doc.plots = [
    { key: 'A', name: 'Intrigue principale' },
    { key: 'B', name: 'La lettre' },
  ];
  doc.research = { logline: 'Une femme dépose une valise et ne revient jamais la chercher.' };
  return doc;
}

describe('exports du séquencier', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      const name = /Inter-(Regular|Medium|SemiBold)/.exec(String(url))?.[0];
      return name ? new Response(readFileSync(resolve(FONTS, `${name}.ttf`))) : new Response(null, { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('nomme le fichier d’après le titre', () => {
    expect(outlineFileBase({ project: { title: 'L’Été à Noël' } } as ProjectDoc)).toBe('l-ete-a-noel-sequencier');
    expect(outlineFileBase({ project: { title: '' } } as ProjectDoc)).toBe('projet-sequencier');
  });

  it('PDF : pages A4, titre et métadonnées', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = film();
    for (const order of ['list', 'plots'] as const) {
      const bytes = await bytesOf(await outlinePdf(doc, { order }));
      if (process.env.OUTLINE_PDF_OUT) writeFileSync(`${process.env.OUTLINE_PDF_OUT}-${order}.pdf`, bytes);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
      expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
      expect(pdf.getTitle()).toBe('La Consigne — Séquencier');
    }
  });

  it('Word : paquet complet, phrases et intrigues, pied de page', async () => {
    const { default: JSZip } = await import('jszip');
    if (process.env.OUTLINE_PDF_OUT) writeFileSync(`${process.env.OUTLINE_PDF_OUT}-list.docx`, await bytesOf(await outlineDocx(film(), { order: 'list' })));
    const zip = await JSZip.loadAsync(await bytesOf(await outlineDocx(film(), { order: 'plots', plots: ['B'] })));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('La Consigne');
    expect(xml).toContain('La lettre');
    expect(xml).not.toContain('Intrigue principale');
    expect(xml).toContain('interroge le gardien');
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain('NUMPAGES');
    expect(zip.file('word/fonts/font2.odttf')).toBeTruthy();
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('/word/footer1.xml');
  });
});
