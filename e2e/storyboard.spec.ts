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
  await page.getByTestId('storyboard-export').click();
  await page.getByTestId('storyboard-export-panel').getByLabel('6', { exact: true }).check({ force: true });
  await page.keyboard.press('Escape');
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

test('storyboard : importer une image depuis la carte', async ({ page }) => {
  await page.goto('/#/storyboard?seed=fiction');
  const card = page.getByTestId('storyboard-card').nth(2);
  await card.getByLabel('Importer une image pour le plan 1.3').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: PNG });
  await expect(card.getByRole('img', { name: 'Storyboard du plan 1.3' })).toBeVisible();
  await card.getByRole('button', { name: 'Retirer l’image du plan 1.3' }).click();
  await expect(card.getByRole('img', { name: 'Storyboard du plan 1.3' })).toHaveCount(0);
});

test('storyboard : dessiner une case (crayon, flèche, flèche 3D, texte)', async ({ page }) => {
  await page.goto('/#/storyboard?seed=fiction');
  const card = page.getByTestId('storyboard-card').first();
  await card.hover();
  await card.getByTestId('storyboard-draw').click();
  const ed = page.getByTestId('sketch-editor');
  let box = (await ed.getByTestId('sketch-canvas').boundingBox())!;
  const at = (x: number, y: number) => [box.x + box.width * x, box.y + box.height * y] as const;
  await page.mouse.move(...at(0.1, 0.2));
  await page.mouse.down();
  await page.mouse.move(...at(0.3, 0.4), { steps: 6 });
  await page.mouse.up();
  await ed.getByTestId('sketch-arrow').click();
  await page.mouse.move(...at(0.4, 0.7));
  await page.mouse.down();
  await page.mouse.move(...at(0.7, 0.6), { steps: 6 });
  await page.mouse.up();
  await ed.getByTestId('sketch-arrow3d').click();
  // La barre des orientations décale le dessin : on re-mesure.
  box = (await ed.getByTestId('sketch-canvas').boundingBox())!;
  await page.mouse.click(...at(0.75, 0.3));
  await expect(ed.getByLabel('Inclinaison')).toBeVisible();
  await expect(ed.locator('[data-sketch]')).toHaveCount(3);
  await ed.getByTestId('sketch-save').click();
  await expect(ed).toHaveCount(0);
  await expect(card.getByRole('img', { name: /Storyboard du plan/ })).toBeVisible();
  // Le dessin reste modifiable : on le retrouve à la réouverture.
  await card.hover();
  await card.getByTestId('storyboard-draw').click();
  await expect(page.getByTestId('sketch-editor').locator('[data-sketch]')).toHaveCount(3);
});
