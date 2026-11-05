import { expect, test } from '@playwright/test';

test('insérer un modèle de séquence institutionnel', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Doc');
  await page.getByRole('radio', { name: 'Institutionnel' }).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('tab-broll').click();
  await expect(page.getByTestId('templates')).toHaveCount(1);
  await page.getByTestId('templates').click();
  await page.getByRole('menuitem', { name: /^Interview/ }).click();
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(7);
  await expect(page.locator('[data-cell="0:value"]')).toHaveText('Ensemble');
  await page.goto('/#/settings?section=decoupage');
  await page.getByTestId('templates').click();
  // Projet institutionnel : ni clip ni fiction proposés.
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await page.getByRole('menuitem', { name: /^Interview/ }).click();
  await page.goto('/#/grid');
  await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
  await expect(page.locator('tbody[data-seq]').nth(1)).toContainText('2, INTERVIEW');
});
