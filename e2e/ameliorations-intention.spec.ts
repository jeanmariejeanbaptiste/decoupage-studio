import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Un paragraphe vide à la fin de la note, curseur dedans. */
async function newParagraph(page: Page) {
  const ed = page.getByTestId('note-editor');
  await ed.locator('blockquote').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByTestId('note-style').selectOption('p');
  return ed;
}

test('note : la frappe en attente reste quand on change de page sans quitter l’éditeur', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = page.getByTestId('note-editor');
  await ed.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' GARDE');
  await page.evaluate(() => (location.hash = '#/scenario'));
  await expect(page.getByTestId('note-editor')).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/intention'));
  await expect(page.getByTestId('note-editor').locator('h1')).toHaveText('La Consigne GARDE');
});

test('note : un corps choisi au curseur s’applique à la frappe suivante', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = await newParagraph(page);
  await page.getByTestId('note-size').selectOption('14');
  await page.keyboard.type('abc');
  const span = ed.locator('span', { hasText: 'abc' });
  await expect(span).toHaveCSS('font-size', /^18\.6\d*px$/);
  await expect(ed.locator('font')).toHaveCount(0);
  // Le corps affiché suit, avec une virgule pour les demi-points.
  await expect(page.getByTestId('note-size')).toHaveValue('14');
  await ed.locator('h1').click();
  await page.getByTestId('note-style').selectOption('h3');
  await expect(page.getByTestId('note-size').locator('option:checked')).toHaveText('12,5');
});

test('note : rétablir survit à un déplacement du curseur', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = page.getByTestId('note-editor');
  await ed.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' XY');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(ed.locator('h1')).toHaveText('La Consigne');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(ed.locator('h1')).toHaveText('La Consigne XY');
});

test('note : Tab et Maj+Tab changent le niveau d’une puce sans quitter l’éditeur, et rien ne se perd', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = page.getByTestId('note-editor');
  await ed.locator('ul > li').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(ed.locator('ul > li > ul > li', { hasText: 'Nuit sur le parvis' })).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('note-editor');
  await page.keyboard.type(' X');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Y');
  await page.keyboard.press('Shift+Tab');
  // Y revient au premier niveau, entre la sous-liste et la puce suivante (jamais une puce dans une puce).
  await expect(ed.locator('li li')).toHaveCount(1);
  await expect(ed.locator('ul').first().locator(':scope > li')).toHaveText([/verrière\.\s*Nuit sur le parvis.* X$/, 'Y', /La roue/]);
  // Enregistré tel quel : la sous-liste survit au nettoyage.
  await ed.locator('h1').click();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).not.toBe('note-editor');
  await page.evaluate(() => (location.hash = '#/scenario'));
  await page.evaluate(() => (location.hash = '#/intention'));
  await expect(page.getByTestId('note-editor').locator('ul > li > ul > li', { hasText: 'Nuit sur le parvis' })).toHaveCount(1);
  await expect(page.getByTestId('note-editor').locator('ul > li', { hasText: /^Y$/ })).toHaveCount(1);
});

test('note : export Word avec polices de secours', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  await newParagraph(page);
  await page.keyboard.type('Passage');
  await page.keyboard.press('Shift+Home');
  await page.getByTestId('note-font').selectOption('Inter Variable');
  const dl = page.waitForEvent('download');
  await page.getByTestId('tab-export').click();
  await page.getByText('Word', { exact: true }).click();
  await page.getByTestId('tab-export-go').click();
  const content = readFileSync(await (await dl).path(), 'utf8');
  expect(content).toContain('Passage');
  expect(content).not.toContain("'Inter Variable'");
});

test('note : une capture collée s’insère, réduite, et garde ses proportions dans le Word', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = await newParagraph(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 1500;
    const g = c.getContext('2d')!;
    g.fillStyle = '#888';
    g.fillRect(0, 0, 3000, 1500);
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'capture.png', { type: 'image/png' }));
    document.querySelector('[data-testid="note-editor"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const img = ed.locator('img[data-blob]');
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(2400);
  const dl = page.waitForEvent('download');
  await page.getByTestId('tab-export').click();
  await page.getByText('Word', { exact: true }).click();
  await page.getByTestId('tab-export-go').click();
  const content = readFileSync(await (await dl).path(), 'utf8');
  expect(content).toMatch(/<img [^>]*width="605" height="303"/);
  expect(content).toContain('src="data:image/');
});
