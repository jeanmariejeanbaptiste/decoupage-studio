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
    const named = (n: string) => rows.filter({ has: page.locator('td:first-child', { hasText: n }) });
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
});
