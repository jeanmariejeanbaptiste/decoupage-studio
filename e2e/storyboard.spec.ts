import { expect, test } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8DwnwEJMDKgCgAAWq8E/2oTr6EAAAAASUVORK5CYII=', 'base64');

test('storyboard : cartes, réordonnancement et planche imprimable', async ({ page }) => {
  await page.goto('/#/storyboard?seed=fiction');
  const cards = page.getByTestId('storyboard-card');
  await expect(cards).toHaveCount(11);
  await expect(cards.first()).toContainText('1.1');
  await expect(cards.first()).toContainText('Général · 24mm · Fixe');
  // Glisser la carte 1.4 en tête de séquence.
  const a = (await cards.nth(3).boundingBox())!;
  const b = (await cards.nth(0).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 40);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 - 10, a.y + 45, { steps: 3 });
  await page.mouse.move(b.x + 20, b.y + 40, { steps: 15 });
  await page.mouse.up();
  await expect(cards.first()).toContainText('Valise');
  await expect(cards.first()).toContainText('1.1');
  // Planche PDF : 11 plans, 4 par page = 3 planches.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('planche 3 / 3')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('radio', { name: '6 / page' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('planche 2 / 2')).toBeVisible();
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(5000);
});

test('storyboard : image déposée depuis l’inspecteur visible sur la carte', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  await page.locator('[data-cell="0:subject"]').click();
  await page.getByTestId('inspector').locator('input[type=file]').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: /Storyboard/ }).click();
  await expect(page.getByTestId('storyboard-card').first().getByRole('img', { name: 'Storyboard du plan 1.1' })).toBeVisible();
});
