import { expect, test } from '@playwright/test';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthTitle = (d: Date) => {
  const m = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(d);
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
};

test('calendrier : mois, création, vues, aujourd’hui, modification', async ({ page }) => {
  const now = new Date();
  const today = iso(now);
  await page.goto('/#/calendar?seed=fiction');
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await expect(page.getByTestId('calendar-title')).toHaveText(monthTitle(now));

  // Création par « + » : le jour courant, une heure.
  await page.getByTestId('event-add').click();
  const dlg = page.getByTestId('event-dialog');
  await dlg.getByTestId('event-title').fill('Repérages lycée');
  await expect(dlg.getByTestId('event-date')).toHaveValue(today);
  await dlg.getByTestId('event-start').fill('14:00');
  await dlg.getByTestId('event-end').fill('16:00');
  await dlg.getByTestId('event-save').click();
  await expect(dlg).toBeHidden();
  const cell = page.getByTestId(`day-${today}`);
  await expect(cell.getByTestId('calendar-item')).toContainText('Repérages lycée');
  await expect(cell.getByTestId('calendar-item')).toContainText('14:00');

  // Vues Semaine, Jour, Année ; le choix est retenu.
  await page.getByRole('tab', { name: 'Semaine' }).click();
  await expect(page.getByTestId('calendar-week').getByTestId('calendar-item')).toContainText('Repérages lycée');
  await page.getByRole('tab', { name: 'Jour' }).click();
  await expect(page.getByTestId('calendar-day').getByTestId('calendar-item')).toContainText('Repérages lycée');
  await page.getByRole('tab', { name: 'Année' }).click();
  await expect(page.getByTestId('calendar-title')).toHaveText(String(now.getFullYear()));
  await page.getByTestId(`year-${today}`).click();
  await expect(page.getByTestId('calendar-day')).toBeVisible();

  // Période suivante, puis retour à aujourd'hui.
  await page.getByRole('tab', { name: 'Mois' }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByTestId('calendar-title')).not.toHaveText(monthTitle(now));
  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  await expect(page.getByTestId('calendar-title')).toHaveText(monthTitle(now));

  // Un clic sur une case vide crée ce jour-là ; un rendez-vous s'ouvre pour être modifié ou supprimé.
  const first = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() === 1 ? 2 : 1));
  await page.getByTestId(`day-${first}`).click({ position: { x: 20, y: 60 } });
  await expect(dlg.getByTestId('event-date')).toHaveValue(first);
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await cell.getByTestId('calendar-item').click();
  await expect(dlg.getByTestId('event-title')).toHaveValue('Repérages lycée');
  await dlg.getByTestId('event-delete').click();
  await expect(cell.getByTestId('calendar-item')).toHaveCount(0);

  // La vue choisie est retenue d'une visite à l'autre.
  await page.getByRole('tab', { name: 'Semaine' }).click();
  await page.reload();
  await expect(page.getByTestId('calendar-week')).toBeVisible();
});

test('calendrier : les jours datés du plan de travail y figurent et y mènent', async ({ page }) => {
  const today = iso(new Date());
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  await page.getByLabel('Date du jour 1').fill(today);
  await page.getByRole('button', { name: 'Calendrier' }).click();
  const pill = page.getByTestId(`day-${today}`).getByTestId('calendar-item');
  await expect(pill).toContainText('Jour 1');
  await pill.click();
  await expect(page).toHaveURL(/#\/schedule\?day=1/);
  await expect(page.getByTestId('band-1')).toBeInViewport();
});
