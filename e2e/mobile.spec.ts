import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('téléphone : un plan à la fois, navigation, ajout et vue d’ensemble en liste', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const card = page.getByTestId('mobile-cut');
  await expect(card).toContainText('Plan 1.1');
  await expect(page.getByTestId('shot-row')).toHaveCount(0);
  await page.getByTestId('mobile-next').click();
  await expect(card).toContainText('Plan 1.2');
  await page.getByLabel('Sujet').fill('Léa de dos');
  await page.getByLabel('Sujet').blur();
  await page.getByTestId('mobile-add-shot').click();
  await expect(card).toContainText('Plan 1.3');
  await expect(page.getByLabel('Sujet')).toHaveValue('');
  await page.getByTestId('mobile-overview').click();
  await expect(page.getByTestId('mobile-list-shot').filter({ hasText: 'Léa de dos' })).toHaveCount(1);
  await page.getByTestId('mobile-list-shot').first().click();
  await expect(card).toContainText('Plan 1.1');
});
