import { readFileSync } from 'node:fs';
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
  await page.getByTestId('timeline-toggle-1').click();
  const src = await page.getByTestId('pool-shot').first().boundingBox();
  const dst = await page.getByTestId('slot-08:30').boundingBox();
  await page.mouse.move(src!.x + 10, src!.y + 5);
  await page.mouse.down();
  await page.mouse.move(src!.x + 30, src!.y + 20, { steps: 4 });
  await page.mouse.move(dst!.x + 40, dst!.y + 6, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('timeline-block')).toHaveCount(1);
  await expect(page.getByTestId('timeline-move')).toContainText('Lieu 08:30');
  await page.getByTestId('tab-export-pdf').click();
  const frame = page.frameLocator('iframe[aria-hidden="true"]');
  await expect(frame.locator('h1')).toHaveText('Plan de travail');
  await expect(frame.locator('body')).toContainText('08:30');
  await expect(frame.locator('button')).toHaveCount(0);
  await page.goto('/#/callsheet');
  await expect(page.getByTestId('itinerary')).toContainText('08:30 – 09:00');
  await page.getByTestId('stop-address').first().fill('3 quai Voltaire');
  await page.getByTestId('tab-export-pdf').click();
  await expect(page.locator('iframe[aria-hidden="true"]').last().contentFrame().locator('body')).toContainText('3 quai Voltaire');
});

test('exports en images A4, page par page', async ({ page }) => {
  for (const [route, id, menu, name, pages] of [
    ['/#/grid?seed=rav3', 'grid-export-image', 'Images A4 paysage (une par page)', /-decoupage-A4-paysage\.zip$/, 3],
    ['/#/grid?seed=rav3', 'grid-export-image', 'Images A4 portrait (une par page)', /-decoupage-A4-portrait\.zip$/, 0],
    ['/#/storyboard?seed=rav3', 'storyboard-image', 'Images A4 portrait (une par page)', /-storyboard-A4-portrait\.zip$/, 14],
    ['/#/floorplan?seed=rav3', 'floorplan-image', 'Images A4 paysage (une par page)', /-plans-au-sol-A4-paysage\.(zip|png)$/, 0],
  ] as const) {
    await page.goto(route);
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId(id).click();
    await page.getByRole('menuitem', { name: menu }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(name);
    const buf = readFileSync(await d.path());
    expect(buf.byteLength).toBeGreaterThan(5_000);
    if (pages) {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(buf);
      const files = Object.keys(zip.files).filter((f) => f.endsWith('.png')).sort();
      expect(files).toHaveLength(pages);
      expect(files[0]).toMatch(/-page-01\.png$/);
      // Proportions A4 exactes (largeur / hauteur lues dans l'en-tête PNG).
      const png = await zip.file(files[0])!.async('nodebuffer');
      const ratio = png.readUInt32BE(16) / png.readUInt32BE(20);
      expect(ratio).toBeCloseTo(name.source.includes('portrait') ? 210 / 297 : 297 / 210, 2);
    }
  }
});

test('plan-séquence : temps dans la grille, chorégraphie au plan au sol', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  const row = page.locator(ROWS).first();
  await row.locator('td').first().dispatchEvent('contextmenu', { clientX: 200, clientY: 300, button: 2 });
  await page.getByRole('menuitem', { name: 'Transformer en plan-séquence' }).click();
  const editor = page.getByTestId('oneshot-editor');
  await expect(editor.getByTestId('oneshot-beat')).toHaveCount(2);
  await editor.getByLabel('Valeur du temps 2').fill('Gros plan');
  await editor.getByLabel('Sujet du temps 2').fill('Affiche');
  await editor.getByLabel('Durée minimale du temps 2').fill('10');
  await editor.getByLabel('Durée maximale du temps 2').fill('20');
  await editor.getByLabel('Durée maximale du temps 2').blur();
  await expect(row).toContainText('PLAN-SÉQ.');
  await expect(row).toContainText('T2 Affiche');
  await expect(editor).toContainText('0:10 – 0:20');
  await page.goto('/#/floorplan');
  await expect(page.getByTestId('fp-beats')).toBeVisible();
  const canvas = page.getByTestId('floorplan');
  const box = (await canvas.boundingBox())!;
  for (const [n, x] of [
    [1, 0.3],
    [2, 0.6],
  ] as const) {
    await page.getByTestId(`fp-beat-${n}`).click();
    await page.getByTestId('tool-camera').click();
    await page.mouse.click(box.x + box.width * x, box.y + box.height * 0.5);
    await page.keyboard.press('Escape');
  }
  await expect(page.getByTestId('fp-choreo')).toHaveCount(1);
});
