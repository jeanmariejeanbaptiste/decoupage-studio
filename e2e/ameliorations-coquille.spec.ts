import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('tiroir du menu : le focus y entre, Échap le referme et rend le focus', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    const toggle = page.getByTestId('toggle-sidebar');
    await toggle.click();
    const aside = page.getByRole('complementary', { name: 'Étapes du projet' });
    await expect(aside).toBeVisible();
    await expect(aside.locator('[aria-current="page"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(aside).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('panneau du projet : accueil, thème et Rétablir à portée de main', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await expect(page.getByRole('button', { name: /^Rétablir/ })).toBeVisible();
    await page.getByTestId('project-menu').click();
    const panel = page.getByTestId('project-panel');
    await panel.getByRole('button', { name: 'Thème encre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'encre');
    await expect(panel.getByRole('button', { name: 'Enregistrer le fichier' })).toBeVisible();
    await panel.getByRole('button', { name: 'Tous les projets' }).click();
    await expect(page).toHaveURL(/#\/home/);
  });

  test('accueil : la suppression d’un projet reste visible sans survol', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await expect(page.getByTestId('mobile-cut')).toBeVisible();
    await page.goto('/#/home');
    const del = page.getByRole('button', { name: 'Supprimer La Consigne' });
    await expect(del).toHaveCSS('opacity', '1');
  });
});

test('accueil : la suppression n’apparaît qu’au survol sur ordinateur', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS).first()).toBeVisible();
  await page.goto('/#/home');
  await expect(page.getByRole('button', { name: 'Supprimer La Consigne' })).toHaveCSS('opacity', '0');
});

test('panneau du projet sur ordinateur : pas de doublon de la barre', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('project-menu').click();
  await expect(page.getByTestId('project-panel-phone')).toBeHidden();
});

test('palette : enregistrer tous les projets en .zip', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS).first()).toBeVisible();
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('tous les projets zip');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toMatch(/^decoupage-studio-\d{4}-\d{2}-\d{2}\.zip$/);
});

test('accueil : dupliquer un projet sans l’ouvrir', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS).first()).toBeVisible();
  await page.goto('/#/home');
  const list = page.getByTestId('project-list');
  await list.locator('li').first().hover();
  await page.getByRole('button', { name: 'Dupliquer La Consigne' }).click();
  await expect(list.locator('li')).toHaveCount(2);
  await expect(list).toContainText('La Consigne (copie)');
  await expect(page).toHaveURL(/#\/home/);
});

test('accueil : un projet créé dans un autre onglet apparaît sans recharger', async ({ page, context }) => {
  await page.goto('/#/home');
  await expect(page.getByTestId('home')).toBeVisible();
  const other = await context.newPage();
  await newProject(other, 'Venu d’ailleurs');
  await expect(page.getByTestId('project-list')).toContainText('Venu d’ailleurs');
});

test('accueil : un fichier .decoupage déposé sur la page s’ouvre', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
  });
  await page.goto('/#/grid?seed=fiction');
  await expect(page.locator(ROWS).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+s');
  const content = readFileSync(await (await download).path(), 'utf8');
  const file = JSON.parse(content) as { doc: Doc };
  file.doc.project.id = 'depose-1';
  file.doc.project.title = 'Déposé';
  await page.goto('/#/home');
  await expect(page.getByTestId('home')).toBeVisible();
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'depose.decoupage', { type: 'application/json' }));
    const home = document.querySelector('[data-testid="home"]')!;
    home.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    home.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, JSON.stringify(file));
  await expect(page).toHaveURL(/#\/grid/);
  await expect(page.getByTestId('project-menu')).toContainText('Déposé');
});
