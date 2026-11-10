import { expect, test, type Page } from '@playwright/test';

/** Retour aux vérifications sans recharger (le projet modifié reste ouvert). */
async function toChecks(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/checks'));
  await expect(page.getByTestId('issue').first()).toBeVisible();
}

const group = (page: Page, code: string) => page.getByTestId(`check-group-${code}`);

type Doc = { project: { sequenceIds: string[] }; sequences: Record<string, { shotIds: string[] }>; shots: Record<string, { subject: string; value: string; movement: string[] }> };
const docOf = (page: Page) => page.evaluate(() => (window as unknown as { __ds: { doc: () => Doc } }).__ds.doc());

async function editCell(page: Page, cell: string, text: string) {
  await page.locator(`[data-cell="${cell}"]`).click();
  if (text) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.press('Delete');
  }
}

test('vérifications : chaque contrôle de plan mène à sa cellule, mise en évidence', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await expect(page.locator('[data-cell="0:value"]')).toBeVisible();
  // Plan 1.1 sans valeur, 1.2 sans sujet, 1.3 en drone et zoom sans focale d'arrivée, 1.4 en angles incompatibles.
  await editCell(page, '0:value', '');
  await editCell(page, '1:subject', '');
  await page.locator('[data-cell="2:movement"]').click();
  await page.keyboard.press('Delete');
  await editCell(page, '2:movement', 'Drone, Zoom avant');
  await page.locator('[data-cell="3:angle"]').click();
  await page.keyboard.press('Delete');
  await editCell(page, '3:angle', 'Face, Dos');
  await expect.poll(async () => Object.values((await docOf(page)).shots).some((s) => s.movement.includes('Drone'))).toBe(true);

  const cases: Array<[code: string, row: number, cols: string[]]> = [
    ['missing-value', 0, ['value']],
    ['missing-subject', 1, ['subject']],
    ['zoom-focal', 2, ['focal']],
    ['drone', 2, ['movement']],
    ['angle-conflict', 3, ['angle']],
  ];
  for (const [code, row, cols] of cases) {
    await toChecks(page);
    const line = group(page, code).getByTestId('issue').first();
    await expect(line).toContainText('1.' + (row + 1));
    // Toute la ligne est le lien (au clavier aussi), nommée par son contenu ; « Ignorer » est une autre commande.
    const go = line.getByTestId('check-go');
    await expect(go).toHaveAccessibleName(new RegExp('^1\\.' + (row + 1) + ' '));
    await expect(go).toHaveAccessibleDescription('Ouvre le plan dans le découpage');
    await expect(go).not.toHaveAttribute('title');
    await go.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/grid$/);
    for (const c of cols) await expect(page.locator(`[data-cell="${row}:${c}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-cell="${row}:${cols[0]}"]`)).toHaveAttribute('data-flash', '');
    // La grille reprend le clavier sur la cellule choisie.
    await expect(page.getByTestId('grid')).toBeFocused();
  }
  // La mise en évidence est brève.
  await expect(page.locator('[data-flash]')).toHaveCount(0, { timeout: 4000 });
});

test('vérifications : une série de sautes en une ligne, ses plans sélectionnés ; la barre du découpage reste en vue', async ({ page }) => {
  await page.goto('/#/checks?seed=rav3');
  // Six plans identiques (4.1 à 4.6) : une ligne, pas cinq.
  const jumps = group(page, 'jump-cut').getByTestId('issue');
  await expect(jumps).toHaveCount(2);
  const loge = jumps.first();
  await expect(loge).toContainText(/4\.1\s–\s4\.6/);
  await expect(loge).toContainText('6 plans');
  await expect(loge.getByTestId('check-go')).toHaveAccessibleDescription('Sélectionne ces plans dans le découpage');
  await loge.getByTestId('check-go').click();
  await expect(page).toHaveURL(/#\/grid$/);
  const d = await docOf(page);
  const ids = d.sequences[d.project.sequenceIds[3]].shotIds;
  for (const id of ids) {
    const row = page.locator(`tr[data-shot="${id}"]`);
    await expect(row).toHaveAttribute('data-flash', '');
    for (const c of ['subject', 'value', 'angle', 'movement']) await expect(row.locator(`[data-cell$=":${c}"]`)).toHaveAttribute('aria-selected', 'true');
  }
  // Seule la grille a défilé : la barre d'outils du découpage est toujours là.
  await expect(page.getByRole('toolbar', { name: 'Outils de la grille' })).toBeInViewport();
  await expect(page.locator(`tr[data-shot="${ids[0]}"]`)).toBeInViewport();
});

test('vérifications : séquence sans plan, le clavier va sur son « + », jamais sur un plan hors de vue', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByRole('button', { name: 'Insérer une séquence après la séquence 7' }).click({ force: true });
  // La nouvelle séquence naît avec un plan : on le retire.
  await page.locator('tbody[data-seq]').last().getByTestId('delete-shot').click({ force: true });
  await expect(page.locator('[data-empty-seq]')).toHaveCount(1);
  // Une sélection ancienne, en haut de la grille.
  await page.locator('[data-cell="0:subject"]').click();
  const before = JSON.stringify((await docOf(page)).shots);
  await toChecks(page);
  const empty = group(page, 'empty-sequence').getByTestId('issue');
  await expect(empty).toHaveCount(1);
  // Sans libellé : un tiret estompé, pas un blanc.
  await expect(empty).toContainText('8');
  await expect(empty).toContainText('—');
  await expect(empty.getByTestId('check-go')).toHaveAccessibleDescription('Ouvre la séquence dans le découpage');
  await empty.getByTestId('check-go').click();
  const target = page.locator('[data-empty-seq]');
  await expect(target).toHaveAttribute('data-flash', '');
  await expect(target).toBeInViewport();
  const add = target.getByTestId('add-first-shot');
  await expect(add).toBeFocused();
  // Une frappe ne part pas dans un autre plan.
  await page.keyboard.type('ZZZ');
  await expect(page.getByTestId('cell-editor')).toHaveCount(0);
  expect(JSON.stringify((await docOf(page)).shots)).toBe(before);
  // Entrée : le premier plan de la séquence.
  await add.press('Enter');
  await expect(page.locator('[data-empty-seq]')).toHaveCount(0);
});

test('vérifications : écart de durée vers la cellule Estimée du registre, rappel vers le mouvement, ignorer à part', async ({ page }) => {
  await page.goto('/#/checks?seed=fiction');
  await expect(group(page, 'stabilizer-safety')).toContainText('prévoir un machiniste de sécurité');
  const gap = group(page, 'estimate-gap').getByTestId('issue').first();
  await expect(gap.getByTestId('check-go')).toHaveAccessibleDescription('Ouvre la durée estimée dans le registre');
  await gap.getByTestId('check-go').click();
  await expect(page).toHaveURL(/#\/registry\?tab=sequences$/);
  const cell = page.locator('tr[data-seq-row] > td[data-col="est"][data-flash]');
  await expect(cell).toHaveCount(1);
  await expect(page.locator('tr[data-seq-row]', { has: page.locator('td[data-col="est"][data-flash]') })).toContainText('PARVIS DE LA GARE');
  // Le clavier est sur la cellule : Entrée la modifie, Échap y revient.
  await expect(cell).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('tr[data-seq-row] > td[data-col="est"] input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('tr[data-seq-row] > td[data-col="est"]:focus')).toHaveCount(1);

  await toChecks(page);
  await group(page, 'stabilizer-safety').getByTestId('issue').first().getByTestId('check-go').click();
  await expect(page).toHaveURL(/#\/grid$/);
  await expect(page.locator('[data-cell$=":movement"][data-flash]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-cell$=":movement"][data-flash]')).toContainText(/Épaule|Steadicam/i);

  // Ignorer ne navigue pas ; le clavier passe à la ligne suivante.
  await toChecks(page);
  const lines = page.getByTestId('issue');
  const n = await lines.count();
  const second = (await lines.nth(1).getByTestId('check-go').textContent()) ?? '';
  await lines.first().getByRole('button', { name: /^Ignorer / }).click();
  await expect(page).toHaveURL(/#\/checks$/);
  await expect(lines).toHaveCount(n - 1);
  await expect(page.locator('[data-check-go]:focus')).toHaveText(second);
  // Dernière ligne ignorée : le clavier va sur « Rétablir ».
  for (let k = n - 1; k > 0; k--) await page.locator('[data-check-go]:focus').locator('..').getByRole('button', { name: /^Ignorer / }).click();
  await expect(page.locator('[data-restore]')).toBeFocused();
});

test('vérifications : institutionnel, ouverture et fermeture sans plan large mènent au plan, même depuis l’onglet Interview', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Instit');
  await page.getByRole('radio', { name: 'Institutionnel' }).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('view-table').click();
  await page.getByTestId('create-first').click();
  await editCell(page, '0:subject', 'Atelier');
  await editCell(page, '0:value', 'Insert');
  await page.getByTestId('tab-interview').click();
  for (const code of ['doc-open-wide', 'doc-close-wide']) {
    await toChecks(page);
    // Un seul plan d'illustration : la fermeture le vise aussi.
    await group(page, code).getByTestId('check-go').filter({ hasText: '1.1' }).click();
    await expect(page.getByTestId('grid')).toBeVisible();
    await expect(page.locator('[data-cell="0:value"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-cell="0:value"]')).toHaveAttribute('data-flash', '');
    await page.getByTestId('tab-interview').click();
  }
});

test('vérifications : un plan d’interview mène à sa caméra dans la fiche, où il se règle', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-panel').getByText('Institutionnel', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-interview').click();
  const itw = page.getByTestId('interview');
  await itw.getByTestId('setup-placement').getByRole('radio', { name: 'Séq. 2' }).click();
  await expect(itw).toContainText('Plans 2.9A, 2.9B');
  // Caméra B sans valeur de cadre.
  const camB = itw.locator('[data-itw-cam]').nth(1);
  await camB.getByLabel('Valeur', { exact: true }).fill('');
  await camB.getByLabel('Valeur', { exact: true }).press('Tab');
  await page.getByTestId('view-table').click();

  await toChecks(page);
  const line = group(page, 'missing-value').getByTestId('check-go').filter({ hasText: '2.9B' });
  await expect(line).toHaveAccessibleDescription('Ouvre la caméra dans la fiche d’interview');
  await line.click();
  await expect(page.getByTestId('interview')).toBeVisible();
  const cam = page.getByTestId('interview').locator('[data-itw-cam]').nth(1);
  await expect(cam).toHaveAttribute('data-flash', '');
  await expect(cam.getByLabel('Valeur', { exact: true })).toBeFocused();
});

test('vérifications sur téléphone : le plan visé s’ouvre, pas le premier', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/checks?seed=fiction');
  const line = group(page, 'stabilizer-safety').getByTestId('check-go').first();
  const place = (await line.locator('span').first().innerText()).trim();
  expect(place).not.toBe('1.1');
  await line.click();
  await expect(page.getByTestId('mobile-cut')).toBeVisible();
  await expect(page.locator('[data-mobile-title]')).toContainText(`Plan ${place}`);
  await expect(page.locator('[data-testid="mobile-cut"] [data-field="movement"]')).toHaveAttribute('data-flash', '');
});
