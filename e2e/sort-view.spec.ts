import { expect, test } from '@playwright/test';

test('tri pour le tournage : plus large d’abord, numéros d’origine, par séquence, storyboard et export', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByTestId('open-sort').click();
  const view = page.getByTestId('sort-view');
  await expect(view).toBeVisible();
  await expect(view.getByTestId('sort-criterion')).toHaveText([/Valeur/]);
  // Le premier plan est le plus large du film, avec son numéro d'origine (pas « 1 »).
  const first = view.getByTestId('export-table').locator('tbody tr').first();
  await expect(first).toContainText('Ensemble');
  await expect(first).toContainText('7, SALLE DE CONCERT');
  // Aucune colonne TC dans un ordre de tournage.
  await expect(view.getByTestId('export-table').locator('thead')).not.toContainText('TC');
  // Deuxième critère, puis par séquence.
  await view.getByTestId('sort-add').selectOption('subject');
  await expect(view.getByTestId('sort-criterion')).toHaveCount(2);
  await view.getByTestId('sort-by-sequence').click();
  await expect(view.getByTestId('export-table').locator('tbody tr').first()).toContainText('1, CHAMBRE ADMIRATRICE');
  // Storyboard trié, puis export.
  await view.getByTestId('sort-storyboard').click();
  await expect(page.getByTestId('storyboard-preview').getByTestId('storyboard-sheet').first()).toBeVisible();
  // Retour au découpage, intact.
  await page.getByTestId('sort-close').click();
  await expect(page.locator('[data-testid="shot-row"]').first()).toBeVisible();
  await expect(page.locator('[data-cell="0:number"]')).toContainText('1');
});
