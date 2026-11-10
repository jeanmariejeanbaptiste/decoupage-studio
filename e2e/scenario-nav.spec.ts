import { expect, test } from '@playwright/test';

test('Scénario : quatre onglets, adresse, Précédent, clavier, sous-page retenue', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const tabs = page.getByRole('tablist', { name: 'Scénario' });
  const tab = (name: string) => tabs.getByRole('tab', { name });
  await expect(tabs.getByRole('tab')).toHaveText(['Séquencier', 'Texte', 'Découpage', 'Statistiques']);
  // Premier passage, texte présent : le texte.
  await expect(tab('Texte')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('script-editor')).toBeVisible();
  await expect(page.getByTestId('scenario-chrono')).toBeVisible();

  await tab('Séquencier').click();
  await expect(page).toHaveURL(/#\/scenario\?view=outline$/);
  await expect(page.getByTestId('outline-view')).toContainText('INT. GARE — HALL - JOUR');
  await expect(page.getByTestId('scenario-status')).toContainText('3 séquences · 1 page');
  await expect(page.getByTestId('scenario-side-toggle')).toHaveCount(0);

  await tab('Statistiques').click();
  await expect(page).toHaveURL(/view=stats&report=summary$/);
  await expect(page.getByTestId('scenario-status')).toHaveCount(0);
  await page.getByTestId('report-structure').click();
  await expect(page).toHaveURL(/view=stats&report=structure$/);
  await expect(page.getByTestId('script-reports').getByRole('img', { name: 'Structure de l’histoire' })).toBeVisible();

  // Précédent : la sous-page d'avant, puis celle d'avant encore.
  await page.goBack();
  await expect(tab('Séquencier')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(tab('Texte')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('script-editor')).toBeVisible();

  // Motif tablist : ← → déplacent le focus, Entrée ouvre.
  await tab('Texte').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Découpage')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Séquencier')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Statistiques')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scenario-cut')).toBeVisible();
  await expect(page.getByTestId('scenario-status')).toHaveText('3 séquences · 11 plans');

  // L'adresse sans sous-page rouvre la dernière ; le rapport aussi est retenu.
  await page.evaluate(() => void (location.hash = '#/grid'));
  await page.evaluate(() => void (location.hash = '#/scenario'));
  await expect(tab('Découpage')).toHaveAttribute('aria-selected', 'true');
  await tab('Statistiques').click();
  await expect(page).toHaveURL(/report=structure$/);

  // Palette ⌘K : les quatre sous-pages.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
  await page.keyboard.type('scénario : séquencier');
  await expect(palette.getByRole('option').first()).toContainText('Scénario : Séquencier');
  await page.keyboard.press('Enter');
  await expect(tab('Séquencier')).toHaveAttribute('aria-selected', 'true');
});

test('Scénario : ?seq=N mène au texte ou à la ligne du séquencier, puis l’adresse redevient simple', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await expect(page.getByTestId('script-editor')).toBeVisible();
  await page.evaluate(() => void (location.hash = '#/scenario?seq=3'));
  await expect(page).toHaveURL(/#\/scenario\?view=script$/);
  await expect(page.getByTestId('scenario-outline').locator('[aria-current]')).toContainText('PARVIS');
  await page.evaluate(() => void (location.hash = '#/scenario?view=outline&seq=2'));
  await expect(page).toHaveURL(/#\/scenario\?view=outline$/);
  await expect(page.locator('[data-outline-n="2"]')).toBeInViewport();
});

test('Scénario : un projet sans texte s’ouvre sur le séquencier ; logline et synopsis y sont', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Vide');
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('create-first')).toBeVisible();
  await page.evaluate(() => void (location.hash = '#/scenario'));
  await expect(page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Séquencier' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Logline')).toBeVisible();
  await expect(page.getByLabel('Synopsis')).toBeVisible();
  await expect(page.getByTestId('scenario-status')).toContainText('0 séquence · 1 page');
});

test('Scénario : importer depuis le menu des versions, le seul endroit', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await expect(page.getByTestId('script-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Importer/ })).toHaveCount(0);
  await page.getByTestId('version-switcher').click();
  const item = page.getByTestId('version-import');
  await expect(item).toHaveText('Importer un texte…');
  const chooser = page.waitForEvent('filechooser');
  await item.click();
  await (await chooser).setFiles({ name: 'toit.fountain', mimeType: 'text/plain', buffer: Buffer.from('EXT. TOIT - AUBE\n\nLe soleil se lève.\n') });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Créer la V2' }).click();
  await expect(page.getByTestId('version-switcher')).toHaveText('V2');
  await expect(page.getByTestId('script-editor')).toContainText('Le soleil se lève.');
  // Hors de la page Scénario (Découpage technique), le menu des versions n'importe pas.
  await page.evaluate(() => void (location.hash = '#/grid'));
  await page.getByTestId('version-switcher').click();
  await expect(page.getByTestId('version-new')).toBeVisible();
  await expect(page.getByTestId('version-import')).toHaveCount(0);
});

test('Scénario : menu Exporter à sections fixes', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const open = async () => {
    await page.getByTestId('scenario-export').click();
    return page.getByTestId('scenario-export-menu');
  };
  let menu = await open();
  await expect(menu.getByRole('group')).toHaveCount(1);
  await expect(menu.getByRole('group', { name: 'Scénario' }).getByRole('menuitem')).toHaveText(['PDF', 'Word', 'Final Draft', 'Fountain', 'Images']);
  const dl = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'Fountain' }).click();
  expect((await dl).suggestedFilename()).toBe('La Consigne.fountain');
  await expect(menu).toHaveCount(0);
  // Statistiques : en dernier, et seulement sur sa sous-page ; le PNG pour les graphiques seulement.
  await page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Statistiques' }).click();
  await page.getByTestId('report-summary').click();
  menu = await open();
  await expect(menu.getByRole('group')).toHaveCount(2);
  await expect(menu.getByRole('group').last()).toHaveAccessibleName('Statistiques');
  await expect(menu.getByRole('group', { name: 'Statistiques' }).getByRole('menuitem')).toHaveText(['Rapport affiché (PDF)']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByTestId('report-activity').click();
  menu = await open();
  await expect(menu.getByRole('group', { name: 'Statistiques' }).getByRole('menuitem')).toHaveText(['Rapport affiché (PDF)', 'Graphique (PNG)']);
});

test('Scénario : panneau aéré, largeur réglable et retenue, double-clic pour revenir', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const side = page.getByLabel('Navigation du scénario');
  await expect(page.getByRole('tablist', { name: 'Panneau' }).getByRole('tab')).toHaveText(['Séquences', 'Personnages', 'Décors', 'Recherche']);
  const width = async () => Math.round((await side.boundingBox())!.width);
  expect(await width()).toBe(344);
  const grip = page.getByTestId('scenario-side-resize');
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 400, box.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(480);
  await page.reload();
  expect(await width()).toBe(480);
  await grip.dblclick();
  expect(await width()).toBe(344);
  // Découpage : les plans directement, sans onglet.
  await page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Découpage' }).click();
  await expect(page.getByRole('tablist', { name: 'Panneau' })).toHaveCount(0);
  await expect(page.getByTestId('scenario-shot').first()).toBeVisible();
});
