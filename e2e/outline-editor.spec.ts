import { expect, test, type Page } from '@playwright/test';

/** Remplace le texte du projet par un import Fountain. */
async function importScript(page: Page, src: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('version-import').click();
  await (await chooser).setFiles({ name: 'texte.fountain', mimeType: 'text/plain', buffer: Buffer.from(src) });
  await page.getByRole('alertdialog').getByRole('button', { name: /^Remplacer/ }).click();
}

const scenario = (page: Page) => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario);

const sheets = (page: Page) => page.getByTestId('script-stack').locator(':scope > [aria-hidden="true"] > div');

test('Texte : la phrase de chaque séquence est hors de la feuille et ne change pas les pages', async ({ page }) => {
  const scene = (k: number, phrase: boolean) =>
    `INT. LIEU ${k} - JOUR\n\n${phrase ? `= Une phrase de séquence assez longue pour occuper plusieurs lignes à l’écran si on la montrait. [[ds:etape=${(k % 22) + 1}]]\n\n` : ''}${'Une action qui occupe quelques lignes de la page imprimée. '.repeat(4)}\n\nLÉA\nUne réplique.\n\n`;
  const src = (phrase: boolean) => `Title: Phrases\n\nUne ouverture.\n\n${Array.from({ length: 30 }, (_, k) => scene(k + 1, phrase)).join('')}`;
  await page.goto('/#/scenario?seed=fiction');
  await importScript(page, src(false));
  const headings = page.getByTestId('script-editor').locator('[data-type="heading"]');
  await expect(headings).toHaveCount(30);
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  const sheetsWithout = await sheets(page).count();
  const lastAction = page.getByTestId('script-editor').locator('[data-type="action"]').last();
  const top = await lastAction.evaluate((el) => (el as HTMLElement).offsetTop);
  // Même texte, avec une phrase sous chaque en-tête (reprises à l'import suivant, les phrases restent).
  await importScript(page, src(true));
  await expect(page.getByTestId('script-editor').getByText('Une phrase de séquence', { exact: false })).toHaveCount(30);
  await expect(page.getByTestId('script-editor').locator('[data-type="synopsis"]:visible')).toHaveCount(0);
  await expect(sheets(page)).toHaveCount(sheetsWithout);
  // La dernière action est à la même place, au pixel près : rien n'est réservé pour les phrases.
  expect(await lastAction.evaluate((el) => (el as HTMLElement).offsetTop)).toBe(top);
});

test('Texte : le curseur saute la phrase ; Entrée, ⌫, Suppr et la sélection la respectent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const src = 'INT. GARE - JOUR\n\n= Léa trouve la lettre. [[ds:etape=9;intrigue=B]]\n\nLéa entre.\n\nEXT. QUAI - NUIT\n\nLe train part.\n';
  await page.goto('/#/scenario?seed=fiction');
  await importScript(page, src);
  const editor = page.getByTestId('script-editor');
  const heading = editor.locator('[data-type="heading"]').first();
  const action = editor.locator('[data-type="action"]').filter({ hasText: /^Léa entre/ });
  await expect(editor.locator('[data-type="synopsis"]')).toBeHidden();
  const phrase = '= Léa trouve la lettre. [[ds:etape=9;intrigue=B]]';

  // ↓ depuis l'en-tête : la frappe arrive dans l'action, jamais dans la phrase.
  await heading.click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('X');
  await expect.poll(() => scenario(page)).toContain('Léa entre.X');
  // ↑ depuis l'action : retour à l'en-tête.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type(' Y');
  await expect.poll(() => scenario(page)).toContain('INT. GARE - JOUR Y\n\n' + phrase + '\n\nLéa entre.X');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');

  // Entrée en fin d'en-tête : le nouveau paragraphe vient après la phrase, qui le reste.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Un homme attend.');
  await expect.poll(() => scenario(page)).toContain(`INT. GARE - JOUR\n\n${phrase}\n\nUn homme attend.\n\nLéa entre.X`);
  await expect(editor.locator('[data-type="synopsis"]')).toBeHidden();

  // ⌫ en début de paragraphe : il rejoint le paragraphe visible précédent (l'en-tête), la phrase reste.
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => scenario(page)).toContain(`INT. GARE - JOUR UN HOMME ATTEND.\n\n${phrase}\n\nLéa entre.X`);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => scenario(page)).toContain(`INT. GARE - JOUR\n\n${phrase}\n\nUn homme attend.`);

  // Suppr en fin d'en-tête : même chose, dans l'autre sens.
  await heading.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => scenario(page)).toContain(`INT. GARE - JOUR UN HOMME ATTEND.\n\n${phrase}\n\nLéa entre.X`);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => scenario(page)).toContain(`INT. GARE - JOUR\n\n${phrase}\n\nUn homme attend.`);

  // Une sélection qui englobe la phrase l'emporte avec le reste ; annuler la rend.
  await editor.evaluate((root) => {
    const h = root.querySelector('[data-type="heading"]')!.firstChild!;
    const a = Array.from(root.querySelectorAll('[data-type="action"]')).find((x) => x.textContent === 'Un homme attend.')!.firstChild!;
    (root as HTMLElement).focus();
    const r = document.createRange();
    r.setStart(h, 9);
    r.setEnd(a, 3);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await expect.poll(() => scenario(page)).toContain('INT. GAREHOMME ATTEND.\n\nLéa entre.X');
  expect(await scenario(page)).not.toContain('Léa trouve');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => scenario(page)).toContain(`INT. GARE - JOUR\n\n${phrase}\n\nUn homme attend.`);
  await expect(editor.locator('[data-type="synopsis"]')).toBeHidden();

  // L'en-tête vidé n'en est plus un : la phrase redevient un résumé visible, rien ne se perd.
  await heading.click();
  await editor.evaluate((root) => {
    const h = root.querySelector('[data-type="heading"]')!;
    const r = document.createRange();
    r.selectNodeContents(h);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await expect(editor.locator('[data-type="synopsis"]')).toBeVisible();
  await expect(editor.locator('[data-type="synopsis"]')).toHaveText('Léa trouve la lettre.');
  await expect.poll(() => scenario(page)).toContain(phrase);
  await expect(action).toHaveText('Léa entre.X');
  expect(errors).toEqual([]);
});
