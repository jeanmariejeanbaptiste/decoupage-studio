import { expect, test, type Locator } from '@playwright/test';

const labels = async (panel: Locator) => (await panel.getByRole('group', { name: 'Par feuille' }).locator('label').allInnerTexts()).map((t) => t.trim());

test('storyboard : « Par feuille » ne propose que les grilles qui remplissent la feuille, selon le format et l’orientation', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('view-storyboard').click();

  // Format : silhouettes au trait, sans description ; 16:9 par défaut.
  const picker = page.getByTestId('storyboard-aspect');
  await expect(picker).toContainText('16:9');
  await picker.click();
  const options = page.getByTestId('storyboard-aspect-option');
  await expect(options).toHaveCount(11);
  await expect(options.first()).toHaveText('16:9');
  await expect(options.first().locator('svg')).toHaveCount(1);
  await expect(page.getByRole('listbox', { name: 'Format des images' })).not.toContainText('cinémascope');
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);

  await page.getByTestId('storyboard-export').click();
  const sb = page.getByTestId('storyboard-export-panel');
  await sb.getByText('Paysage', { exact: true }).click();
  expect(await labels(sb)).toEqual(['1', '4', '9']);
  await sb.getByText('Portrait', { exact: true }).click();
  expect(await labels(sb)).toEqual(['2', '6']);
  // Le choix d'avant (paysage) ne vaut plus : le plus proche est retenu.
  await expect(sb.getByRole('group', { name: 'Par feuille' }).getByRole('radio', { checked: true })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Format vertical : la logique se retourne.
  await picker.click();
  await options.filter({ hasText: '9:16' }).click();
  await expect(picker).toContainText('9:16');
  await page.getByTestId('storyboard-export').click();
  expect(await labels(sb)).toEqual(['6']);
  await sb.getByText('Paysage', { exact: true }).click();
  expect(await labels(sb)).toEqual(['3']);
});

test('storyboard : aperçu des planches à la grille calculée (16:9 portrait, 6 par feuille = 2 × 3)', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('view-storyboard').click();
  await page.getByTestId('storyboard-export').click();
  const sb = page.getByTestId('storyboard-export-panel');
  await sb.getByText('Portrait', { exact: true }).click();
  await sb.getByRole('group', { name: 'Par feuille' }).getByText('6', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('toggle-print').click();
  const grid = page.getByTestId('storyboard-sheet').first().locator('[data-grid]');
  await expect(grid).toHaveAttribute('data-grid', '2x3');
});
