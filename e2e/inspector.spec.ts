import { expect, test } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8DwnwEJMDKgCgAAWq8E/2oTr6EAAAAASUVORK5CYII=',
  'base64',
);

test('inspecteur : angle de champ, matériel, son et storyboard', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  await page.locator('[data-cell="6:subject"]').click();
  const insp = page.getByTestId('inspector');
  await expect(insp).toContainText('Plan 2.1');
  await expect(insp).toContainText('50 mm · 39,6° horiz.');
  await expect(insp).toContainText('Optique fixe 50 mm');
  await expect(insp).toContainText('Rails + dolly ou slider');
  await insp.getByLabel('Son').fill('IN');
  await expect(insp).toContainText('Perche + HF');
  await insp.locator('input[type=file]').setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: PNG });
  await expect(insp.getByRole('img', { name: 'Storyboard du plan 2.1' })).toBeVisible();
  await page.getByRole('button', { name: 'Replier l’inspecteur' }).click();
  await expect(insp).toHaveCount(0);
});

test('vérifications : liste cliquable, ignorer ici, rétablir', async ({ page }) => {
  await page.goto('/#/checks?seed=rav3');
  const issues = page.getByTestId('issue');
  await expect(issues.first()).toBeVisible();
  const n = await issues.count();
  expect(n).toBeGreaterThan(3);
  const affiche = issues.filter({ hasText: 'Affiche' });
  await expect(affiche).toContainText('Sujet absent de la base des personnages');
  await affiche.getByRole('button', { name: 'ignorer ici' }).click();
  await expect(issues).toHaveCount(n - 1);
  await page.getByRole('button', { name: /Rétablir les 1 contrôle/ }).click();
  await expect(issues).toHaveCount(n);
  await issues.filter({ hasText: 'risque de saute' }).first().getByRole('button').first().click();
  await expect(page.locator('[aria-selected="true"][data-cell$=":subject"]')).toHaveCount(1);
  await expect(page.getByTestId('issue-dot').first()).toBeVisible();
});

test('listes de matériel par chef de poste', async ({ page }) => {
  await page.goto('/#/equipment?seed=rav3');
  await expect(page.getByTestId('equipment-Machinerie')).toContainText('Rails + dolly ou slider');
  await expect(page.getByTestId('equipment-Image')).toContainText('Optique fixe 100 mm');
  await expect(page.getByTestId('equipment-Lumière')).toContainText('Projecteurs effet nuit');
  await page.getByLabel('Ajouter du matériel (Son)').fill('Talkies-walkies');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('equipment-Son')).toContainText('Talkies-walkies');
  await page.getByTestId('equipment-Image').getByRole('button', { name: '7.3', exact: true }).click();
  await expect(page.locator('[data-cell="40:subject"]')).toHaveAttribute('aria-selected', 'true');
});
