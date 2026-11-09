import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 12 });
  await page.mouse.up();
  // dnd-kit ignore les clics des 50 ms qui suivent un dépôt.
  await page.waitForTimeout(80);
}

test('plan de travail : jours, glisser une séquence, suggestion', async ({ page }) => {
  await page.goto('/#/schedule?seed=rav3');
  await expect(page.getByTestId('band-0').getByTestId('strip')).toHaveCount(7);
  await page.getByTestId('add-day').click();
  await expect(page.getByTestId('band-1')).toBeVisible();
  await drag(page, page.getByTestId('band-0').getByTestId('strip').first(), page.getByTestId('band-1'));
  await expect(page.getByTestId('band-1').getByTestId('strip')).toHaveCount(1);
  await expect(page.getByTestId('day-stats-1')).toContainText('6 plans');
  await page.getByTestId('suggest-schedule').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Répartir' }).click();
  await expect(page.getByTestId('band-0').getByTestId('strip')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toContainText('Plan de travail réparti');
  await expect(page.getByTestId('band-3')).toBeVisible();
});

test('feuille de service générée pour un jour', async ({ page }) => {
  await page.goto('/#/callsheet?seed=rav3');
  await expect(page.getByText('Aucun jour de tournage')).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le plan de travail' }).click();
  await page.getByTestId('suggest-schedule').click();
  await page.getByRole('button', { name: /Feuille de service/ }).click();
  const sheet = page.getByTestId('callsheet');
  await expect(sheet).toContainText('Jour 1');
  await expect(sheet).toContainText('Comédiens');
  await expect(sheet.getByTestId('callsheet-shots').locator('tbody tr').first()).toBeVisible();
  await expect(sheet).toContainText('Rails');
  await sheet.getByLabel('Heure de rendez-vous').fill('07:30');
  await expect(sheet.getByLabel('Heure de rendez-vous')).toHaveValue('07:30');
  // Repas de … à … ; la reprise court de la fin du repas à la fin prévue.
  await expect(sheet.getByTestId('callsheet-restart')).toHaveCount(0);
  await sheet.getByLabel('Début du repas').fill('13:00');
  await expect(sheet.getByLabel('Fin du repas')).toHaveValue('14:00');
  await sheet.getByLabel('Fin du repas').fill('13:45');
  await sheet.getByLabel('Fin prévue').fill('19:00');
  await expect(sheet.getByTestId('callsheet-restart')).toContainText('13:45');
  await sheet.getByLabel('Début du repas').fill('12:30');
  await expect(sheet.getByLabel('Fin du repas')).toHaveValue('13:15');
  const dl = page.waitForEvent('download');
  await page.getByTestId('tab-export').click();
  await page.getByTestId('tab-export-panel').getByText('Word', { exact: true }).click();
  await page.getByTestId('tab-export-go').click();
  const word = readFileSync(await (await dl).path(), 'utf8');
  expect(word).toContain('de 12:30 à 13:15');
  expect(word).toContain('de 13:15 à 19:00');
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(5000);
});
