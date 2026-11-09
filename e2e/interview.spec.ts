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
  await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Découpage' }).click();
  await expect(page.getByTestId('scenario-cut')).toContainText('1A');
  await expect(page.getByTestId('scenario-cut')).toContainText('1B');
});
