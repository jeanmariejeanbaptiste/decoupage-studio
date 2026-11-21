import { expect, test } from '@playwright/test';

const ROWS = '[data-testid="shot-row"]';

test('découpage : version vierge, comparaison du découpage, effacer le découpage (le scénario reste)', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS)).toHaveCount(11);
  // Le menu du découpage ne parle pas du scénario.
  await page.getByTestId('version-switcher').click();
  await expect(page.getByTestId('scenario-clear')).toHaveCount(0);
  await page.getByTestId('version-new-blank').click();
  await expect(page.locator(ROWS)).toHaveCount(0);
  const scenario = await page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario?: string } } }).__ds.doc().scenario ?? '');
  expect(scenario.length).toBeGreaterThan(50);
  // Comparer V1 avec V2 : tout est retiré.
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-compare').click();
  const cmp = page.getByTestId('cut-compare');
  await expect(cmp.getByTestId('cut-change')).toHaveCount(11);
  await expect(cmp).toContainText('Retiré');
  await page.keyboard.press('Escape');
  await expect(cmp).toHaveCount(0);
  // Retour à V1, puis effacer son découpage, annulable.
  await page.getByTestId('version-switcher').click();
  await page.getByRole('menuitemradio', { name: /^V1/ }).click();
  await expect(page.locator(ROWS)).toHaveCount(11);
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('cut-clear').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer V1' }).click();
  await expect(page.locator(ROWS)).toHaveCount(0);
  await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator(ROWS)).toHaveCount(11);
});
