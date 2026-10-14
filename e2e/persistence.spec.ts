import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ROWS = '[data-testid="shot-row"]';
const getDoc = () => (window as unknown as { __ds: { doc: () => unknown } }).__ds.doc();

test('recharger la page conserve tout', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('new-project').click();
  await page.getByLabel('Titre du projet').fill('Persistance');
  await page.getByLabel('Clip').check({ force: true });
  await page.getByTestId('wizard-next').click();
  await expect(page.getByText('Réglages du minutage')).toBeVisible();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('create-first').click();
  await page.keyboard.type('Studio');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Nina');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-status')).toHaveText('Enregistré dans le navigateur');
  const before = await page.evaluate(getDoc);
  await page.reload();
  await expect(page.locator(ROWS)).toHaveCount(1);
  await expect(page.locator(ROWS).first()).toContainText('1, STUDIO');
  await expect(page.locator(ROWS).first()).toContainText('Nina');
  expect(await page.evaluate(getDoc)).toEqual(before);
  await page.goto('/#/');
  await expect(page.getByTestId('project-list')).toContainText('Persistance');
  await expect(page.getByTestId('project-list')).toContainText('Clip');
});

test('aller-retour fichier .decoupage sans perte', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
  await page.goto('/#/');
  await page.getByTestId('demo-rav3').click();
  await expect(page.locator(ROWS)).toHaveCount(53);
  const original = await page.evaluate(getDoc);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid="grid"]').focus();
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rav3-v3.decoupage');
  const path = await download.path();
  const content = readFileSync(path, 'utf8');
  expect(JSON.parse(content).format).toBe('decoupage-studio');

  // On abîme le projet en mémoire, puis on rouvre le fichier.
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+Backspace');
  await expect(page.locator(ROWS)).toHaveCount(52);
  await page.goto('/#/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Ouvrir un fichier…' }).click();
  await (await chooser).setFiles({ name: 'rav3-v3.decoupage', mimeType: 'application/json', buffer: Buffer.from(content) });
  await expect(page.locator(ROWS)).toHaveCount(53);
  const reopened = (await page.evaluate(getDoc)) as { project: { updatedAt: string } };
  const orig = original as { project: { updatedAt: string } };
  expect({ ...reopened, project: { ...reopened.project, updatedAt: '' } }).toEqual({ ...orig, project: { ...orig.project, updatedAt: '' } });
});
