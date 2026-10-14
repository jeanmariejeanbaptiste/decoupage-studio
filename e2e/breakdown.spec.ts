import { expect, test } from '@playwright/test';

test('dépouillement : suggestions en un clic et ajout manuel', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByRole('button', { name: /3, PARVIS DE LA GARE/ }).click();
  const sug = page.getByTestId('breakdown-suggestions');
  await expect(sug).toContainText('Cigarette');
  await expect(sug).toContainText('Pluie');
  await sug.getByRole('button', { name: /Cigarette/ }).click();
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Cigarette');
  await sug.getByRole('button', { name: 'Tout ajouter' }).click();
  await expect(page.getByTestId('breakdown-effets')).toContainText('Pluie');
  await expect(sug).toHaveCount(0);
  await expect(page.getByTestId('breakdown-personnages')).toContainText('Marc');
  await page.getByLabel('Ajouter (Costumes)').fill('Imperméable beige');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-costumes')).toContainText('Imperméable beige');
  await page.getByRole('button', { name: 'Retirer Imperméable beige' }).click();
  await expect(page.getByTestId('breakdown-costumes')).not.toContainText('Imperméable');
});
