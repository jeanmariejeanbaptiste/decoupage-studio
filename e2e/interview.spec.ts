import { expect, test } from '@playwright/test';

test('institutionnel : fiche d’interview, placée dans le découpage (lignes 1A, 1B), aperçus séparés', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Instit');
  await page.getByRole('radio', { name: 'Institutionnel' }).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('tab-interview').click();
  const itw = page.getByTestId('interview');
  await expect(itw).toContainText('Caméras');
  await itw.getByLabel('Nom', { exact: true }).fill('Claire Martin');
  await itw.getByLabel('Fonction (synthé)').fill('Directrice');
  await itw.getByLabel('Nom', { exact: true }).press('Tab');
  await itw.getByTestId('add-question').click();
  await itw.getByLabel('Question', { exact: true }).last().fill('Racontez-nous votre métier.');
  await itw.getByText('Lieu, lumière, son').click();
  await expect(itw.getByRole('button', { name: 'Claire Martin' })).toBeVisible();

  // Le cadre rejoint le découpage : une nouvelle séquence, un plan par caméra.
  await itw.getByTestId('setup-placement').getByRole('button', { name: 'Séquence' }).click();
  await expect(itw).toContainText('Plans 1.1A, 1.1B');
  await expect(itw.getByTestId('setup-number')).toHaveValue('1');

  await page.getByTestId('view-table').click();
  // Une ligne par caméra, dans les colonnes habituelles ; l'action dit qui, où et combien de questions.
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-cell="0:number"]')).toHaveText('1A');
  await expect(page.locator('[data-cell="1:number"]')).toHaveText('1B');
  await expect(page.locator('[data-cell="0:subject"]')).toHaveText('Claire Martin');
  await expect(page.locator('[data-cell="0:value"]')).toHaveText('Rapproché');
  await expect(page.locator('[data-cell="0:action"]')).toContainText('Interview — Claire Martin, Directrice');
  await expect(page.locator('[data-cell="0:action"]')).toContainText('1 question');
  await expect(page.locator('thead th', { hasText: 'TC MIN' })).toHaveCount(0);
  await page.getByTestId('seq-slot').first().fill('10:30–11:00');
  await page.getByTestId('seq-slot').first().press('Enter');

  // Double-clic sur une cellule du plan : la fiche s'ouvre.
  await page.locator('[data-cell="0:value"]').dblclick();
  await expect(itw.getByLabel('Question', { exact: true }).last()).toHaveValue('Racontez-nous votre métier.');

  // Aperçu de la vue Interview : la fiche seule (paysage par défaut).
  await page.getByTestId('toggle-print').click();
  await expect(page.getByTestId('interview-preview').contentFrame().getByText('Racontez-nous votre métier.')).toBeVisible();
  await expect(page.getByTestId('export-table')).toHaveCount(0);

  // Aperçu de la vue Tableau : le découpage seul.
  await page.getByTestId('view-table').click();
  await expect(page.getByTestId('interview-preview')).toHaveCount(0);
  await expect(page.getByTestId('export-table')).toContainText('Claire Martin');

  // Vue Découpage du scénario : les mêmes numéros que le tableau.
  await page.goto('/#/scenario');
  await page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Découpage' }).click();
  await expect(page.getByTestId('scenario-cut')).toContainText('1A');
  await expect(page.getByTestId('scenario-cut')).toContainText('1B');
});

type Doc = { shots: Record<string, { interview?: { setupId: string } }> };
/** Plans liés à la fiche d'interview (identifiants triés). */
const linkedShots = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => Doc | null } }).__ds.doc();
    return d ? Object.entries(d.shots).filter(([, x]) => x.interview).map(([id]) => id).sort() : [];
  });

test('interview placée : changer de séquence garde les plans, lettres de caméra sans doublon, retour en fiction modifiable', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-panel').getByText('Institutionnel', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-interview').click();
  const itw = page.getByTestId('interview');
  await itw.getByTestId('setup-placement').getByRole('radio', { name: 'Séq. 2' }).click();
  await expect(itw).toContainText('Plans 2.9A, 2.9B');
  const ids = await linkedShots(page);
  expect(ids).toHaveLength(2);

  // Le cadre passe en séquence 3 : les mêmes plans se déplacent (rien n'est recréé).
  await itw.getByTestId('setup-placement').getByRole('radio', { name: 'Séq. 3' }).click();
  await expect(itw).toContainText(/Plans 3\.\d+A, 3\.\d+B/);
  expect(await linkedShots(page)).toEqual(ids);

  // Caméra A retirée, puis une caméra ajoutée : elle reprend la lettre libre.
  await itw.getByRole('button', { name: 'Retirer la caméra A' }).click();
  await itw.getByRole('button', { name: 'Caméra', exact: true }).click();
  await expect(itw).toContainText(/Plans 3\.\d+B, 3\.\d+A/);

  // Tableau : pas de « Délier » sur une caméra d'interview.
  await page.getByTestId('view-table').click();
  const labels = (await page.locator('[data-cell$=":number"]').allTextContents()).map((t) => t.trim());
  const k = labels.indexOf(labels.find((t) => /^\d+B$/.test(t))!);
  expect(k).toBeGreaterThanOrEqual(0);
  await page.locator(`[data-cell="${k}:value"]`).click();
  await expect(page.getByRole('button', { name: 'Délier' })).toHaveCount(0);

  // Retour en fiction : les caméras deviennent des plans ordinaires, modifiables dans la grille.
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-panel').getByText('Fiction', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => linkedShots(page)).toEqual([]);
  await expect(page.locator(`[data-cell="${k}:number"]`)).toHaveText(/^\d+$/);
  await page.locator(`[data-cell="${k}:value"]`).dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Large');
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-cell="${k}:value"]`)).toHaveText('Large');
});
