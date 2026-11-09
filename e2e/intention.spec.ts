import { expect, test } from '@playwright/test';

test('note d’intention : pages A4, mise en forme type Word, saut de page, annulation, thème et export', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = page.getByTestId('note-editor');
  await expect(ed.locator('h1')).toHaveText('La Consigne');
  await expect(ed.locator('blockquote')).toContainText('consigne');
  await expect(page.getByTestId('note-pages')).toHaveText('Page 1 sur 1');
  const words = Number((await page.getByTestId('note-words').textContent())!.split(' ')[0]);
  expect(words).toBeGreaterThan(80);

  // Un paragraphe à la fin, mis en gras et centré depuis le ruban.
  await ed.locator('blockquote').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByTestId('note-style').selectOption('p');
  await page.keyboard.type('Tournage prévu en mars.');
  await page.keyboard.press('Shift+Home');
  await page.getByTestId('note-bold').click();
  await page.getByTestId('note-center').click();
  await expect(ed.locator('p', { hasText: 'Tournage prévu en mars.' })).toHaveCSS('text-align', 'center');
  await expect(ed.locator('b', { hasText: 'Tournage prévu en mars.' })).toHaveCount(1);

  // Saut de page : une page de plus ; ⌘Z le retire.
  await page.keyboard.press('End');
  await page.getByTestId('note-pagebreak').click();
  await expect(page.getByTestId('note-pages')).toHaveText(/sur 2$/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('note-pages')).toHaveText(/sur 1$/);

  // Thème encre : la feuille et le texte suivent (plus de texte clair sur papier blanc).
  await page.getByRole('button', { name: 'Thème encre' }).click();
  const sheetBg = await page.getByTestId('note-stack').locator('[aria-hidden="true"] > div').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(sheetBg).not.toBe('rgb(255, 255, 255)');
  const ink = await ed.evaluate((e) => getComputedStyle(e).color);
  expect(ink).not.toBe('rgb(17, 19, 24)');

  // Export PDF : les pages de l'éditeur, sur papier blanc.
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('tab-export').click();
  await page.getByTestId('tab-export-go').click();
  expect((await dl).suggestedFilename()).toBe('la-consigne-v1-note-d-intention-A4.pdf');
});
