import { expect, test, type Page } from '@playwright/test';

const cell = (page: Page, row: number, col: string) => page.locator(`[data-cell="${row}:${col}"]`);

async function select(page: Page, row: number, col: string) {
  await cell(page, row, col).click();
}

test.describe('saisie intelligente', () => {
  test('valeur de cadre : suggestions par préfixe, choix au clavier', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await select(page, 0, 'value');
    await page.keyboard.type('rap');
    const list = page.getByTestId('suggestions');
    await expect(list).toBeVisible();
    await expect(list.getByRole('option').first()).toContainText('Rapproché');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'value')).toHaveText('Rapproché');
    // Texte libre accepté tel quel, sans suggestion choisie.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('Plan de coupe');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'value')).toHaveText('Plan de coupe');
  });

  test('angle en jetons, avec alias et avertissement d’incompatibilité', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await select(page, 1, 'angle');
    await page.keyboard.type('plonge');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('token')).toHaveText(['Plongée']);
    await page.keyboard.type('3/4 f');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('token')).toHaveText(['Plongée', '3/4 Face']);
    await page.keyboard.press('Enter');
    await expect(cell(page, 1, 'angle')).toHaveText('Plongée, 3/4 Face');
    await select(page, 1, 'angle');
    await page.keyboard.type('Face, Dos');
    await page.keyboard.press('Enter');
    await expect(cell(page, 1, 'angle')).toHaveAttribute('title', /incompatibles/);
  });

  test('mouvement : séparateur « + » préservé', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await select(page, 0, 'movement');
    await page.keyboard.type('trav circ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.type('+suivi');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'movement')).toHaveText('Trav circulaire + suivi');
  });

  test('focale verrouillée en mm, dédoublée pour un zoom', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await select(page, 0, 'focal');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'focal')).toContainText('mm');
    await expect(page.getByTestId('focal-to')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(cell(page, 0, 'focal')).toHaveAttribute('title', /angle horizontal .* diagonal/);
    // Un zoom dans le mouvement dédouble la focale.
    await select(page, 0, 'movement');
    await page.keyboard.type('Zoom avant');
    await page.keyboard.press('Enter');
    await select(page, 0, 'focal');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('focal-to')).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('24');
    await page.keyboard.press('Tab');
    await page.keyboard.type('70');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'focal')).toHaveText('24 → 70mm');
  });

  test('sujet inconnu : proposition de créer le personnage', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await select(page, 0, 'subject');
    await page.keyboard.type('Nina');
    await page.keyboard.press('Enter');
    const toast = page.getByTestId('toast').filter({ hasText: 'Nina' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Créer le personnage' }).click();
    await select(page, 2, 'subject');
    await page.keyboard.type('Ni');
    await expect(page.getByTestId('suggestions').getByRole('option', { name: /Nina/ })).toContainText('personnage');
  });

  test('TC : saisie tolérante, marque manuelle et TOUT', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await select(page, 0, 'tc');
    await page.keyboard.type('130');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'tc')).toContainText('0:00 - 1:30');
    await expect(cell(page, 0, 'tc')).toContainText('✎');
    await page.goto('/#/grid?seed=rav3');
    await page.reload();
    await select(page, 0, 'tc');
    await page.keyboard.type('tout');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'tc')).toHaveText('TOUT');
    await select(page, 3, 'tc');
    await page.keyboard.type('1m30-2:00');
    await page.keyboard.press('Enter');
    await expect(cell(page, 3, 'tc')).toHaveText('1:30 - 2:00');
  });
});
