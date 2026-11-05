import { expect, test } from '@playwright/test';

test('institutionnel : fiche d’interview (A-roll) et illustrations (B-roll)', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Instit');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('templates').click();
  await page.getByRole('menuitem', { name: /Interview institutionnelle/ }).click();
  // Le projet devient institutionnel : la colonne TC est facultative (masquée).
  await page.getByTestId('tab-interview').click();
  const itw = page.getByTestId('interview');
  await expect(itw).toContainText('Dispositif caméra');
  await itw.getByLabel('Nom', { exact: true }).fill('Claire Martin');
  await itw.getByLabel('Fonction (synthé)').fill('Directrice');
  await itw.getByLabel('Nom', { exact: true }).press('Tab');
  await itw.getByTestId('add-question').click();
  await itw.getByLabel('Question', { exact: true }).last().fill('Racontez-nous votre métier.');
  await itw.getByText('Dispositif caméra').click();
  await expect(itw.getByRole('button', { name: 'Claire Martin' })).toBeVisible();
  await page.getByTestId('tab-broll').click();
  await expect(page.locator('[data-testid="shot-row"]').first()).toBeVisible();
  await expect(page.locator('thead th', { hasText: 'TC MIN' })).toHaveCount(0);
  await page.getByTestId('seq-slot').first().fill('10:30–11:00');
  await page.getByTestId('seq-slot').first().press('Enter');
  await page.getByTestId('tab-interview').click();
  await expect(itw.getByLabel('Question', { exact: true }).last()).toHaveValue('Racontez-nous votre métier.');
});
