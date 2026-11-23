import { expect, test } from '@playwright/test';

test('numérotation figée : un plan ajouté devient un bis, les autres gardent leur numéro', async ({ page }) => {
  await page.goto('/#/settings?seed=rav3&section=decoupage');
  const group = page.getByRole('radiogroup', { name: 'Numérotation des plans' });
  await expect(group.getByRole('radio', { name: 'Automatique' })).toBeChecked();
  await group.getByText('Figée').click();
  await page.getByTestId('settings-save').click();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByTestId('settings-savebar').scrollIntoViewIfNeeded();
    await group.screenshot({ path: `test-results/numerotation-${theme}.png` });
  }
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await expect(page.getByRole('columnheader', { name: /N°/ }).getByLabel('Numérotation figée')).toBeVisible();
  await page.locator('[data-cell="1:subject"]').click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('nouveau plan');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-cell="2:number"]')).toHaveText('2A');
  await expect(page.locator('[data-cell="3:number"]')).toHaveText('3');
  await page.locator('thead').first().screenshot({ path: 'test-results/numerotation-entete.png' });
});
