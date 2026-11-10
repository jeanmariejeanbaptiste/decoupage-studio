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

test('note : Surligner est une bascule', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  const ed = page.getByTestId('note-editor');
  const hl = page.getByTestId('note-highlight');
  await ed.locator('blockquote').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await expect(hl).toHaveAttribute('aria-pressed', 'false');
  await hl.click();
  await expect(ed.locator('blockquote [style*="background-color"]')).not.toHaveCount(0);
  await expect(hl).toHaveAttribute('aria-pressed', 'true');
  await hl.click();
  await expect(ed.locator('blockquote [style*="background-color"]')).toHaveCount(0);
  await expect(hl).toHaveAttribute('aria-pressed', 'false');
});

for (const zoom of [100, 60])
test(`note : un titre ne reste jamais seul en bas de page (zoom ${zoom} %)`, async ({ page }) => {
  await page.addInitScript((z) => localStorage.setItem('ds-note-zoom', String(z)), zoom);
  await page.goto('/#/intention?seed=fiction');
  await expect(page.getByTestId('note-editor').locator('h1')).toHaveText('La Consigne');
  const res = await page.evaluate(() => {
    const ed = document.querySelector<HTMLElement>('[data-testid="note-editor"]')!;
    const out: { k: number; h: number; p: number }[] = [];
    for (let k = 28; k <= 48; k++) {
      ed.innerHTML = Array.from({ length: k }, (_, i) => `<p>Ligne ${i + 1}</p>`).join('') + '<h2>Titre de partie</h2><p>Premier paragraphe de la partie.</p>';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      // Feuilles posées par React après coup : on compte depuis la première (A4 + 24 px d'intervalle).
      const r0 = document.querySelector('[data-testid="note-stack"] [aria-hidden="true"] > div')!.getBoundingClientRect();
      const stepPx = r0.height * (1 + 24 / ((297 * 96) / 25.4));
      const pg = (e: Element) => Math.floor((e.getBoundingClientRect().top - r0.top) / stepPx);
      out.push({ k, h: pg(ed.querySelector('h2')!), p: pg(ed.querySelector('h2 + p')!) });
    }
    return out;
  });
  expect(res.filter((r) => r.h !== r.p || r.h < 0)).toEqual([]);
  // Le cas s'est bien présenté : le titre passe en page 2 avec son texte.
  expect(res.some((r) => r.h === 1)).toBe(true);
  expect(res.some((r) => r.h === 0)).toBe(true);
});

test('note : écran étroit, la page s’ajuste à la largeur et la barre d’état tient sur une ligne', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/intention?seed=fiction');
  const stack = page.getByTestId('note-stack');
  await expect(page.getByTestId('note-editor').locator('h1')).toHaveText('La Consigne');
  const m = await stack.evaluate((s) => {
    const sc = s.parentElement!;
    return { w: s.getBoundingClientRect().width, cw: sc.clientWidth, sw: sc.scrollWidth };
  });
  expect(m.w).toBeLessThanOrEqual(m.cw);
  expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
  const h = await page.getByTestId('note-pages').evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeLessThanOrEqual(18);
});

test('note : grand écran, zoom à 100 %', async ({ page }) => {
  await page.goto('/#/intention?seed=fiction');
  await expect(page.getByRole('slider', { name: 'Zoom' })).toHaveValue('100');
});
