import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

const ROWS = '[data-testid="shot-row"]';

async function docx(paras: Array<{ t: string; center?: boolean; ind?: number }>): Promise<Buffer> {
  const p = paras
    .map((x) => `<w:p><w:pPr>${x.center ? '<w:jc w:val="center"/>' : ''}${x.ind ? `<w:ind w:left="${x.ind}"/>` : ''}</w:pPr><w:r><w:t xml:space="preserve">${x.t}</w:t></w:r></w:p>`)
    .join('');
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('import d’un scénario Word : séquences, personnages et répliques', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const buf = await docx([
    { t: 'INT. ATELIER - NUIT' },
    { t: '' },
    { t: 'Sam ponce une planche.' },
    { t: '' },
    { t: 'SAM', center: true },
    { t: 'Encore une heure.', ind: 2200 },
    { t: '' },
    { t: 'EXT. COUR - JOUR' },
    { t: '' },
    { t: 'Il pleut.' },
  ]);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Importer/ }).click();
  await (await chooser).setFiles({ name: 'scenario.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remplacer' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: '2 séquences détectées' })).toBeVisible();
  await expect(page.getByTestId('scenario-editor')).toHaveValue(/@SAM\nEncore une heure\./);
});

test('suppression : plan (annulable) et séquence volumineuse protégée', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator(ROWS).first().hover();
  await page.locator(ROWS).first().getByTestId('delete-shot').click();
  await expect(page.locator(ROWS)).toHaveCount(52);
  await page.getByTestId('toast').filter({ hasText: 'supprimé' }).getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator(ROWS)).toHaveCount(53);
  const seq7 = page.locator('tbody[data-seq]').nth(6);
  await seq7.locator('[data-cell$=":sequence"]').hover();
  await seq7.getByTestId('delete-sequence').click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('15 plans');
  await dlg.getByRole('button', { name: 'Supprimer la séquence' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'cochez la case' })).toBeVisible();
  await expect(page.locator(ROWS)).toHaveCount(53);
  await seq7.locator('[data-cell$=":sequence"]').hover();
  await seq7.getByTestId('delete-sequence').click();
  await dlg.getByLabel(/Oui, je supprime ces 15 plans/).check();
  await dlg.getByRole('button', { name: 'Supprimer la séquence' }).click();
  await expect(page.locator(ROWS)).toHaveCount(38);
  // Le storyboard suit, et l'inverse.
  await page.getByRole('button', { name: /Storyboard/ }).click();
  await expect(page.getByTestId('storyboard-card')).toHaveCount(38);
  await page.getByTestId('storyboard-delete').first().click();
  await expect(page.getByTestId('storyboard-card')).toHaveCount(37);
});

test('changer le type de projet change le minutage', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await expect(page.getByTestId('track-bar')).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('radiogroup', { name: 'Format' }).getByText('Fiction').click();
  await page.goto('/#/grid');
  await expect(page.getByTestId('track-bar')).toHaveCount(0);
  await expect(page.getByTestId('grid-footer')).toContainText('durée calculée');
});

test('exports mis en page : PDF sans interface et Word', async ({ page }) => {
  await page.goto('/#/equipment?seed=rav3');
  await page.getByTestId('show-shots').uncheck();
  await expect(page.getByTestId('equipment-Image').getByRole('button', { name: '1.1' })).toHaveCount(0);
  await page.getByTestId('show-shots').check();
  await expect(page.getByTestId('equipment-Machinerie')).not.toContainText(/\+\d/);
  await expect(page.getByTestId('equipment-Machinerie')).toContainText('7.11');
  const dl = page.waitForEvent('download');
  await page.getByTestId('tab-export-word').click();
  expect((await dl).suggestedFilename()).toBe('RAV3-materiel.doc');
  await page.goto('/#/schedule');
  await page.getByTestId('suggest-schedule').click();
  await page.getByTestId('slot-start').first().fill('08:30');
  await page.getByTestId('tab-export-pdf').click();
  const frame = page.frameLocator('iframe[aria-hidden="true"]');
  await expect(frame.locator('h1')).toHaveText('Plan de travail');
  await expect(frame.locator('body')).toContainText('08:30');
  await expect(frame.locator('button')).toHaveCount(0);
});
