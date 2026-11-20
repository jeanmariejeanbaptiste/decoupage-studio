import { expect, test } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8DwnwEJMDKgCgAAWq8E/2oTr6EAAAAASUVORK5CYII=',
  'base64',
);

test('inspecteur : angle de champ, matériel, son et storyboard', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  await page.locator('[data-cell="6:subject"]').click();
  const insp = page.getByTestId('inspector');
  await expect(insp).toContainText('Plan 2.1');
  await expect(insp).toContainText('Focale50 mm');
  await expect(insp).toContainText('Horizontal39,6°');
  await expect(insp).toContainText('Optique fixe 50 mm');
  await expect(insp).toContainText('Rails + dolly ou slider');
  await insp.getByLabel('Son').fill('IN');
  await insp.getByLabel('Son').press('Enter');
  await expect(insp).toContainText('Perche + HF');
  // La saisie d'un champ s'annule en une seule fois.
  const note = insp.locator('textarea').last();
  await note.fill('Lumière rasante, contre-jour fenêtre');
  await insp.getByText('2.1', { exact: true }).click();
  await expect(note).toHaveValue('Lumière rasante, contre-jour fenêtre');
  await page.keyboard.press('Control+z');
  await expect(note).toHaveValue('');
  await insp.locator('input[type=file]').first().setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: PNG });
  await expect(insp.getByRole('img', { name: 'Storyboard du plan 2.1' })).toBeVisible();
  await page.getByRole('button', { name: 'Replier l’inspecteur' }).click();
  await expect(insp).toHaveCount(0);
});

test('vérifications : liste cliquable, ignorer ici, rétablir', async ({ page }) => {
  await page.goto('/#/checks?seed=rav3');
  const issues = page.getByTestId('issue');
  await expect(issues.first()).toBeVisible();
  const n = await issues.count();
  // Les sautes de rav3 : deux séries (4.1 à 4.6, 7.12 et 7.13), une ligne chacune.
  expect(n).toBeGreaterThanOrEqual(2);
  // Un sujet qui n'est pas un personnage (« Affiche », insert) ne déclenche plus d'alerte.
  await expect(issues.filter({ hasText: 'Affiche' })).toHaveCount(0);
  // Ignorer une série ignore chacun de ses contrôles (cinq sautes de 4.2 à 4.6).
  await issues.first().getByRole('button', { name: /^Ignorer 4\.1\s–\s4\.6$/ }).click();
  await expect(issues).toHaveCount(n - 1);
  await page.getByRole('button', { name: 'Rétablir les 5 contrôles ignorés' }).click();
  await expect(issues).toHaveCount(n);
  await page.getByTestId('check-group-jump-cut').getByTestId('issue').first().getByTestId('check-go').click();
  await expect(page.locator('[aria-selected="true"][data-cell$=":subject"]')).toHaveCount(6);
  await expect(page.getByTestId('issue-dot').first()).toBeVisible();
});

test('listes de matériel par chef de poste', async ({ page }) => {
  await page.goto('/#/equipment?seed=rav3');
  await expect(page.getByTestId('equipment-Machinerie')).toContainText('Rails + dolly ou slider');
  await expect(page.getByTestId('equipment-Image')).toContainText('Optique fixe 100 mm');
  await expect(page.getByTestId('equipment-Lumière')).toContainText('Projecteurs effet nuit');
  await page.getByLabel('Ajouter du matériel (Son)').fill('Talkies-walkies');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('equipment-Son')).toContainText('Talkies-walkies');
  await page.getByTestId('equipment-Image').getByRole('button', { name: '7.3', exact: true }).click();
  await expect(page.locator('[data-cell="40:subject"]')).toHaveAttribute('aria-selected', 'true');
});

test('règles si… alors… : créées depuis la sélection, valeurs en gris, ce qui est tapé l’emporte', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  // Plan 1.4 (Insert) : sélection de Valeur à Focale, la règle se préremplit.
  await page.locator('[data-cell="3:value"]').click();
  await page.locator('[data-cell="3:focal"]').click({ modifiers: ['Shift'] });
  const insp = page.getByTestId('inspector');
  await expect(insp.getByLabel('Colonne de la condition')).toHaveValue('value');
  await expect(insp.getByLabel('Valeur de la condition')).toHaveValue('Insert');
  await expect(insp.getByLabel('Colonne du résultat')).toHaveValue('focal');
  await insp.getByLabel('Valeur du résultat').fill('100mm');
  await insp.getByTestId('rule-create').click();
  await expect(insp.getByTestId('rules')).toContainText('Si Valeur = Insert, alors Focale = 100mm');
  // Un autre Insert sans focale la reçoit, en gris ; on vide la focale du 1.4 pour le voir aussi.
  await page.locator('[data-cell="3:focal"]').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-cell="3:focal"] [data-ruled]')).toHaveText('100mm');
  // Ce qu'on tape l'emporte.
  await page.locator('[data-cell="3:focal"]').dblclick();
  await page.keyboard.type('85');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-cell="3:focal"]')).toHaveText('85mm');
  await expect(page.locator('[data-cell="3:focal"] [data-ruled]')).toHaveCount(0);
  // Désactivée : la valeur prévue disparaît.
  await page.locator('[data-cell="3:focal"]').click();
  await page.keyboard.press('Delete');
  await insp.getByTestId('rules').getByLabel('Règle active').uncheck();
  await expect(page.locator('[data-cell="3:focal"]')).toHaveText('');
});
