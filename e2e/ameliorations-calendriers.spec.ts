import { expect, test, type Browser, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

/** Mars 2027 : le 1er est un lundi, loin d'aujourd'hui (rien ne dépend de la date du jour). */
const MONTH = '/#/calendar?seed=fiction&date=2027-03-10&view=month';

const row = (page: Page, name: string) => page.getByTestId('task-row').filter({ has: page.getByText(name, { exact: true }) });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function fromTemplate(page: Page, seed = 'fiction') {
  await page.goto(`/#/production?seed=${seed}`);
  await page.getByTestId('production-template').click();
  await expect(page.getByTestId('task-row')).toHaveCount(17);
}

async function newEvent(page: Page) {
  await page.getByTestId('event-add').click();
  const dlg = page.getByTestId('event-dialog');
  await expect(dlg).toBeVisible();
  return dlg;
}

test('rendez-vous : tournage de nuit sur deux jours, la fin suit le début', async ({ page }) => {
  await page.goto(MONTH);
  const dlg = await newEvent(page);
  await expect(dlg.getByTestId('event-date')).toHaveValue('2027-03-10');
  await dlg.getByTestId('event-title').fill('Tournage de nuit');
  // Changer le début décale la fin du même écart.
  await dlg.getByTestId('event-start').fill('15:00');
  await expect(dlg.getByTestId('event-end')).toHaveValue('16:00');
  await dlg.getByTestId('event-start').fill('20:00');
  await expect(dlg.getByTestId('event-end')).toHaveValue('21:00');
  await dlg.getByTestId('event-end').fill('02:00');
  await dlg.getByTestId('event-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('day-2027-03-10').getByTestId('calendar-item')).toContainText('Tournage de nuit');
  await expect(page.getByTestId('day-2027-03-11').getByTestId('calendar-item')).toContainText('Tournage de nuit');
  await page.getByRole('tab', { name: 'Semaine' }).click();
  await expect(page.getByTestId('calendar-week').getByTestId('calendar-item').filter({ hasText: 'Tournage de nuit' })).toHaveCount(2);
  // Relu tel quel : 20:00 – 02:00.
  await page.getByTestId('calendar-week').getByTestId('calendar-item').first().click();
  await expect(dlg.getByTestId('event-start')).toHaveValue('20:00');
  await expect(dlg.getByTestId('event-end')).toHaveValue('02:00');
});

test('rendez-vous sur plusieurs jours : nommé le premier jour, suite sans titre répété', async ({ page }) => {
  await page.goto(MONTH);
  const dlg = await newEvent(page);
  await dlg.getByTestId('event-title').fill('Repérages Bretagne');
  await dlg.getByTestId('event-date').fill('2027-03-08');
  await dlg.getByTestId('event-allday').check();
  await dlg.getByLabel('Dernier jour').fill('2027-03-11');
  await dlg.getByTestId('event-save').click();
  const first = page.getByTestId('day-2027-03-08').getByTestId('calendar-item');
  await expect(first).toHaveText('Repérages Bretagne');
  for (const d of ['09', '10', '11']) {
    const it = page.getByTestId(`day-2027-03-${d}`).getByTestId('calendar-item');
    await expect(it).toHaveText('');
    await expect(it).toHaveAttribute('aria-label', 'Repérages Bretagne');
  }
  await expect(page.getByTestId('day-2027-03-12').getByTestId('calendar-item')).toHaveCount(0);
});

test('vue Mois : glisser un rendez-vous d’un jour à l’autre, Échap annule, Ctrl+Z le ramène', async ({ page }) => {
  await page.goto(MONTH);
  const dlg = await newEvent(page);
  await dlg.getByTestId('event-title').fill('Lecture');
  await dlg.getByTestId('event-start').fill('14:00');
  await dlg.getByTestId('event-save').click();
  const item = (d: string) => page.getByTestId(`day-2027-03-${d}`).getByTestId('calendar-item');
  const drag = async (to: string, escape = false) => {
    const a = (await item('10').boundingBox())!;
    const b = (await page.getByTestId(`day-2027-03-${to}`).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    if (escape) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  // Échap : rien ne bouge, et la fenêtre ne s'ouvre pas.
  await drag('13', true);
  await expect(item('10')).toContainText('Lecture');
  await expect(dlg).toBeHidden();
  await drag('13');
  await expect(item('10')).toHaveCount(0);
  await expect(item('13')).toContainText('Lecture');
  await expect(item('13')).toContainText('14:00');
  await expect(dlg).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(item('10')).toContainText('Lecture');
  // Un simple clic ouvre toujours la fenêtre.
  await item('10').click();
  await expect(dlg.getByTestId('event-title')).toHaveValue('Lecture');
});

test('fenêtre d’un rendez-vous : saisie gardée au clic à côté, focus piégé puis rendu', async ({ page }) => {
  await page.goto(MONTH);
  // Sans saisie, un clic à côté ferme.
  let dlg = await newEvent(page);
  await page.mouse.click(5, 5);
  await expect(dlg).toBeHidden();
  // Avec une saisie, il ne ferme pas ; Échap, si.
  dlg = await newEvent(page);
  await dlg.getByTestId('event-title').fill('Lecture');
  await page.mouse.click(5, 5);
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('event-title')).toHaveValue('Lecture');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  // Au clavier : Tab reste dans la fenêtre, Échap rend le focus au bouton « + ».
  await page.getByTestId('event-add').focus();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab');
    expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('event-add')).toBeFocused();
});

test('vue Semaine sur téléphone : en-têtes des jours sans chevauchement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/calendar?seed=fiction&date=2027-03-10&view=week');
  const heads = page.getByTestId('calendar-week').locator('button[aria-label*="2027"]');
  await expect(heads).toHaveCount(7);
  const boxes: Array<{ x: number; width: number }> = [];
  for (let i = 0; i < 7; i++) {
    const h = heads.nth(i);
    expect(await h.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    boxes.push((await h.boundingBox())!);
  }
  for (let i = 1; i < 7; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 0.5);
});

test('vue Année : jours de tournage marqués, export .ics au nom commun', async ({ page }) => {
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  await page.getByLabel('Date du jour 1').fill('2027-03-10');
  await page.evaluate(() => void (window.location.hash = '#/calendar?date=2027-03-10&view=year'));
  await expect(page.getByTestId('calendar-year')).toBeVisible();
  await expect(page.getByTestId('year-2027-03-10')).toHaveAttribute('aria-label', /, jour de tournage$/);
  await expect(page.getByTestId('year-2027-03-12')).not.toHaveAttribute('aria-label', /tournage/);
  const dl = page.waitForEvent('download');
  await page.getByTestId('calendar-ics').click();
  expect((await dl).suggestedFilename()).toBe('rav3-v3-calendrier.ics');
});

// --- Frise de production ---------------------------------------------------------------------------

test('frise : Échap annule le glisser d’une barre', async ({ page }) => {
  await fromTemplate(page);
  const before = await field(page, 'Début : Casting').inputValue();
  const id = await page.evaluate(() => {
    const doc = (window as unknown as { __ds: { doc: () => { production: { phases: Array<{ tasks: Array<{ id: string; name: string }> }> } } } }).__ds.doc();
    return doc.production.phases.flatMap((p) => p.tasks).find((t) => t.name === 'Casting')!.id;
  });
  const bar = page.locator(`[data-testid="gantt-bar"][data-task="${id}"]`);
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(field(page, 'Début : Casting')).toHaveValue(before);
  expect((await bar.boundingBox())!.x).toBeCloseTo(box.x, 0);
});

test('frise : menu au clavier (flèches, Tab), Renommer, fermé quand la frise défile', async ({ page }) => {
  await fromTemplate(page);
  const btn = page.getByRole('button', { name: 'Actions : Casting' });
  await btn.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByTestId('production-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Renommer' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Ajouter une étape' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Supprimer' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Renommer' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Supprimer' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await expect(btn).toBeFocused();

  // Renommer, au clavier seulement ; Ctrl+Z rétablit.
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'Renommer' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('name-input')).toBeFocused();
  await page.keyboard.type('Casting enfants');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Casting enfants')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'Casting')).toHaveCount(1);

  // La frise défile : le menu, détaché de sa ligne, se ferme ; sa propre liste peut défiler.
  await row(page, 'Casting').hover();
  await row(page, 'Casting').getByTestId('row-menu').click();
  await expect(menu).toBeVisible();
  await page.getByTestId('gantt').evaluate((el) => (el.scrollLeft += 200));
  await expect(menu).toHaveCount(0);
  await row(page, 'Casting').hover();
  await row(page, 'Casting').getByTestId('row-menu').click();
  await page.getByTestId('menu-deps').click();
  await page
    .getByTestId('dep-option')
    .first()
    .evaluate((el) => el.parentElement!.parentElement!.dispatchEvent(new Event('scroll')));
  await expect(menu).toBeVisible();
});

test('frise : une coquille de date ou de durée ne l’étire pas', async ({ page }) => {
  await fromTemplate(page);
  const gantt = page.getByTestId('gantt');
  const width = await gantt.evaluate((el) => el.scrollWidth);
  const end = await field(page, 'Fin : Mixage').inputValue();
  await field(page, 'Fin : Mixage').fill('21/05/2207');
  await field(page, 'Fin : Mixage').press('Enter');
  await expect(field(page, 'Fin : Mixage')).toHaveValue(end);
  const days = await field(page, 'Durée en jours : Mixage').inputValue();
  await field(page, 'Durée en jours : Mixage').fill('200000');
  await field(page, 'Durée en jours : Mixage').press('Enter');
  await expect(field(page, 'Durée en jours : Mixage')).toHaveValue(days);
  expect(await gantt.evaluate((el) => el.scrollWidth)).toBe(width);
});

test('frise : export au nom commun', async ({ page }) => {
  await fromTemplate(page, 'rav3');
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('tab-export').click();
  await page.getByTestId('tab-export-panel').getByText('iCalendar', { exact: true }).click();
  await page.getByTestId('tab-export-go').click();
  expect((await dl).suggestedFilename()).toBe('rav3-v3-calendrier-de-production.ics');
});

test('frise sur écran tactile : le bouton « … » est visible', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await fromTemplate(page);
  const btn = page.getByTestId('row-menu').first();
  expect(await btn.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await btn.tap();
  await expect(page.getByTestId('production-menu')).toBeVisible();
  await ctx.close();
});

// --- Lecture seule -----------------------------------------------------------------------------------

test.describe('calendrier partagé en lecture seule', () => {
  // Serveur de mise en relation local, sur un port propre à ce fichier.
  const PORT = 9187;
  let server: ReturnType<typeof PeerServer> | null = null;
  test.beforeAll(() => {
    server = PeerServer({ port: PORT, path: '/', host: '127.0.0.1' });
  });
  test.afterAll(() => {
    (server as unknown as { close?: () => void } | null)?.close?.();
  });
  async function participant(browser: Browser): Promise<Page> {
    const ctx = await browser.newContext();
    await ctx.addInitScript((port) => localStorage.setItem('ds-peer-server', `localhost:${port}`), PORT);
    return ctx.newPage();
  }

  test('un rendez-vous s’ouvre pour être lu, rien ne s’écrit', async ({ browser }) => {
    const host = await participant(browser);
    await host.goto('/#/calendar?seed=rav3&date=2027-03-10&view=month');
    const dlg = host.getByTestId('event-dialog');
    await host.getByTestId('event-add').click();
    await dlg.getByTestId('event-title').fill('Réunion décors');
    await dlg.getByLabel('Note').fill('12 rue des Lilas');
    await dlg.getByTestId('event-save').click();
    await host.evaluate(() => void (window.location.hash = '#/grid'));
    await host.getByTestId('share-button').click();
    await host.getByText('Lire seulement').click();
    await host.getByTestId('share-start').click();
    const link = await host.getByTestId('share-link').textContent();
    const password = await host.getByTestId('share-password').textContent();
    const guest = await participant(browser);
    await guest.goto(link!);
    await guest.getByLabel('Votre nom').fill('Léo');
    await guest.getByLabel('Mot de passe').fill(password!);
    await guest.getByTestId('join-go').click();
    await expect(guest.getByTestId('guest-banner')).toContainText('lecture seule');
    await guest.evaluate(() => void (window.location.hash = '#/calendar?date=2027-03-10&view=month'));
    await guest.getByTestId('day-2027-03-10').getByTestId('calendar-item').click();
    const g = guest.getByTestId('event-dialog');
    await expect(g).toBeVisible();
    await expect(g.getByTestId('event-title')).toHaveValue('Réunion décors');
    await expect(g.getByTestId('event-title')).toBeDisabled();
    await expect(g.getByLabel('Note')).toHaveValue('12 rue des Lilas');
    await expect(g.getByTestId('event-save')).toHaveCount(0);
    await expect(g.getByTestId('event-delete')).toHaveCount(0);
    await g.getByTestId('event-close').click();
    await expect(g).toBeHidden();
    await host.getByTestId('share-stop').click();
  });
});
