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
  await expect(page.getByTestId('toast').filter({ hasText: 'Scénario importé : 2 séquences' })).toBeVisible();
  const editor = page.getByTestId('script-editor');
  await expect(editor.locator('[data-type="character"]')).toHaveText('SAM');
  await expect(editor.locator('[data-type="dialogue"]')).toHaveText('Encore une heure.');
  await expect(editor.locator('[data-type="heading"]')).toHaveText(['INT. ATELIER - NUIT', 'EXT. COUR - JOUR']);
  expect(await page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario)).toMatch(/SAM\nEncore une heure\./);
});

test('suppression : plan (annulable) et séquence volumineuse protégée', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator(ROWS).first().hover();
  await page.locator(ROWS).first().getByTestId('delete-shot').click();
  await expect(page.locator(ROWS)).toHaveCount(52);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
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
  await page.getByTestId('view-storyboard').click();
  await expect(page.getByTestId('storyboard-card')).toHaveCount(38);
  await page.getByTestId('storyboard-delete').first().click();
  await expect(page.getByTestId('storyboard-card')).toHaveCount(37);
});

test('changer le type de projet change le minutage', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await expect(page.getByTestId('track-bar')).toBeVisible();
  await page.getByTestId('project-menu').click();
  await page.getByRole('radiogroup', { name: 'Format' }).getByText('Fiction').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-bar')).toHaveCount(0);
  await expect(page.getByTestId('grid-footer')).toContainText('durée totale');
  // Chaque plan affiche sa propre durée, et non une plage.
  await expect(page.locator('[data-cell="0:tc"]')).toHaveText(/^\d+:\d\d$/);
});

async function tabExport(page: import('@playwright/test').Page, format: string) {
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('tab-export').click();
  await page.getByTestId('tab-export-panel').getByText(format, { exact: true }).click();
  await page.getByTestId('tab-export-go').click();
  return dl;
}

test('exports mis en page : PDF sans interface et Word', async ({ page }) => {
  // L'adresse saisie fait paraître la carte : aucune requête ne part vers OpenStreetMap.
  await page.route(/openstreetmap\.org/, (r) => r.abort());
  await page.goto('/#/equipment?seed=rav3');
  await page.getByTestId('show-shots').uncheck();
  await expect(page.getByTestId('equipment-Image').getByRole('button', { name: '1.1' })).toHaveCount(0);
  await page.getByTestId('show-shots').check();
  await expect(page.getByTestId('equipment-Machinerie')).not.toContainText(/\+\d/);
  await expect(page.getByTestId('equipment-Machinerie')).toContainText('7.11');
  expect((await tabExport(page, 'Word')).suggestedFilename()).toBe('rav3-v3-materiel.doc');
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
  // Fractionner : la seconde moitié devient une reprise.
  await page.getByTestId('timeline-block').first().hover();
  await page.getByTestId('timeline-block').first().getByRole('button', { name: 'Allonger de 15 min' }).click();
  await page.getByTestId('timeline-block').first().getByTestId('timeline-split').click();
  await expect(page.getByTestId('timeline-block')).toHaveCount(2);
  await expect(page.getByTestId('timeline-block').nth(1)).toContainText('reprise 1');
  // PDF généré par l'outil (pages A4 assemblées), sans l'impression du navigateur.
  const pdf = readFileSync(await (await tabExport(page, 'PDF')).path()).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
  const word = readFileSync(await (await tabExport(page, 'Word')).path(), 'utf8');
  expect(word).toContain('Plan de travail');
  expect(word).toContain('08:30');
  expect(word).not.toContain('<button');
  await page.goto('/#/callsheet');
  // Mêmes horaires que le plan de travail : les plans non placés de la bande s'enchaînent après le créneau.
  await expect(page.getByTestId('itinerary')).toContainText('08:30 – 11:30');
  await page.getByTestId('stop-address').first().fill('3 quai Voltaire');
  expect(readFileSync(await (await tabExport(page, 'Word')).path(), 'utf8')).toContain('3 quai Voltaire');
});

test('exports A4 : images page par page et PDF assemblé par l’outil', async ({ page }) => {
  for (const [route, id, format, ori, name, pages] of [
    ['/#/grid?seed=rav3', 'grid', 'Images A4', 'Paysage', /-decoupage-A4-paysage\.zip$/, 3],
    ['/#/grid?seed=rav3', 'grid', 'PDF', 'Portrait', /-decoupage-A4-portrait\.pdf$/, 0],
    ['/#/storyboard?seed=rav3', 'storyboard', 'Images A4', 'Portrait', /-storyboard-A4-portrait\.zip$/, 14],
    ['/#/storyboard?seed=rav3', 'storyboard', 'PDF', 'Paysage', /-storyboard-A4-paysage\.pdf$/, 0],
    ['/#/floorplan?seed=rav3', 'floorplan', 'PDF', 'Paysage', /-plans-au-sol-A4-paysage\.pdf$/, 0],
  ] as const) {
    await page.goto(route);
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId(`${id}-export`).click();
    const panel = page.getByTestId(`${id}-export-panel`);
    await panel.getByText(format, { exact: true }).click();
    await panel.getByText(ori, { exact: true }).click();
    await page.getByTestId(`${id}-export-go`).click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(name);
    const buf = readFileSync(await d.path());
    expect(buf.byteLength).toBeGreaterThan(5_000);
    if (format === 'PDF') {
      // PDF produit par l'outil : pages A4 exactes, sans passer par l'impression du navigateur.
      const text = buf.toString('latin1');
      expect(text.startsWith('%PDF')).toBe(true);
      expect(text).toContain(ori === 'Portrait' ? '/MediaBox [0 0 595.28 841.89]' : '/MediaBox [0 0 841.89 595.28]');
    }
    if (pages) {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(buf);
      const files = Object.keys(zip.files).filter((f) => f.endsWith('.png')).sort();
      expect(files).toHaveLength(pages);
      expect(files[0]).toMatch(/-page-01\.png$/);
      // Proportions A4 exactes (largeur / hauteur lues dans l'en-tête PNG).
      const png = await zip.file(files[0])!.async('nodebuffer');
      const ratio = png.readUInt32BE(16) / png.readUInt32BE(20);
      expect(ratio).toBeCloseTo(ori === 'Portrait' ? 210 / 297 : 297 / 210, 2);
    }
  }
});

test('plan-séquence : temps dans la grille, chorégraphie au plan au sol', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  const row = page.locator(ROWS).first();
  await row.getByTestId('shot-gutter').dispatchEvent('contextmenu', { clientX: 200, clientY: 300, button: 2 });
  await page.getByRole('menuitem', { name: 'Transformer en plan-séquence' }).click();
  // L'éditeur de chorégraphie s'ouvre aussitôt, en plein écran.
  const studio = page.getByTestId('oneshot-studio');
  await expect(studio.getByTestId('studio-beat')).toHaveCount(2);
  const t2 = studio.getByTestId('studio-beat').nth(1);
  await t2.getByLabel('Valeur').fill('Gros plan');
  await t2.getByLabel('Sujet').fill('Affiche');
  await t2.getByLabel('Focale du temps 2').fill('85');
  await t2.getByLabel('Durée minimale du temps 2 (secondes)').fill('10');
  await t2.getByLabel('Durée maximale du temps 2 (secondes)').fill('20');
  await expect(studio).toContainText('0:10 – 0:20');
  // Liaison entre les temps : le mouvement qui fait passer d'un sujet à l'autre.
  await studio.getByLabel('Liaison type du temps 1 au temps 2').selectOption('Panoramique droite');
  await expect(studio.getByLabel('Liaison du temps 1 au temps 2')).toHaveValue('Panoramique droite');
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/bridge.png` : undefined });
  await studio.getByRole('button', { name: 'Terminé' }).click();
  await expect(row).toHaveClass(/oneShot/);
  await expect(row.locator('[data-cell$=":number"]')).toHaveText('1');
  // Une vraie ligne par temps, la liaison entre les deux.
  await expect(row.locator('xpath=following-sibling::tr[1]')).toContainText('↳ Panoramique droite');
  await expect(row.locator('xpath=following-sibling::tr[2]')).toContainText('T2Affiche');
  await expect(row.locator('xpath=following-sibling::tr[2]')).toContainText('85mm');
  await page.goto('/#/floorplan');
  // Les temps n'apparaissent que dans la vue propre au plan-séquence.
  await expect(page.getByTestId('fp-beats')).toHaveCount(0);
  await page.getByTestId('fp-oneshot-view').click();
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
  // Une seule caméra suivie de temps en temps : elle garde son repère.
  const camLabels = await page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { floorPlans: Record<string, { items: Array<{ kind: string; label?: string }> }> } } }).__ds.doc();
    return Object.values(d.floorPlans).flatMap((p) => p.items.filter((i) => i.kind === 'camera').map((i) => i.label));
  });
  expect(camLabels).toEqual(['CAM A', 'CAM A']);
  await expect(page.getByTestId('fp-shot').first().getByRole('button', { name: 'CAM A' })).toHaveCount(1);
  // Annexe technique du plan-séquence, en PDF généré par l'outil.
  await page.goto('/#/grid');
  const dl = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('grid-export').click();
  await page.getByTestId('grid-export-panel').getByText('Annexe plans-séquences').click();
  await page.getByTestId('grid-export-go').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/annexe-plans-sequences\.pdf$/);
  await d.saveAs('test-results/annexe-ps.pdf');
});

test('insérer un plan entre deux lignes et une séquence entre deux séquences', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  const rows = page.getByTestId('shot-row');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await rows.nth(1).hover();
  await rows.nth(1).getByTestId('insert-shot').click();
  await expect(rows).toHaveCount(n + 1);
  // Le nouveau plan est inséré juste sous la ligne survolée, et sélectionné.
  await expect(page.locator('[data-cell="2:subject"]')).toHaveAttribute('aria-selected', 'true');
  const seqs = page.locator('tbody[data-seq]');
  const m = await seqs.count();
  await seqs.first().getByTestId('insert-sequence').click({ force: true });
  await expect(seqs).toHaveCount(m + 1);
});

test('export intelligent : une colonne facultative vide disparaît des pages', async ({ page }) => {
  const go = (h: string) => page.evaluate((x) => void (window.location.hash = x), h);
  await page.goto('/#/export?seed=fiction');
  await page.locator('li label').filter({ hasText: /^Image$/ }).locator('input').check();
  await go('#/print');
  await expect(page.getByTestId('print-page').first()).toHaveAttribute('data-columns', /notes/);
  await go('#/grid');
  await page.getByTestId('grid-export').click();
  await page.getByTestId('grid-export-smart').check();
  await go('#/print');
  await expect(page.getByTestId('print-page').first()).not.toHaveAttribute('data-columns', /notes/);
});

test('raccourcis personnalisables depuis les Paramètres', async ({ page }) => {
  await page.goto('/#/settings?seed=fiction');
  await page.getByTestId('settings-raccourcis').click();
  const btn = page.getByTestId('shortcut-duplicate');
  await expect(btn).toHaveText('⌘D');
  await btn.click();
  await page.keyboard.press('Control+j');
  await expect(btn).toHaveText('⌘J');
  // Combinaison déjà prise : refusée.
  await page.getByTestId('shortcut-newShot').click();
  await page.keyboard.press('Control+j');
  await expect(page.getByText('déjà pris par « Dupliquer le plan »')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/#/grid');
  const rows = page.locator('[data-testid="shot-row"]');
  const n = await rows.count();
  await page.locator('[data-cell="0:subject"]').click();
  await page.keyboard.press('Control+j');
  await expect(rows).toHaveCount(n + 1);
});

test('une colonne affichée dans la grille est exportée', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByRole('button', { name: 'Colonnes' }).click();
  await page.getByRole('menu').getByRole('checkbox', { name: /^Image/ }).check();
  await page.goto('/#/export');
  await expect(page.getByRole('checkbox', { name: 'Image', exact: true })).toBeChecked();
});

test('réordonner les colonnes facultatives depuis le menu Colonnes', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByRole('button', { name: 'Colonnes' }).click();
  const menu = page.getByRole('menu');
  await menu.getByRole('checkbox', { name: /^Image/ }).check();
  const heads = page.locator('thead th[scope="col"]');
  await expect(heads.nth(-2)).toHaveText('Image');
  await menu.getByRole('button', { name: 'Déplacer Image vers la gauche' }).click();
  await menu.getByRole('button', { name: 'Déplacer Image vers la gauche' }).click();
  const labels = await heads.allTextContents();
  expect(labels.indexOf('Image')).toBeLessThan(labels.indexOf('Action'));
  await page.goto('/#/export');
  const exported = await page.getByRole('list', { name: 'Colonnes exportées' }).locator('label').allTextContents();
  expect(exported.indexOf('Image')).toBeLessThan(exported.indexOf('Action'));
});

test('exports des onglets : les pages contiennent bien le texte (jamais de page blanche)', async ({ page }) => {
  const { default: JSZip } = await import('jszip');
  for (const route of ['/#/scenario?seed=fiction', '/#/intention?seed=fiction', '/#/schedule?seed=rav3']) {
    await page.goto(route);
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId('tab-export').click();
    await page.getByTestId('tab-export-panel').getByText('Images A4', { exact: true }).click();
    await page.getByTestId('tab-export-go').click();
    const d = await dl;
    const buf = readFileSync(await d.path());
    // Une seule page : une image ; plusieurs : un dossier compressé (chaque page est vérifiée).
    const zip = d.suggestedFilename().endsWith('.zip') ? await JSZip.loadAsync(buf) : null;
    const pngs = zip
      ? await Promise.all(Object.keys(zip.files).filter((f) => f.endsWith('.png')).sort().map((f) => zip.file(f)!.async('base64')))
      : [buf.toString('base64')];
    for (const [i, png] of pngs.entries()) {
      const dark = await page.evaluate(async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let k = 0; k < px.length; k += 4) if (px[k] < 120 && px[k + 1] < 120 && px[k + 2] < 120) n++;
        return n;
      }, png);
      expect(dark, `${route} page ${i + 1}`).toBeGreaterThan(300);
    }
  }
});

