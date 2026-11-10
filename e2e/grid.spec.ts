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

test('aperçu (auteur) : un clic sur une cellule n’ouvre pas de commentaire', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('toggle-print').click();
  await page.locator('tr[data-shot] td[data-col="value"]').first().click();
  await page.locator('tr[data-shot] td[data-col="action"]').first().click();
  await expect(page.getByTestId('comment-popover')).toHaveCount(0);
});

test('découpage : le nom d’une longue séquence reste visible tant qu’un de ses plans l’est', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto('/#/grid?seed=rav3');
  await expect(page.locator('tbody[data-seq]').first()).toBeVisible();
  const outside = await page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="grid"]')!;
    let sc = grid as HTMLElement | null;
    while (sc && !(sc.scrollHeight > sc.clientHeight && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const head = grid.querySelector('thead')!.getBoundingClientRect().height;
    const bad: string[] = [];
    for (const tb of Array.from(document.querySelectorAll('tbody[data-seq]'))) {
      const cell = tb.querySelector('td[class*="c_sequence"] > div');
      if (!cell || !sc) continue;
      for (let f = 0.1; f < 1; f += 0.2) {
        const r0 = tb.getBoundingClientRect();
        const s0 = sc.getBoundingClientRect();
        sc.scrollTop += r0.top + r0.height * f - (s0.top + head + (s0.height - head) / 2);
        await new Promise((r) => requestAnimationFrame(r));
        const s = sc.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        const t = tb.getBoundingClientRect();
        if (Math.min(s.bottom, t.bottom) - Math.max(s.top + head, t.top) < c.height + 20) continue;
        if (c.top < s.top + head - 1 || c.bottom > s.bottom + 1) bad.push(`${tb.getAttribute('data-seq')}@${f.toFixed(1)}`);
      }
    }
    return bad;
  });
  expect(outside).toEqual([]);
});
