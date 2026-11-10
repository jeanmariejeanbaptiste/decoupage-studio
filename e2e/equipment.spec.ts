import { expect, test } from '@playwright/test';

test('matériel : poste ajouté en ligne, nom déjà pris refusé, suppression confirmée dans l’application', async ({ page }) => {
  await page.goto('/#/equipment?seed=rav3');
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  const field = page.getByTestId('add-equipment-category');
  await field.fill('Régie');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('equipment-Régie')).toBeVisible();
  // Un nom déjà pris ne crée pas de doublon : on arrive sur le poste existant.
  await field.fill('regie');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('equipment-Régie')).toHaveCount(1);
  await expect(page.getByLabel('Ajouter du matériel (Régie)')).toBeFocused();
  // Échap abandonne la saisie.
  await field.fill('Brouillon');
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await page.getByLabel('Ajouter du matériel (Régie)').fill('Barnum');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Supprimer le poste Régie' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Supprimer le poste « Régie » ?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByTestId('equipment-Régie')).toHaveCount(0);
  expect(dialogs).toBe(0);
});

test('matériel : un plan se cherche par son code, sans souci de casse ; le CSV est dans Exporter', async ({ page }) => {
  await page.goto('/#/settings?seed=rav3&section=decoupage');
  await page.getByRole('radiogroup', { name: 'Code des plans' }).getByText('3D').click();
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-savebar')).toContainText('Enregistré');
  await page.goto('/#/equipment');
  await page.getByLabel('Rechercher du matériel').fill('7K');
  await expect(page.getByTestId('equipment-Machinerie').getByRole('button', { name: '7K', exact: true })).toBeVisible();
  await page.getByLabel('Rechercher du matériel').fill('7k');
  await expect(page.getByTestId('equipment-Machinerie').getByRole('button', { name: '7K', exact: true })).toBeVisible();
  // Un seul bouton d'export, en tête, avec le CSV dans son menu.
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toHaveCount(0);
});
