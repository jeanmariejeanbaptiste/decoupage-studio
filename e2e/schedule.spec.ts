import { expect, test, type Locator, type Page } from '@playwright/test';

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 12 });
  await page.mouse.up();
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
  await page.getByRole('alertdialog').getByRole('button', { name: 'Suggérer' }).click();
  await expect(page.getByTestId('band-0').getByTestId('strip')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toContainText('Plan de travail suggéré');
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
  await expect(sheet).toContainText('Convocations');
  await expect(sheet.getByTestId('callsheet-shots').locator('tbody tr').first()).toBeVisible();
  await expect(sheet).toContainText('Rails');
  await sheet.getByLabel('Heure de rendez-vous').fill('07:30');
  await expect(sheet.getByLabel('Heure de rendez-vous')).toHaveValue('07:30');
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(5000);
});
