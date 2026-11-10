import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const getDoc = () => (window as unknown as { __ds: { doc: () => { project: { title: string } } } }).__ds.doc();

test('page Exporter : flèches inactives sur les colonnes figées, aucun texte d’aide', async ({ page }) => {
  await page.goto('/#/export?seed=fiction');
  for (const name of ['Monter N°', 'Monter Sujet', 'Monter TC MIN', 'Descendre TC MIN', 'Descendre N°']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  const cols = page.getByRole('list', { name: 'Colonnes exportées' }).locator('li');
  await expect(cols.nth(2)).toContainText('Sujet');
  await page.getByRole('button', { name: 'Descendre Sujet', exact: true }).click();
  await expect(cols.nth(3)).toContainText('Sujet');
  await expect(page.locator('label small')).toHaveCount(0);
  await expect(page.getByText('Depuis un tableur')).toHaveCount(0);
});

test('import CSV : fichier Windows-1252 décodé, colonnes abandonnées absentes, libellés en casse normale', async ({ page }) => {
  await page.goto('/#/export?seed=fiction');
  const csv = Buffer.from('Séquence;Sujet;Action;Image\nCUISINE;Léa;Elle se lève.;Contre-jour\n', 'latin1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-csv').click();
  await (await chooser).setFiles({ name: 'plans.csv', mimeType: 'text/csv', buffer: csv });
  const box = page.getByTestId('csv-import');
  await expect(box).toContainText('Séquence');
  await expect(box).toContainText('Elle se lève.');
  await expect(page.getByLabel('Colonne 1')).toHaveValue('sequence');
  await expect(page.getByLabel('Colonne 4')).toHaveValue('notes');
  const options = await page.getByLabel('Colonne 1').locator('option').allTextContents();
  expect(options).toContain('Séquence');
  for (const gone of ['Machinerie', 'Personnages', 'Lumière', 'SÉQUENCE']) expect(options).not.toContain(gone);
  await expect(box).not.toContainText('libellé distinct');
});

test('panneau Exporter au clavier : le focus entre, Échap ferme et le rend', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  const trigger = page.getByTestId('tab-export');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('tab-export-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate((p) => p.contains(document.activeElement))).toBe(true);
  await expect(panel.locator('legend')).toContainText(['Format', 'Orientation']);
  await expect(panel.locator('legend', { hasText: 'Format A4' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('dossier de production : Word, note mise en forme, scénario .docx et LISEZ-MOI fidèle', async ({ page }) => {
  await page.goto('/#/export?seed=fiction');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-zip').click();
  const d = await dl;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync(await d.path()));
  const names = Object.keys(zip.files);
  const has = (part: string) => names.some((n) => n.includes(part));
  for (const part of ['01 Intention/Note d’intention.doc', '01 Intention/Note d’intention.txt', '02 Scénario/Scénario.docx', '03 Dépouillement/Dépouillement.doc', '07 Matériel/Listes de matériel.doc']) expect(has(part), part).toBe(true);
  const note = await zip.file(/Note d’intention\.doc$/)[0].async('string');
  expect(note).toContain('<h1>La Consigne</h1>');
  const docx = await JSZip.loadAsync(await zip.file(/Scénario\.docx$/)[0].async('uint8array'));
  expect(docx.file('word/document.xml')).not.toBeNull();
  // Le LISEZ-MOI n'annonce que les dossiers présents, et tous.
  const readme = await zip.file(/LISEZ-MOI\.txt$/)[0].async('string');
  const announced = [...readme.matchAll(/^(\d\d [^\s].*?)\s{2,}/gm)].map((m) => m[1]);
  const folders = [...new Set(names.map((n) => n.split('/')[1]).filter((f) => f && /^\d\d /.test(f)))];
  expect(announced.sort()).toEqual(folders.sort());
  // Aucun tableau réduit à son en-tête.
  for (const n of names.filter((x) => x.endsWith('.csv'))) expect((await zip.file(n)!.async('string')).split('\r\n').filter(Boolean).length, n).toBeGreaterThan(1);
  await expect(page.getByText('Préparation du dossier')).toHaveCount(0);
});

/** Pixels sombres dans le coin bas gauche de la première page (zone du pied de page). */
async function footerInk(page: Page, footer: boolean, content: 'grid' | 'storyboard' = 'grid', save?: string): Promise<number> {
  await page.goto(`/#/export?seed=${content === 'grid' ? 'rav3' : 'fiction'}`);
  const box = page.getByRole('checkbox', { name: 'Pied de page' });
  if (footer) await box.check();
  else await box.uncheck();
  await page.evaluate(() => void (window.location.hash = '#/grid'));
  const dl = page.waitForEvent('download');
  await page.getByTestId('grid-export').click();
  if (content === 'storyboard') await page.getByTestId('grid-export-panel').getByText('Storyboard', { exact: true }).click();
  const id = content === 'grid' ? 'grid' : 'storyboard';
  await page.getByTestId(`${id}-export-panel`).getByText('Images A4', { exact: true }).click();
  await page.getByTestId(`${id}-export-go`).click();
  const d = await dl;
  const buf = readFileSync(await d.path());
  let png = buf;
  if (d.suggestedFilename().endsWith('.zip')) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    png = Buffer.from(await zip.file(/page-01\.png$/)[0].async('uint8array'));
  }
  if (save) writeFileSync(save, png);
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const mm = c.width / 297;
    const data = ctx.getImageData(Math.round(5 * mm), Math.round(c.height - 8 * mm), Math.round(60 * mm), Math.round(5 * mm)).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 160) dark++;
    return dark;
  }, png.toString('base64'));
}

test('images du découpage : pied de page selon le réglage', async ({ page }) => {
  test.setTimeout(90_000);
  expect(await footerInk(page, true)).toBeGreaterThan(50);
  expect(await footerInk(page, false)).toBe(0);
});

test('planches du storyboard : pied de page selon le réglage', async ({ page }) => {
  test.setTimeout(90_000);
  expect(await footerInk(page, true, 'storyboard', test.info().outputPath('storyboard-footer.png'))).toBeGreaterThan(50);
  expect(await footerInk(page, false, 'storyboard')).toBe(0);
});

test('aperçu imprimé sur téléphone : pas de défilement horizontal de la page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/print?seed=rav3');
  await expect(page.getByTestId('print-page').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(getDoc).then((d) => d.project.title)).toBe('RAV3');
});
