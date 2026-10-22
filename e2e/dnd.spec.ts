import { expect, test, type Locator, type Page } from '@playwright/test';

const ROWS = '[data-testid="shot-row"]';

async function dragTo(page: Page, from: Locator, to: Locator, offsetY = 0) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + offsetY, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

const invariants = (page: Page) => page.evaluate(() => (window as unknown as { __ds: { invariants: () => string[] } }).__ds.invariants());
const seqRows = (page: Page, n: number) => page.locator(`tbody[data-seq]:nth-of-type(${n}) ${ROWS}`);

test.describe('couverture et réordonnancement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/grid?seed=rav3');
    await expect(page.locator(ROWS)).toHaveCount(53);
  });

  test('glisser un plan dans sa séquence renumérote', async ({ page }) => {
    const rows = page.locator(ROWS);
    await dragTo(page, rows.nth(5).getByTestId('shot-handle'), rows.nth(0));
    await expect(rows.nth(0)).toContainText('se rapproche lentement');
    await expect(page.locator('[data-cell$=":number"]').first()).toHaveText('1');
    expect(await invariants(page)).toEqual([]);
  });

  test('casser une action liée la scinde, avec toast d’annulation', async ({ page }) => {
    const rows = page.locator(ROWS);
    await dragTo(page, rows.nth(1).getByTestId('shot-handle'), rows.nth(3));
    await expect(page.getByTestId('toast')).toContainText('scindée');
    expect(await invariants(page)).toEqual([]);
    await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.locator('[data-cell="0:action"]')).toHaveAttribute('rowspan', '3');
  });

  test('vers une autre séquence : confirmation puis détachement', async ({ page }) => {
    const rows = page.locator(ROWS);
    await dragTo(page, rows.nth(4).getByTestId('shot-handle'), rows.nth(7));
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Déplacer le plan 1.5 vers la séquence 2, PARC DES COQUELICOTS');
    await expect(dialog).toContainText('Son action liée sera détachée');
    await dialog.getByRole('button', { name: 'Déplacer' }).click();
    await expect(seqRows(page, 1)).toHaveCount(5);
    await expect(seqRows(page, 2)).toHaveCount(9);
    expect(await invariants(page)).toEqual([]);
  });

  test('annuler le déplacement inter-séquences ne change rien', async ({ page }) => {
    const rows = page.locator(ROWS);
    await dragTo(page, rows.nth(4).getByTestId('shot-handle'), rows.nth(7));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(seqRows(page, 1)).toHaveCount(6);
  });

  test('glisser une séquence entière', async ({ page }) => {
    const third = page.locator('tbody[data-seq]').nth(2);
    await third.locator('[data-cell$=":sequence"]').hover();
    await dragTo(page, third.getByTestId('seq-handle'), page.locator(ROWS).nth(0));
    await expect(page.locator(ROWS).first()).toContainText('1, JARDIN SQY');
    await expect(page.locator(ROWS).nth(4)).toContainText('2, CHAMBRE ADMIRATRICE');
    expect(await invariants(page)).toEqual([]);
  });

  test('lier puis délier l’action au clavier et à la souris', async ({ page }) => {
    await page.locator('[data-cell="3:subject"]').click();
    await page.locator('[data-cell="5:subject"]').click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Lier l’action' }).click();
    await expect(page.locator('[data-cell="3:action"]')).toHaveAttribute('rowspan', '3');
    expect(await invariants(page)).toEqual([]);
    await page.locator('[data-cell="3:subject"]').click();
    await page.locator('[data-cell="5:subject"]').click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Délier' }).click();
    await expect(page.locator('[data-cell="3:action"]')).not.toContainText('lié');
    expect(await invariants(page)).toEqual([]);
  });

  test('raccourcis de déplacement et duplication respectent les invariants', async ({ page }) => {
    await page.locator('[data-cell="1:subject"]').click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press(`${mod}+d`);
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect(page.locator(ROWS)).toHaveCount(54);
    expect(await invariants(page)).toEqual([]);
  });
});
