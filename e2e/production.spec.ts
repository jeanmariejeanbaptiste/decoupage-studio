import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const pad = (n: number) => String(n).padStart(2, '0');
const fr = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plusDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const row = (page: Page, name: string) => page.getByTestId('task-row').filter({ has: page.getByText(name, { exact: true }) });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function tabExport(page: Page, format: string) {
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('tab-export').click();
  await page.getByTestId('tab-export-panel').getByText(format, { exact: true }).click();
  await page.getByTestId('tab-export-go').click();
  return dl;
}

async function fromTemplate(page: Page, seed = 'fiction') {
  await page.goto(`/#/production?seed=${seed}`);
  await page.getByTestId('production-template').click();
  await expect(page.getByTestId('task-row')).toHaveCount(17);
}

test('calendrier de production : modèle, dates au clavier, cascade, durée, renommer, annuler', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  // Entrée dans le menu latéral, avant « Calendrier ».
  const items = await page.locator('aside nav li').allInnerTexts();
  expect(items.indexOf('Calendrier de production')).toBe(items.indexOf('Calendrier') - 1);
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await expect(page).toHaveURL(/#\/production/);
  await page.getByTestId('production-template').click();
  await expect(page.getByTestId('phase-row')).toHaveCount(5);
  await expect(page.getByTestId('gantt-bar').first()).toBeVisible();
  await expect(page.getByTestId('gantt-milestone')).toHaveCount(4);
  await expect(page.getByTestId('gantt-link').first()).toBeAttached();

  // Le développement commence aujourd'hui.
  const today = new Date();
  await expect(field(page, 'Début : Version de tournage du scénario')).toHaveValue(fr(today));

  // Repérages repoussés au clavier : les Décors (qui en dépendent) suivent ; le Casting ne bouge pas.
  const decors = await field(page, 'Début : Décors').inputValue();
  const casting = await field(page, 'Début : Casting').inputValue();
  const start = plusDays(today, 60);
  await field(page, 'Début : Repérages').fill(fr(start));
  await field(page, 'Début : Repérages').press('Enter');
  await expect(field(page, 'Début : Repérages')).toHaveValue(fr(start));
  await expect(field(page, 'Fin : Repérages')).toHaveValue(fr(plusDays(start, 20)));
  await expect(field(page, 'Début : Décors')).toHaveValue(fr(plusDays(start, 21)));
  expect(await field(page, 'Début : Décors').inputValue()).not.toBe(decors);
  await expect(field(page, 'Début : Casting')).toHaveValue(casting);

  // Date invalide : refusée, la valeur revient.
  await field(page, 'Fin : Casting').fill('31/02/2027');
  await field(page, 'Fin : Casting').press('Enter');
  await expect(field(page, 'Début : Casting')).toHaveValue(casting);
  await expect(field(page, 'Durée en jours : Casting')).toHaveValue('28');

  // Durée : la fin suit.
  await field(page, 'Durée en jours : Casting').fill('10');
  await field(page, 'Durée en jours : Casting').press('Enter');
  await expect(field(page, 'Durée en jours : Casting')).toHaveValue('10');

  // Renommer au double-clic.
  await row(page, 'Matériel').getByText('Matériel', { exact: true }).dblclick();
  await page.getByTestId('name-input').fill('Matériel caméra');
  await page.getByTestId('name-input').press('Enter');
  await expect(row(page, 'Matériel caméra')).toHaveCount(1);

  // ⌘Z annule pas à pas.
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'Matériel')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(field(page, 'Durée en jours : Casting')).toHaveValue('28');

  // Case « fait » ; données gardées après rechargement.
  await row(page, 'Casting').getByRole('checkbox').check();
  await expect(row(page, 'Casting')).toHaveClass(/isDone/);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(row(page, 'Casting').getByRole('checkbox')).toBeChecked();
  await expect(field(page, 'Début : Repérages')).toHaveValue(fr(start));
});

test('calendrier de production : menu, dépendances, glisser une barre, ranger une ligne, zoom', async ({ page }) => {
  await fromTemplate(page);

  // Ajouter une étape après « Décors », puis la faire dépendre des Costumes (qui finissent plus tard).
  await row(page, 'Décors').hover();
  await row(page, 'Décors').getByTestId('row-menu').click();
  await page.getByRole('menuitem', { name: 'Ajouter une étape' }).click();
  await page.getByTestId('name-input').fill('Accessoires');
  await page.getByTestId('name-input').press('Enter');
  await expect(page.getByTestId('task-row').nth(5)).toContainText('Accessoires');
  await row(page, 'Accessoires').hover();
  await row(page, 'Accessoires').getByTestId('row-menu').click();
  await page.getByTestId('menu-deps').click();
  const links = await page.getByTestId('gantt-link').count();
  await page.getByTestId('dep-option').filter({ hasText: 'Costumes' }).click();
  await expect(page.getByTestId('gantt-link')).toHaveCount(links + 1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('production-menu')).toHaveCount(0);
  // Elle est poussée après la fin des Costumes.
  const castEnd = await field(page, 'Fin : Costumes').inputValue();
  const [d, m, y] = castEnd.split('/').map(Number);
  await expect(field(page, 'Début : Accessoires')).toHaveValue(fr(plusDays(new Date(y, m - 1, d), 1)));

  // Un jalon, puis on le supprime.
  await row(page, 'Accessoires').hover();
  await row(page, 'Accessoires').getByTestId('row-menu').click();
  await page.getByRole('menuitem', { name: 'Ajouter un jalon' }).click();
  await page.getByTestId('name-input').press('Enter');
  await expect(page.getByTestId('gantt-milestone')).toHaveCount(5);
  await row(page, 'Nouveau jalon').hover();
  await row(page, 'Nouveau jalon').getByTestId('row-menu').click();
  await page.getByTestId('menu-remove').click();
  await expect(page.getByTestId('gantt-milestone')).toHaveCount(4);

  // Zoom : semaines, puis retour.
  await expect(page.getByTestId('zoom-label')).toHaveText('Mois');
  await page.getByTestId('zoom-in').click();
  await expect(page.getByTestId('zoom-label')).toHaveText('Semaines');
  await expect(page.getByTestId('zoom-in')).toBeDisabled();

  // Glisser la barre « Costumes » d'une semaine (22 px par jour) : Maquillage ne bouge pas, Tournage suit si besoin.
  const before = await field(page, 'Début : Costumes').inputValue();
  const id = await page.evaluate(() => {
    const doc = (window as unknown as { __ds: { doc: () => { production: { phases: Array<{ tasks: Array<{ id: string; name: string }> }> } } } }).__ds.doc();
    return doc.production.phases.flatMap((p) => p.tasks).find((t) => t.name === 'Costumes')!.id;
  });
  const costumes = page.locator(`[data-testid="gantt-bar"][data-task="${id}"]`);
  await costumes.scrollIntoViewIfNeeded();
  const box = (await costumes.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 154, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const [bd, bm, by] = before.split('/').map(Number);
  await expect(field(page, 'Début : Costumes')).toHaveValue(fr(plusDays(new Date(by, bm - 1, bd), 7)));
  await page.getByTestId('zoom-out').click();
  await page.getByTestId('zoom-out').click();
  await expect(page.getByTestId('zoom-label')).toHaveText('Trimestres');

  // Ranger « Matériel » en tête de la Préparation, par la poignée.
  const grip = row(page, 'Matériel').locator('[data-edit]').first();
  const target = row(page, 'Repérages');
  await row(page, 'Matériel').hover();
  const g = (await grip.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 4, t.y + 6, { steps: 6 });
  await page.mouse.up();
  const names = await page.getByTestId('task-row').allInnerTexts();
  expect(names.findIndex((n) => n.includes('Matériel'))).toBe(2);

  // Replier une phase : ses lignes disparaissent, le repli est retenu.
  await page.getByRole('button', { name: 'Replier Postproduction' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(11);
  await page.waitForTimeout(800);
  await page.goto('/#/production');
  await page.reload();
  await expect(page.getByTestId('task-row')).toHaveCount(11);
});

test('calendrier de production : tournage lié au plan de travail, calendrier, export .ics', async ({ page }) => {
  const first = plusDays(new Date(), 200);
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  await page.getByLabel('Date du jour 1').fill(iso(first));
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await page.getByTestId('production-template').click();

  // L'étape Tournage suit le jour daté : début en lecture seule, marquée comme liée ; tant que tout
  // le plan de travail n'est pas daté, elle garde sa durée prévue et sa fin reste réglable.
  const shoot = row(page, 'Tournage');
  await expect(shoot.getByTestId('linked-mark')).toBeVisible();
  await expect(shoot.getByTestId('linked-mark')).toHaveAttribute('title', /^Suit le plan de travail \(1 jour sur \d+ datés\)$/);
  await expect(shoot).toContainText(fr(first));
  await expect(field(page, 'Début : Tournage')).toHaveCount(0);
  await expect(field(page, 'Durée en jours : Tournage')).toHaveValue('25');
  // La préparation se cale juste avant.
  await expect(field(page, 'Fin : Costumes')).toHaveValue(fr(plusDays(first, -1)));

  // Le plan de travail change : l'étape suit, la postproduction est poussée.
  await page.getByRole('button', { name: 'Plan de travail' }).click();
  const last = plusDays(first, 30);
  await page.getByTestId('add-day').click();
  const days = page.locator('input[aria-label^="Date du jour"]');
  await days.last().fill(iso(last));
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await expect(field(page, 'Fin : Tournage')).toHaveValue(fr(last));
  await expect(field(page, 'Début : Montage image')).toHaveValue(fr(plusDays(last, 1)));
  const dcp = await field(page, 'Date : Copie de diffusion').inputValue();

  // Une date erronée, puis corrigée, dans le plan de travail : la postproduction revient avec le tournage.
  await page.getByRole('button', { name: 'Plan de travail' }).click();
  const wrong = new Date(last.getFullYear() + 46, last.getMonth(), last.getDate());
  await days.last().fill(iso(wrong));
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await expect(field(page, 'Début : Montage image')).toHaveValue(fr(plusDays(wrong, 1)));
  await page.getByRole('button', { name: 'Plan de travail' }).click();
  await days.last().fill(iso(last));
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await expect(field(page, 'Début : Montage image')).toHaveValue(fr(plusDays(last, 1)));
  await expect(field(page, 'Date : Copie de diffusion')).toHaveValue(dcp);

  // Délier : les dates redeviennent modifiables.
  await row(page, 'Tournage').hover();
  const trigger = row(page, 'Tournage').getByTestId('row-menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(page.getByTestId('menu-link')).toHaveText('Délier du plan de travail');
  await page.getByTestId('menu-link').click();
  await expect(field(page, 'Début : Tournage')).toHaveValue(fr(first));
  await expect(trigger).toBeFocused();
  await row(page, 'Repérages').hover();
  await row(page, 'Repérages').getByTestId('row-menu').click();
  await expect(page.getByTestId('menu-link')).toHaveText('Lier au plan de travail');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Repérages').getByTestId('row-menu')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'Tournage').getByTestId('linked-mark')).toBeVisible();

  // Export .ics des étapes.
  const download = await tabExport(page, 'iCalendar');
  expect(download.suggestedFilename()).toMatch(/calendrier-de-production\.ics$/);
  const ics = readFileSync((await download.path())!, 'utf8');
  expect(ics).toContain('SUMMARY:◆ Scénario verrouillé');
  expect(ics).toContain('SUMMARY:Tournage');
  // PDF paysage.
  const pdf = await tabExport(page, 'PDF');
  expect(pdf.suggestedFilename()).toMatch(/calendrier-de-production.*paysage\.pdf$/);
  expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe('%PDF-');

  // Dans le calendrier : pastilles en lecture seule qui ramènent au calendrier de production.
  await page.getByRole('button', { name: 'Calendrier', exact: true }).click();
  await page.getByRole('tab', { name: 'Mois' }).click();
  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  const now = new Date();
  for (let i = (first.getFullYear() - now.getFullYear()) * 12 + first.getMonth() - now.getMonth(); i > 0; i--) await page.getByRole('button', { name: 'Suivant' }).click();
  // Le jour de tournage y est une fois : l'étape liée ne le double pas.
  const cell = page.getByTestId(`day-${iso(first)}`);
  await expect(cell.getByTestId('calendar-item').first()).toContainText('Jour 1');
  await expect(cell.getByRole('button', { name: 'Tournage', exact: true })).toHaveCount(0);
  const chip = page.getByTestId(`day-${iso(plusDays(first, -1))}`).getByRole('button', { name: 'Costumes' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/#\/production\?task=/);
  await expect(page.getByTestId('event-dialog')).toHaveCount(0);
});

test('calendrier de production : rendez-vous du calendrier sur la frise, lien vers le calendrier, tout effacer puis rétablir', async ({ page }) => {
  await fromTemplate(page);
  // Un rendez-vous au calendrier, dans dix jours : repéré sur la frise, un clic ouvre ce jour.
  const day = iso(plusDays(new Date(), 10));
  await page.getByRole('button', { name: 'Calendrier', exact: true }).click();
  await page.getByTestId('event-add').click();
  const dlg = page.getByTestId('event-dialog');
  await dlg.getByTestId('event-title').fill('Lecture à la table');
  await dlg.getByTestId('event-date').fill(day);
  await dlg.getByTestId('event-start').fill('10:00');
  await dlg.getByTestId('event-save').click();
  await expect(dlg).toBeHidden();
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  const mark = page.getByTestId('production-appointment');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute('title', 'Lecture à la table · 10:00');
  await mark.click();
  await expect(page).toHaveURL(new RegExp(`#/calendar\\?date=${day}`));
  // Et l'inverse : du calendrier de production au calendrier, sur la période des étapes.
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await page.getByTestId('production-to-calendar').click();
  await expect(page).toHaveURL(/#\/calendar\?date=\d{4}-\d{2}-\d{2}&view=month/);
  await expect(page.getByRole('tab', { name: 'Mois' })).toHaveAttribute('aria-selected', 'true');
  // Le modèle se retire d'un coup, après confirmation, et ⌘Z le rend.
  await page.getByRole('button', { name: 'Calendrier de production' }).click();
  await page.getByTestId('production-clear').click();
  await expect(page.getByRole('alertdialog')).not.toContainText('⌘');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
  await expect(page.getByTestId('production-template')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('task-row')).toHaveCount(17);
});
