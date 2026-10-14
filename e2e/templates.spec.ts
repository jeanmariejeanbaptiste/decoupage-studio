import { expect, test } from '@playwright/test';

test('insérer un modèle de séquence documentaire', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Doc');
  await page.getByLabel('Documentaire').check({ force: true });
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('templates')).toHaveCount(2);
  await page.getByTestId('templates').last().click();
  const item = page.getByRole('menuitem', { name: /Documentaire/ });
  await expect(item).toContainText('suggéré');
  await item.click();
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(12);
  await expect(page.locator('[data-cell="0:value"]')).toHaveText('Général');
  await expect(page.locator('[data-cell="11:value"]')).toHaveText('Général');
  await expect(page.locator('[data-cell="4:action"]')).toContainText('Plans de coupe');
  await page.getByTestId('templates').click();
  await page.getByRole('menuitem', { name: /Interview institutionnelle/ }).click();
  await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
  await expect(page.locator('tbody[data-seq]').nth(1)).toContainText('2, INTERVIEW');
});
