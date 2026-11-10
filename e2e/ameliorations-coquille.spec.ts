import { expect, test, type Page } from '@playwright/test';

const ROWS = '[data-testid="shot-row"]';
type Doc = { project: { id: string; title: string } };
const getDoc = () => (window as unknown as { __ds: { doc: () => unknown } }).__ds.doc() as Doc;

async function newProject(page: Page, title: string) {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill(title);
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('create-first')).toBeVisible();
}

test('assistant « Nouveau projet » : un double-clic ne crée qu’un projet', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await expect(page.getByRole('dialog', { name: 'Nouveau projet' })).toBeVisible();
  await page.getByLabel('Titre du projet').fill('Doublon');
  await page.getByTestId('wizard-next').dblclick();
  await expect(page).toHaveURL(/#\/grid/);
  await page.goto('/#/');
  await expect(page.getByTestId('project-list').locator('li')).toHaveCount(1);
});

test('démonstration : ?seed= quitte l’adresse, un rechargement garde les modifications', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/grid$/);
  await page.getByTestId('project-menu').click();
  const title = page.getByTestId('project-panel').getByLabel('Titre');
  await title.fill('Titre modifié');
  await title.press('Enter');
  await expect(page.getByTestId('save-status')).toHaveText('Enregistré dans le navigateur');
  await page.reload();
  await expect(page.getByTestId('project-menu')).toContainText('Titre modifié');
});

test('menu du projet : un titre vidé reprend le titre du projet', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('project-menu').click();
  const title = page.getByTestId('project-panel').getByLabel('Titre');
  await title.fill('');
  await title.press('Enter');
  await expect(title).toHaveValue('La Consigne');
  expect((await page.evaluate(getDoc)).project.title).toBe('La Consigne');
});

test('titre de l’onglet : projet et page ; l’application seule à l’accueil', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await expect(page).toHaveTitle('La Consigne — Scénario');
  await page.goto('/#/home');
  await expect(page).toHaveTitle('Découpage Studio');
});

test('thème encre posé avant le rendu, barre d’état accordée', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ds-theme', 'encre'));
  await page.goto('/#/grid?seed=fiction', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'encre');
  const color = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(await color()).toBe('#0f1115');
  await page.getByRole('button', { name: 'Thème papier' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'papier');
  await expect.poll(color).toBe('#ffffff');
});

test('palette et aide : le focus revient à la grille, une seule fenêtre à la fois', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-cell="1:subject"]')).toHaveAttribute('aria-selected', 'true');

  const help = page.getByRole('dialog', { name: 'Raccourcis clavier' });
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
  // ⌘Z derrière l'aide : rien ne change.
  const rows = await page.locator(ROWS).count();
  await page.keyboard.press('Control+k');
  await expect(help).toHaveCount(0);
  await expect(palette).toBeVisible();
  await page.keyboard.type('nouveau plan');
  await page.keyboard.press('Enter');
  await expect(page.locator(ROWS)).toHaveCount(rows + 1);
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator(ROWS)).toHaveCount(rows + 1);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-cell="1:subject"]')).toHaveAttribute('aria-selected', 'true');
});

test('palette : commandes de la page en tête, vocabulaire du découpage', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await expect(page).toHaveTitle('La Consigne — Scénario');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
  await expect(palette.getByRole('option').first()).toContainText('Aller à');
  await page.keyboard.press('Escape');
  await page.goto('/#/grid');
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+k');
  await expect(palette.getByRole('option').first()).toContainText('Nouveau plan sous le plan courant');
  await expect(palette.getByRole('option').first()).toContainText('Découpage');
  await expect(palette.getByRole('option', { name: /Tous les projets/ })).toHaveCount(1);
});

test('palette : passer d’un projet à l’autre', async ({ page }) => {
  await newProject(page, 'Premier film');
  await newProject(page, 'Second film');
  const before = (await page.evaluate(getDoc)).project.id;
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
  await expect(palette.getByRole('option', { name: /Second film/ })).toHaveCount(0);
  await page.keyboard.type('premier film');
  await expect(palette.getByRole('option').first()).toContainText('Ouvrir « Premier film »');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('project-menu')).toContainText('Premier film');
  expect((await page.evaluate(getDoc)).project.id).not.toBe(before);
});

test('thème et raccourcis suivis d’un onglet à l’autre', async ({ page, context }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS).first()).toBeVisible();
  const other = await context.newPage();
  await other.goto('/#/grid');
  await expect(other.locator(ROWS).first()).toBeVisible();
  await page.getByRole('button', { name: 'Thème encre' }).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'encre');
  await page.evaluate(() => localStorage.setItem('ds-shortcuts', JSON.stringify({ duplicate: 'Mod+J' })));
  await other.locator('[data-cell="0:subject"]').click();
  await other.keyboard.press('?');
  await expect(other.getByRole('dialog', { name: 'Raccourcis clavier' })).toContainText('⌘J');
});

test('raccourcis : une combinaison gardée par le navigateur est refusée', async ({ page }) => {
  await page.goto('/#/settings?seed=fiction');
  await page.getByTestId('settings-raccourcis').click();
  const btn = page.getByTestId('shortcut-newShot');
  await expect(btn).toHaveText('⌘↵');
  await btn.click();
  await page.keyboard.press('Control+t');
  await expect(page.getByText('⌘T est réservé par le navigateur.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(btn).toHaveText('⌘↵');
});
