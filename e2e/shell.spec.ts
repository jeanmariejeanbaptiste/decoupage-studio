import { expect, test } from '@playwright/test';

test('palette de commandes ⌘K', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('nouveau plan');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(54);
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('registre');
  await expect(palette.getByRole('option').first()).toContainText('Registre');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/registry/);
});

test('aide des raccourcis « ? » et thème encre', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="0:number"]').click();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Raccourcis clavier' });
  await expect(help).toContainText('Recopier vers le bas');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.getByRole('button', { name: 'Thème encre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'encre');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(30, 27, 23)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'encre');
});

test('interface épurée : ni jauge, ni validation, ni intitulés de page ; menu latéral masquable', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await expect(page.getByRole('button', { name: /Découpage technique/ })).not.toContainText('%');
  await expect(page.getByText(/étape validée/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Valider l’étape' })).toHaveCount(0);
  await expect(page.locator('.page-title')).toHaveCount(0);
  await page.getByTestId('toggle-sidebar').click();
  await expect(page.getByRole('button', { name: /Découpage technique/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Découpage technique/ })).toHaveCount(0);
  await page.getByTestId('toggle-sidebar').click();
  await expect(page.getByRole('button', { name: /Découpage technique/ })).toBeVisible();
});

test('états vides et lien d’évitement', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('Aucun projet pour l’instant')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
});
