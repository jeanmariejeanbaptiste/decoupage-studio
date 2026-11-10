import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('capture de l’export RAV3 (style unique blanc, A4 paysage)', async ({ page }) => {
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.goto('/#/print?seed=rav3');
  const sheet = page.getByTestId('print-sheet');
  await expect(sheet.getByTestId('print-page').first()).toBeVisible();
  await expect(sheet.locator('tbody')).not.toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  // Structure fusionnée : SÉQUENCE sur toute la hauteur, ACTION par bloc, TC par valeur.
  const first = sheet.locator('tbody').first();
  await expect(first.locator('td[rowspan="6"]').first()).toHaveText('1, CHAMBRE ADMIRATRICE');
  await expect(first.locator('td[rowspan="3"]').filter({ hasText: 'Admiratrice assise' })).toHaveCount(1);
  await expect(sheet.locator('table').first().locator('thead th')).toHaveText(['SÉQUENCE', 'N°', 'Sujet', 'Valeur', 'Angle', 'Mouvement de caméra', 'Focale', 'Action', 'TC MIN']);
  const bg = await sheet.getByTestId('print-page').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ media: 'print' });
  await sheet.screenshot({ path: 'test-results/export-rav3.png' });
  await page.emulateMedia({ media: 'screen' });
  // PDF : séquences non coupées, en-tête répété.
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, path: 'test-results/export-rav3.pdf' });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
  // Autant de pages PDF que de pages calculées : rien ne déborde.
  const pages = await sheet.getByTestId('print-page').count();
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length).toBe(pages);
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
  await expect(page.locator('[data-cell="0:action"]')).toHaveAttribute('rowspan', '2');
  await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
});

test('dossier de production complet (.zip)', async ({ page }) => {
  // Calendrier de production rempli : ses fichiers rejoignent le dossier.
  await page.goto('/#/production?seed=fiction');
  await page.getByTestId('production-template').click();
  await expect(page.getByTestId('task-row')).toHaveCount(17);
  await page.evaluate(() => void (window.location.hash = '#/export'));
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-zip').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('la-consigne-v1-dossier-de-production.zip');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync(await d.path()));
  const names = Object.keys(zip.files).join('\n');
  for (const part of ['00 Projet/la-consigne-v1.decoupage', '02 Scénario/Scénario.fountain', '04 Découpage/Découpage technique.xlsx', '10 Registre/Plans.csv', 'LISEZ-MOI.txt'])
    expect(names).toContain(part);
  for (const part of ['11 Calendriers/Calendrier.ics', '11 Calendriers/Calendrier de production.ics', '11 Calendriers/Calendrier de production.svg']) expect(names).toContain(part);
  const readme = await zip.file(/LISEZ-MOI\.txt$/)[0].async('string');
  expect(readme).toContain('11 Calendriers');
  const ics = await zip.file(/Calendrier de production\.ics$/)[0].async('string');
  expect(ics).toContain('SUMMARY:◆ Scénario verrouillé');
});

test('exports individuels par onglet', async ({ page }) => {
  await page.goto('/#/registry?seed=rav3&tab=characters');
  const dl = page.waitForEvent('download');
  await page.getByTestId('tab-export').click();
  await page.getByTestId('tab-export-panel').getByText(/^CSV/).click();
  await page.getByTestId('tab-export-go').click();
  expect((await dl).suggestedFilename()).toBe('rav3-v3-characters.csv');
  await page.goto('/#/floorplan');
  const dl2 = page.waitForEvent('download');
  await page.getByTestId('floorplan-export').click();
  await page.getByTestId('floorplan-export-panel').getByText('SVG').click();
  await page.getByTestId('floorplan-export-go').click();
  expect((await dl2).suggestedFilename()).toBe('rav3-v3-plans-au-sol.zip');
});
