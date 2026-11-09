import { expect, test, type Page } from '@playwright/test';

const ROWS = '[data-testid="shot-row"]';

async function typeCell(page: Page, text: string, then: 'Tab' | 'Enter' = 'Tab') {
  await page.keyboard.type(text);
  await page.keyboard.press(then);
}

test('saisir 2 séquences × 5 plans au clavier seul', async ({ page }) => {
  await page.goto('/#/');
  // Nouveau projet au clavier : titre puis Entrée.
  await page.getByTestId('new-project').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Test clavier');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('create-first')).toBeFocused();
  await page.keyboard.press('Enter');
  const grid = page.getByTestId('grid');
  await expect(grid).toBeFocused();

  for (const [label, subject] of [
    ['Chambre', 'Léa'],
    ['Parc', 'Marc'],
  ]) {
    // La sélection est sur la cellule SÉQUENCE de la nouvelle séquence.
    await typeCell(page, label, 'Tab');
    for (let i = 1; i <= 5; i++) {
      // SUJET (hérité à partir du 2e plan : on le remplace), VALEUR, ANGLE, MOUVEMENT, FOCALE, ACTION
      await typeCell(page, subject);
      await typeCell(page, i % 2 ? 'Taille' : 'Gros plan');
      await typeCell(page, 'Face, Hauteur regard');
      await typeCell(page, 'Fixe');
      await typeCell(page, String(25 + i * 10));
      await typeCell(page, `Action ${label} ${i}`, 'Enter');
      if (i < 5) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    }
    if (label === 'Chambre') await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter');
  }

  await expect(page.locator(ROWS)).toHaveCount(10);
  await expect(page.locator('tbody[data-seq]')).toHaveCount(2);
  const first = page.locator(ROWS).first();
  await expect(first).toContainText('1, CHAMBRE');
  await expect(first).toContainText('Léa');
  await expect(first).toContainText('35mm');
  const sixth = page.locator(ROWS).nth(5);
  await expect(sixth).toContainText('2, PARC');
  await expect(sixth).toContainText('Marc');
  await expect(page.locator(ROWS).nth(9)).toContainText('Action Parc 5');
  // Numérotation automatique : 1..5 dans chaque séquence.
  await expect(page.locator('[data-cell$=":number"]')).toHaveText(['1', '2', '3', '4', '5', '1', '2', '3', '4', '5']);
  await expect(page.getByTestId('grid-footer')).toContainText('10 plans');
});

test('naviguer, annuler et supprimer au clavier', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const grid = page.getByTestId('grid');
  await grid.focus();
  await expect(page.locator(ROWS)).toHaveCount(11);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Backspace`);
  await expect(page.locator(ROWS)).toHaveCount(10);
  // Pas de message pour une suppression courante : ⌘Z suffit.
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator(ROWS)).toHaveCount(11);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(page.locator(ROWS)).toHaveCount(10);
});

test('les suggestions de vocabulaire s’affichent pendant la saisie', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="0:angle"]').click();
  await page.keyboard.type('Pl');
  await expect(page.getByTestId('suggestions').getByRole('option', { name: /Plongée/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-cell="1:value"]').click();
  await page.keyboard.type('Gr');
  await expect(page.getByTestId('suggestions').getByRole('option', { name: /Gros plan/ })).toBeVisible();
});

test('les suggestions s’ouvrent dès l’édition d’une cellule', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="1:value"]').dblclick();
  await expect(page.getByTestId('suggestions').getByRole('option', { name: /Gros plan/ }).first()).toBeVisible();
  // Liste complète à l'ouverture, jusqu'à l'insert.
  await expect(page.getByTestId('suggestions').getByRole('option', { name: /Insert/ })).toBeVisible();
});

test('coller depuis un tableur à cheval sur deux séquences : les lignes suivent la grille', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  const firstSeq = page.locator('tbody[data-seq]').first();
  const inFirst = await firstSeq.locator('[data-testid="shot-row"]').count();
  // Dernier plan de la 1re séquence, colonne Sujet.
  await page.locator(`[data-cell="${inFirst - 1}:subject"]`).click();
  await page.getByTestId('grid').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Collé A\nCollé B\nCollé C');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(rows).toHaveCount(n);
  await expect(firstSeq.locator('[data-testid="shot-row"]')).toHaveCount(inFirst);
  await expect(page.locator(`[data-cell="${inFirst - 1}:subject"]`)).toHaveText('Collé A');
  await expect(page.locator(`[data-cell="${inFirst}:subject"]`)).toHaveText('Collé B');
  await expect(page.locator(`[data-cell="${inFirst + 1}:subject"]`)).toHaveText('Collé C');
});

test('relecture par l’auteur : schéma, tracé sur la page ; en V2, le commentaire de V1 reste et reçoit sa réponse', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByRole('button', { name: /Aperçu/ }).click();
  const cell = page.locator('tr[data-shot] td[data-col="value"]').first();
  await cell.click();
  await page.getByTestId('comment-text').fill('Plan large ?');
  // Un schéma dessiné à main levée.
  await page.getByTestId('comment-popover').getByTestId('comment-sketch').click();
  const pad = page.getByTestId('sketch-pad').locator('canvas');
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('sketch-done').click();
  await expect(page.getByTestId('comment-popover').getByTestId('comment-attachments').locator('img')).toHaveCount(1);
  // Un tracé autour de la cellule, sur la page.
  await page.getByTestId('comment-draw').click();
  const c = (await cell.boundingBox())!;
  await page.mouse.move(c.x - 6, c.y - 6);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width + 6, c.y - 6, { steps: 4 });
  await page.mouse.move(c.x + c.width + 6, c.y + c.height + 6, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('marks-done').click();
  await page.getByTestId('comment-send').click();
  await expect(page.getByTestId('comment-popover').getByTestId('comment')).toContainText('1 tracé sur la page');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('marks-cut').locator('path')).toHaveCount(1);
  // V2 : le commentaire de V1 est là, marqué V1 ; la réponse dit « en V2 ».
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-new').click();
  await page.locator('td[data-commented]').first().click();
  const pop = page.getByTestId('comment-popover');
  await expect(pop.getByTestId('comment')).toContainText('V1');
  await pop.getByTestId('comment-reply').fill('Changé en plan large.');
  await page.keyboard.press('Enter');
  await expect(pop.getByTestId('comment-reply-item')).toContainText('en V2');
});
