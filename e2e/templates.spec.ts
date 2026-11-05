import { expect, test } from '@playwright/test';

test('insérer un modèle de séquence institutionnel', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Doc');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('templates')).toHaveCount(1);
  await page.getByTestId('templates').click();
  // Projet vide : tous les modèles ; le premier choisi donne son format au projet.
  await page.getByRole('menuitem', { name: /Interview institutionnelle/ }).click();
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(7);
  await expect(page.locator('[data-cell="0:value"]')).toHaveText('Ensemble');
  await page.goto('/#/settings?section=decoupage');
  await page.getByTestId('templates').click();
  // Projet institutionnel : ni clip ni fiction proposés.
  await expect(page.getByRole('menuitem', { name: /Clip/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Fiction/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: /Interview institutionnelle/ }).click();
  await page.goto('/#/grid');
  await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
  await expect(page.locator('tbody[data-seq]').nth(1)).toContainText('2, INTERVIEW');
});
