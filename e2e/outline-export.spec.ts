import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

test('séquencier : PDF et Word depuis la page Exporter', async ({ page }) => {
  await page.goto('/#/export?seed=fiction');

  const pdfDl = page.waitForEvent('download');
  await page.getByTestId('export-outline-pdf').click();
  const pdfFile = await pdfDl;
  expect(pdfFile.suggestedFilename()).toBe('la-consigne-sequencier.pdf');
  const pdf = await PDFDocument.load(readFileSync(await pdfFile.path()));
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(pdf.getTitle()).toBe('La Consigne — Séquencier');

  const docxDl = page.waitForEvent('download');
  await page.getByTestId('export-outline-docx').click();
  const docxFile = await docxDl;
  expect(docxFile.suggestedFilename()).toBe('la-consigne-sequencier.docx');
  const zip = await JSZip.loadAsync(readFileSync(await docxFile.path()));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('La Consigne');
  expect(xml).toMatch(/w:pStyle w:val="Entree"/);
});
