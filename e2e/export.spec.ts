import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('capture de l’export RAV3 (thème Mauve, A4 paysage)', async ({ page }) => {
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.goto('/#/print?seed=rav3');
  const sheet = page.getByTestId('print-sheet');
  await expect(sheet.locator('tbody')).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  // Structure fusionnée : SÉQUENCE sur toute la hauteur, ACTION par bloc, TC par valeur.
  const first = sheet.locator('tbody').first();
  await expect(first.locator('td[rowspan="6"]').first()).toHaveText('1, CHAMBRE ADMIRATRICE');
  await expect(first.locator('td[rowspan="3"]').filter({ hasText: 'Admiratrice assise' })).toHaveCount(1);
  await expect(sheet.locator('thead th')).toHaveText(['SÉQUENCE', 'N°', 'Sujet', 'Valeur', 'Angle', 'Mouvement de caméra', 'Focale', 'Action', 'TC MIN']);
  const bg = await sheet.locator('div').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(201, 139, 180)');
  await page.emulateMedia({ media: 'print' });
  await sheet.screenshot({ path: 'test-results/export-rav3.png' });
  await page.emulateMedia({ media: 'screen' });
  // PDF : séquences non coupées, en-tête répété.
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, path: 'test-results/export-rav3.pdf' });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
});

test('exports Excel, CSV et JSON téléchargeables', async ({ page }) => {
  await page.goto('/#/export?seed=rav3');
  for (const [id, ext] of [
    ['export-xlsx', '.xlsx'],
    ['export-csv', '.csv'],
    ['export-json', '.json'],
  ]) {
    const dl = page.waitForEvent('download');
    await page.getByTestId(id).click();
    const d = await dl;
    expect(d.suggestedFilename()).toBe(`rav3-v3${ext}`);
    const content = readFileSync(await d.path());
    expect(content.byteLength).toBeGreaterThan(1000);
  }
});

test('import CSV avec correspondance des colonnes', async ({ page }) => {
  await page.goto('/#/export?seed=fiction');
  const csv = 'Séquence;Sujet;Valeur;Action\nCUISINE;Léa;Taille;Elle entre.\nCUISINE;Léa;Gros plan;Elle entre.\nJARDIN;Marc;Moyen;Il attend.\n';
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-csv').click();
  await (await chooser).setFiles({ name: 'plans.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('csv-import')).toBeVisible();
  await expect(page.getByLabel('Colonne 3')).toHaveValue('value');
  await page.getByTestId('csv-new').click();
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(3);
  await expect(page.locator('[data-cell="0:action"]')).toContainText('lié · 2 plans');
  await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
});

test('dossier de production complet (.zip)', async ({ page }) => {
  await page.goto('/#/export?seed=fiction');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-zip').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('la-consigne-v1-dossier-de-production.zip');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync(await d.path()));
  const names = Object.keys(zip.files).join('\n');
  for (const part of ['00 Projet/la-consigne-v1.decoupage', '02 Scénario/Scénario.fountain', '04 Découpage/Découpage technique.xlsx', '10 Registre/Plans.csv', 'LISEZ-MOI.txt'])
    expect(names).toContain(part);
});

test('économie d’encre : aucun aplat de couleur', async ({ page }) => {
  await page.goto('/#/print?seed=rav3');
  await page.getByTestId('ink-saver').check();
  const sheet = page.getByTestId('print-sheet').locator('div').first();
  expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await page.locator('thead th').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('tbody td').nth(3).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(122, 46, 31)');
});

test('exports individuels par onglet', async ({ page }) => {
  await page.goto('/#/registry?seed=rav3&tab=characters');
  const dl = page.waitForEvent('download');
  await page.getByTestId('tab-export-file').click();
  expect((await dl).suggestedFilename()).toBe('RAV3-characters.csv');
  await page.goto('/#/floorplan');
  const dl2 = page.waitForEvent('download');
  await page.getByTestId('tab-export-file').click();
  expect((await dl2).suggestedFilename()).toBe('RAV3-plan-au-sol.svg');
});
