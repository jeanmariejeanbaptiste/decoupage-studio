import { expect, test, type Page } from '@playwright/test';

/** Retour aux vérifications sans recharger (le projet modifié reste ouvert). */
async function toChecks(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/checks'));
  await expect(page.getByTestId('issue').first()).toBeVisible();
}

const group = (page: Page, code: string) => page.getByTestId(`check-group-${code}`);

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
  // Plan 1.1 sans valeur, 1.2 sans sujet, 1.3 en drone et zoom sans focale d'arrivée.
  await editCell(page, '0:value', '');
  await editCell(page, '1:subject', '');
  await page.locator('[data-cell="2:movement"]').click();
  await page.keyboard.press('Delete');
  await editCell(page, '2:movement', 'Drone, Zoom avant');
  await expect.poll(() => page.evaluate(() => Object.values((window as unknown as { __ds: { doc: () => { shots: Record<string, { movement: string[] }> } } }).__ds.doc().shots).some((s) => s.movement.includes('Drone')))).toBe(true);

  const cases: Array<[code: string, row: number, cols: string[]]> = [
    ['missing-value', 0, ['value']],
    ['missing-subject', 1, ['subject']],
    ['zoom-focal', 2, ['focal']],
    ['drone', 2, ['movement']],
  ];
  for (const [code, row, cols] of cases) {
    await toChecks(page);
    const line = group(page, code).getByTestId('issue').first();
    await expect(line).toContainText('1.' + (row + 1));
    // Toute la ligne est le lien (au clavier aussi) ; « Ignorer » est une autre commande.
    const go = line.getByRole('button', { name: /^Ouvrir le plan/ });
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

test('vérifications : saute (ligne entière) et séquence vide', async ({ page }) => {
  await page.goto('/#/checks?seed=rav3');
  // Saute : les colonnes comparées du plan 4.2 sont sélectionnées, la ligne est mise en évidence.
  const jump = group(page, 'jump-cut').getByTestId('issue').first();
  await expect(jump).toContainText('4.2');
  await expect(jump).toContainText('Identique au plan 4.1');
  await jump.getByRole('button', { name: 'Ouvrir le plan 4.2 dans le découpage' }).click();
  await expect(page).toHaveURL(/#\/grid$/);
  const shot = await page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { project: { sequenceIds: string[] }; sequences: Record<string, { shotIds: string[] }> } } }).__ds.doc();
    return d.sequences[d.project.sequenceIds[3]].shotIds[1];
  });
  const row = page.locator(`tr[data-shot="${shot}"]`);
  await expect(row).toHaveAttribute('data-flash', '');
  for (const c of ['subject', 'value', 'angle', 'movement']) await expect(row.locator(`[data-cell$=":${c}"]`)).toHaveAttribute('aria-selected', 'true');

  // Séquence vide : la séquence elle-même dans le découpage.
  await page.getByRole('button', { name: 'Insérer une séquence après la séquence 7' }).click({ force: true });
  // La nouvelle séquence naît avec un plan : on le retire.
  await page.locator('tbody[data-seq]').last().getByTestId('delete-shot').click({ force: true });
  await expect(page.locator('[data-empty-seq]')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await toChecks(page);
  const empty = group(page, 'empty-sequence').getByTestId('issue');
  await expect(empty).toHaveCount(1);
  await empty.getByRole('button', { name: 'Ouvrir la séquence 8 dans le découpage' }).click();
  await expect(page.locator('[data-empty-seq]')).toHaveAttribute('data-flash', '');
  await expect(page.locator('[data-empty-seq]')).toBeInViewport();
});

test('vérifications : écart de durée vers le registre, rappel vers le mouvement, ignorer à part', async ({ page }) => {
  await page.goto('/#/checks?seed=fiction');
  await expect(group(page, 'stabilizer-safety')).toContainText('prévoir un machiniste de sécurité');
  const gap = group(page, 'estimate-gap').getByTestId('issue').first();
  await gap.getByRole('button', { name: /^Ouvrir la séquence \d+ dans le registre$/ }).click();
  await expect(page).toHaveURL(/#\/registry\?tab=sequences$/);
  await expect(page.locator('tr[data-seq-row][data-flash]')).toHaveCount(1);
  await expect(page.locator('tr[data-seq-row][data-flash]')).toContainText('PARVIS DE LA GARE');

  await toChecks(page);
  await group(page, 'stabilizer-safety').getByTestId('issue').first().getByRole('button', { name: /^Ouvrir le plan/ }).click();
  await expect(page).toHaveURL(/#\/grid$/);
  await expect(page.locator('[data-cell$=":movement"][data-flash]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-cell$=":movement"][data-flash]')).toContainText(/Épaule|Steadicam/i);

  // Ignorer ne navigue pas.
  await toChecks(page);
  const lines = page.getByTestId('issue');
  const n = await lines.count();
  await lines.first().getByRole('button', { name: 'Ignorer ici' }).click();
  await expect(page).toHaveURL(/#\/checks$/);
  await expect(lines).toHaveCount(n - 1);
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
    await group(page, code).getByRole('button', { name: 'Ouvrir le plan 1.1 dans le découpage' }).click();
    await expect(page.getByTestId('grid')).toBeVisible();
    await expect(page.locator('[data-cell="0:value"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-cell="0:value"]')).toHaveAttribute('data-flash', '');
    await page.getByTestId('tab-interview').click();
  }
});
