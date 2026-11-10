import { expect, test } from '@playwright/test';

test.describe('registre', () => {
  test('séquences : édition en ligne, écart et saut vers la grille', async ({ page }) => {
    await page.goto('/#/registry?seed=rav3');
    const row = page.getByRole('table', { name: 'Séquences' }).locator('tbody tr').first();
    await expect(row).toContainText('+0:05');
    await row.locator('td').nth(7).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('1:10');
    await page.keyboard.press('Enter');
    await expect(row).toContainText('1:10');
    await expect(row).toContainText('−0:35 (−50 %)');
    await page.getByRole('table', { name: 'Séquences' }).getByRole('button', { name: '4', exact: true }).click();
    await expect(page.locator('[data-cell="18:subject"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('personnages : fusion de doublons par menu et par glisser-déposer', async ({ page }) => {
    await page.goto('/#/registry?seed=rav3&tab=characters');
    const rows = page.getByTestId('character-row');
    const named = (n: string) => rows.filter({ has: page.locator('td:nth-child(2)', { hasText: n }) });
    await expect(rows).toHaveCount(4);
    await page.getByRole('button', { name: 'Ajouter un personnage' }).click();
    await expect(rows).toHaveCount(5);
    await page.getByLabel('Fusionner Personnage 5 dans…').selectOption({ label: 'Candice' });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Fusionner' }).click();
    await expect(rows).toHaveCount(4);
    await expect(named('Candice')).toContainText('alias Candi, Personnage 5');
    await named('Maquilleuse').dragTo(named('Vedette'));
    await expect(page.getByRole('alertdialog')).toContainText('Fusionner « Maquilleuse » dans « Vedette »');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Fusionner' }).click();
    await expect(rows).toHaveCount(3);
  });

  test('plans : filtres et recherche', async ({ page }) => {
    await page.goto('/#/registry?seed=rav3&tab=shots');
    await page.getByLabel('Filtrer par valeur').selectOption('Insert');
    await expect(page.getByText('9 / 53 plans')).toBeVisible();
    await page.getByLabel('Filtrer par valeur').selectOption('');
    await page.getByLabel('Filtrer par personnage').selectOption('Vedette');
    await page.getByLabel('Filtrer par focale').selectOption('100mm');
    await expect(page.getByRole('table', { name: 'Plans' }).locator('tbody tr')).toHaveCount(1);
    await page.getByLabel('Filtrer par focale').selectOption('');
    await page.getByLabel('Rechercher dans le registre').fill('piano');
    await expect(page.getByRole('table', { name: 'Plans' }).locator('tbody tr')).toHaveCount(8);
  });

  test('décors : durée totale à tourner', async ({ page }) => {
    await page.goto('/#/registry?seed=rav3&tab=decors');
    await expect(page.getByRole('table', { name: 'Décors' }).locator('tbody tr').filter({ hasText: 'LOGE' })).toContainText('0:16');
  });

  test('décors à 1280 px : le tableau tient dans la page, corbeille et durée en vue', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#/registry?seed=rav3&tab=decors');
    const table = page.getByRole('table', { name: 'Décors' });
    const fits = await table.evaluate((t) => t.getBoundingClientRect().width <= (t.parentElement as HTMLElement).clientWidth + 1);
    expect(fits).toBe(true);
    const trash = table.getByRole('button', { name: 'Supprimer LOGE' });
    await expect(trash).toBeInViewport();
    await expect(table.locator('tbody tr').filter({ hasText: 'LOGE' }).locator('td').nth(-2)).toBeInViewport();
  });

  test('décors : celui d’une autre version n’est pas « inutilisé », sa suppression le dit', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await page.getByTestId('version-switcher').click();
    await page.getByTestId('version-new').click();
    const seq3 = page.locator('tbody[data-seq]').nth(2);
    await seq3.locator('[data-cell$=":sequence"]').hover();
    // V1 la garde : elle part sans confirmation.
    await seq3.getByTestId('delete-sequence').click();
    await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
    await page.goto('/#/registry?tab=decors');
    const row = page.getByRole('table', { name: 'Décors' }).locator('tbody tr').filter({ hasText: 'PARVIS DE LA GARE' });
    await expect(row).toContainText('en V1');
    await expect(row).not.toContainText('inutilisé');
    await row.getByRole('button', { name: 'Supprimer PARVIS DE LA GARE' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('V1 s’en sert encore');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(row).toBeVisible();
  });
});
