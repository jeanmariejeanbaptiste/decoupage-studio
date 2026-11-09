import { expect, test } from '@playwright/test';

test('palette de commandes ⌘K', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('nouveau plan');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(54);
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('registre');
  await expect(palette.getByRole('option').first()).toContainText('Registre');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/registry/);
});

test('aide des raccourcis « ? » et thème encre', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="0:number"]').click();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Raccourcis clavier' });
  await expect(help).toContainText('Recopier vers le bas');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.getByRole('button', { name: 'Thème encre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'encre');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 17, 21)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'encre');
});

test('interface épurée : ni jauge, ni validation, ni intitulés de page ; menu latéral réduit en icônes', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  const step = page.getByRole('button', { name: /Découpage technique/ });
  const label = page.getByRole('navigation').getByText('Découpage technique', { exact: true });
  await expect(step).not.toContainText('%');
  await expect(page.getByText(/étape validée/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Valider l’étape' })).toHaveCount(0);
  await expect(page.locator('.page-title')).toHaveCount(0);
  await expect(label).toBeVisible();
  // Réduit : les icônes restent, avec leur nom pour l'infobulle et les lecteurs d'écran.
  await page.getByTestId('toggle-sidebar').click();
  await expect(label).toBeHidden();
  await expect(step).toBeVisible();
  await page.reload();
  await expect(label).toBeHidden();
  await step.click();
  await expect(page).toHaveURL(/#\/grid/);
  await page.getByTestId('toggle-sidebar').click();
  await expect(label).toBeVisible();
});

test('menu du projet : titre et format modifiables en haut de l’écran (la version se choisit dans le scénario et le découpage)', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('project-menu').click();
  const panel = page.getByTestId('project-panel');
  await panel.getByLabel('Titre').fill('La Consigne (montage)');
  await expect(panel.getByLabel('Version')).toHaveCount(0);
  // Les trois formats sont visibles en entier, sans défilement caché.
  const seg = panel.getByRole('radiogroup', { name: 'Format' });
  expect(await seg.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const segBox = (await seg.boundingBox())!;
  const instBox = (await seg.getByText('Institutionnel', { exact: true }).boundingBox())!;
  expect(instBox.x + instBox.width).toBeLessThanOrEqual(segBox.x + segBox.width + 1);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('project-menu')).toContainText('La Consigne (montage)');
  // Un seul pas d'annulation par champ, pas un par lettre.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('project-menu')).not.toContainText('(montage)');
});

test('paramètres : rien n’est appliqué avant « Enregistrer », « Annuler » revient en arrière', async ({ page }) => {
  await page.goto('/#/settings?seed=fiction&section=decoupage');
  const doc = () => page.evaluate(() => (window as unknown as { __ds: { doc: () => { project: { settings: { shotCodeFormat: string } } } } }).__ds.doc().project.settings.shotCodeFormat);
  await expect(page.getByTestId('settings-save')).toBeDisabled();
  await page.getByRole('radiogroup', { name: 'Code des plans' }).getByText('3D').click();
  await expect(page.getByTestId('settings-savebar')).toContainText('Modifications non enregistrées');
  expect(await doc()).toBe('{seq}.{shot}');
  await page.getByTestId('settings-cancel').click();
  await expect(page.getByRole('radiogroup', { name: 'Code des plans' }).getByRole('radio', { name: '3.4' })).toBeChecked();
  await page.getByRole('radiogroup', { name: 'Code des plans' }).getByText('3-4').click();
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-savebar')).toContainText('Enregistré');
  expect(await doc()).toBe('{seq}-{shot}');
  // Quitter la page sans enregistrer garde le travail.
  await page.getByRole('radiogroup', { name: 'Code des plans' }).getByText('3D').click();
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await expect(page.locator('[data-cell="0:number"]')).toBeVisible();
  expect(await doc()).toBe('{seq}{letter}');
});

test('paramètres : un brouillon de minutage cède au format changé dans le menu du projet ; Annuler remet la durée de la piste', async ({ page }) => {
  await page.goto('/#/settings?seed=fiction&section=minutage');
  const settings = () => page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { project: { format: string; settings: { tcMode: string } } } } }).__ds.doc();
    return [d.project.format, d.project.settings.tcMode];
  });
  const mode = page.getByRole('radiogroup', { name: 'Mode de TC' });
  await mode.getByText('Cumulatif').click();
  await mode.getByText('Durée de chaque plan').click();
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-panel').getByText('Clip', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-save')).toBeDisabled();
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await expect(page.getByTestId('track-bar')).toBeVisible();
  expect(await settings()).toEqual(['clip', 'piste']);

  await page.goto('/#/settings?seed=rav3&section=minutage');
  const track = page.getByLabel('Durée de la piste');
  const before = await track.inputValue();
  await track.fill('9:59');
  await page.getByTestId('settings-cancel').click();
  await expect(track).toHaveValue(before);
});

test('états vides et lien d’évitement', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByText('Aucun projet pour l’instant')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
});
