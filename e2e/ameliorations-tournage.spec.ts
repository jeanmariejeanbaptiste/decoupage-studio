import { expect, test, type Page } from '@playwright/test';

async function suggested(page: Page) {
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  await expect(page.getByTestId('band-1')).toBeVisible();
}

test('feuille de service : jour dans l’adresse, flèches, dates courtes', async ({ page }) => {
  await suggested(page);
  await page.getByLabel('Date du jour 1').fill('2026-11-16');
  await page.getByTestId('callsheet-link-2').click();
  await expect(page).toHaveURL(/#\/callsheet\?day=2$/);
  const sheet = page.getByTestId('callsheet');
  await expect(sheet).toContainText('Jour 2');
  const pick = page.getByLabel('Jour de tournage');
  await expect(pick).toHaveValue('2');
  await expect(pick.locator('option').first()).toHaveText('Jour 1 · lun. 16 nov.');
  await page.getByRole('button', { name: 'Jour précédent' }).click();
  await expect(pick).toHaveValue('1');
  await expect(page).toHaveURL(/#\/callsheet\?day=1$/);
  await expect(page.getByRole('button', { name: 'Jour précédent' })).toBeDisabled();
  await expect(sheet).toContainText('lundi 16 novembre 2026');
  // Jusqu'au dernier jour : « Jour suivant » se désactive.
  const count = await pick.locator('option').count();
  for (let i = 1; i < count; i++) await page.getByRole('button', { name: 'Jour suivant' }).click();
  await expect(pick).toHaveValue(String(count));
  await expect(page.getByRole('button', { name: 'Jour suivant' })).toBeDisabled();
  // Rechargement : le jour reste ; un jour inconnu retombe sur le premier.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Jour de tournage')).toHaveValue(String(count));
  await page.goto('/#/callsheet?day=99');
  await expect(page.getByLabel('Jour de tournage')).toHaveValue('1');
});

test('feuille de service : la colonne Séquence ne répète pas le décor', async ({ page }) => {
  await suggested(page);
  await page.getByTestId('callsheet-link-1').click();
  const rows = page.getByTestId('itinerary').locator('tbody tr').filter({ has: page.getByTestId('stop-sequence') });
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const decor = ((await rows.nth(i).locator('td').nth(1).locator('strong').textContent()) ?? '').trim().toUpperCase();
    const seq = ((await rows.nth(i).getByTestId('stop-sequence').textContent()) ?? '').toUpperCase();
    expect(seq).toMatch(/^\d+/);
    if (decor) expect(seq.includes(decor)).toBe(false);
  }
});

test('emploi du temps : Entrée place à la suite, retirer garde le plan dans son jour', async ({ page }) => {
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('add-day').click();
  await page.getByLabel('Rendez-vous du jour 1').fill('08:00');
  await page.getByTestId('timeline-toggle-1').click();
  const tl = page.getByTestId('timeline-1');
  await tl.getByTestId('pool-shot').first().focus();
  await page.keyboard.press('Enter');
  await expect(tl.getByTestId('timeline-block')).toHaveCount(1);
  await expect(tl.getByTestId('timeline-block')).toContainText('08:00–08:30');
  await tl.getByTestId('pool-shot').first().dblclick();
  await expect(tl.getByTestId('timeline-block')).toHaveCount(2);
  await expect(tl.getByTestId('timeline-block').nth(1)).toContainText('08:30–09:00');
  // Le plan est du jour 1 : sa bande compte 2 plans ; le retirer de l'emploi du temps l'y laisse.
  const strip = page.getByTestId('band-1').getByTestId('strip');
  await expect(strip).toHaveCount(1);
  await expect(strip).toContainText('2 / 6 pl.');
  const pool = await tl.getByTestId('pool-shot').count();
  await tl.getByTestId('timeline-block').nth(1).hover();
  await tl.getByTestId('timeline-block').nth(1).getByRole('button', { name: 'Retirer de l’emploi du temps' }).click();
  await expect(tl.getByTestId('timeline-block')).toHaveCount(1);
  await expect(strip).toContainText('2 / 6 pl.');
  await expect(tl.getByTestId('pool-shot')).toHaveCount(pool + 1);
});

test('emploi du temps : la grille couvre un rendez-vous matinal', async ({ page }) => {
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('add-day').click();
  await page.getByTestId('timeline-toggle-1').click();
  await expect(page.getByTestId('slot-07:00')).toBeVisible();
  await expect(page.getByTestId('slot-05:30')).toHaveCount(0);
  await page.getByLabel('Rendez-vous du jour 1').fill('05:30');
  await expect(page.getByTestId('slot-05:30')).toBeVisible();
  // L'amplitude saisie, elle, ne change pas.
  await expect(page.getByLabel('Début de journée')).toHaveValue('07:00');
});

test('plan de travail : jour daté au lendemain, capacité retenue, libellés distincts', async ({ page }) => {
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('add-day').click();
  await page.getByLabel('Date du jour 1').fill('2026-10-24');
  await page.getByTestId('add-day').click();
  await expect(page.getByLabel('Date du jour 2')).toHaveValue('2026-10-25');
  // Un jour seulement daté se supprime sans confirmation.
  await page.getByLabel('Supprimer le jour 2').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('band-2')).toHaveCount(0);

  await page.getByLabel('Plans par jour au maximum').fill('12');
  await page.getByTestId('callsheet-link-1').click();
  await expect(page.getByTestId('callsheet')).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Plans par jour au maximum')).toHaveValue('12');

  await page.getByTestId('suggest-schedule').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Répartir' }).click();
  await expect(page.getByRole('button', { name: 'Détail des plans de la séquence 2', exact: true })).toHaveCount(1);
  await page.getByTestId('add-banner-1').selectOption('repas');
  await page.getByTestId('add-banner-1').selectOption('pause');
  await expect(page.getByRole('button', { name: 'Avancer : Repas', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reculer : Pause', exact: true })).toHaveCount(1);
});

test('lecture seule : changer de jour et déplier une bande restent possibles', async ({ page }) => {
  await suggested(page);
  await page.getByTestId('callsheet-link-1').click();
  await page.evaluate(() => document.documentElement.setAttribute('data-readonly', ''));
  await page.getByRole('button', { name: 'Jour suivant' }).click();
  await expect(page.getByTestId('callsheet')).toContainText('Jour 2');
  await page.getByLabel('Jour de tournage').click({ trial: true });
  await page.goto('/#/schedule');
  await page.evaluate(() => document.documentElement.setAttribute('data-readonly', ''));
  const toggle = page.getByRole('button', { name: 'Détail des plans de la séquence 1', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('callsheet-link-1')).toBeVisible();
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const theme of ['papier', 'encre']) {
    test(`plan de travail et feuille lisibles à 390 px (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ds-theme', t), theme);
      await suggested(page);
      await expect(page.getByTestId('add-day')).toBeInViewport();
      // En-tête du jour : « Jour 1 » sur une ligne.
      const title = page.getByTestId('band-1').locator('strong').first();
      const box = (await title.boundingBox())!;
      expect(box.height).toBeLessThan(40);
      // Bandes : l'intitulé ne chevauche pas l'horaire.
      await page.getByLabel('Rendez-vous du jour 1').fill('07:30');
      const strips = page.getByTestId('band-1').getByTestId('strip');
      const fits = (el: Element) => el.scrollWidth <= el.clientWidth + 1;
      expect(await strips.count()).toBeGreaterThan(0);
      for (let i = 0; i < (await strips.count()); i++) {
        const label = strips.nth(i).locator('[class*="label"]').first();
        expect(await label.evaluate(fits)).toBe(true);
        const a = (await label.boundingBox())!;
        const w = (await strips.nth(i).locator('[class*="when"]').first().boundingBox())!;
        expect(a.x + a.width <= w.x + 0.5).toBe(true);
      }
      // Bandeau : supprimable à cette largeur.
      await page.getByTestId('add-banner-1').selectOption('repas');
      await page.getByRole('button', { name: 'Supprimer : Repas' }).click();
      await expect(page.getByTestId('banner')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      await page.getByTestId('callsheet-link-1').click();
      const sheet = page.getByTestId('callsheet');
      for (const name of ['Début du repas', 'Fin du repas']) expect((await sheet.getByLabel(name).boundingBox())!.width).toBeGreaterThanOrEqual(90);
      const row = sheet.getByTestId('itinerary').locator('tbody tr').first();
      await expect(row.locator('td').first()).toContainText('07:30');
      expect(await row.locator('td').first().evaluate(fits)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  }
});
