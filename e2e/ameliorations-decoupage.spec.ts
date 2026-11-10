import { expect, test, type Page } from '@playwright/test';

const PHONE = { width: 390, height: 844 };

const doc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ds: { doc: () => unknown } }).__ds.doc()) as Promise<{
    shots: Record<string, { durationSec?: number }>;
    blocks: Record<string, { dialogue?: string }>;
  }>;

test.describe('téléphone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('barre du tableau : menu Colonnes dans l’écran, sans inspecteur ni scénario', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await expect(page.getByTestId('mobile-cut')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspecteur' })).toHaveCount(0);
    await expect(page.getByTestId('toggle-scenario')).toHaveCount(0);
    await page.getByRole('button', { name: 'Colonnes' }).click();
    const box = await page.getByRole('menu').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
  });

  test('storyboard : barre dans l’écran, commandes des cartes visibles', async ({ page }) => {
    await page.goto('/#/storyboard?seed=fiction');
    const exp = page.getByTestId('storyboard-export');
    await expect(exp).toBeVisible();
    const box = (await exp.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    await expect(page.getByTestId('storyboard-per-row')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('storyboard-draw').first()).toHaveCSS('opacity', '1');
  });

  test('dialogue : la puce de personnage complète le texte sans l’effacer', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await page.getByRole('button', { name: 'Colonnes' }).click();
    await page.getByRole('menu').getByLabel('Dialogue').check();
    await page.getByRole('button', { name: 'Colonnes' }).click();
    const field = page.getByLabel('Dialogue', { exact: true });
    await field.fill('Ça suffit. ');
    // Aucune puce ne remplace un texte en cours de phrase.
    await field.fill('Ça suffit');
    await expect(page.locator('[data-field="dialogue"] button')).toHaveCount(0);
    await field.fill('Ça suffit. ma');
    await page.locator('[data-field="dialogue"] button', { hasText: 'MARC :' }).click();
    await expect(field).toHaveValue('Ça suffit. MARC : ');
  });
});

test('téléphone, mode durée : la durée du plan se saisit', async ({ page }) => {
  await page.goto('/#/settings?seed=fiction&section=minutage');
  await page.getByRole('radiogroup', { name: 'Mode de TC' }).getByText('Durée de chaque plan').click();
  await page.getByTestId('settings-save').click();
  await page.setViewportSize(PHONE);
  await page.goto('/#/grid');
  const field = page.getByLabel('Durée', { exact: true });
  await field.fill('0:12');
  await field.blur();
  const d = await doc(page);
  expect(Object.values(d.shots).some((s) => s.durationSec === 12)).toBe(true);
});

test('téléphone, mode durée : la durée calculée reste lisible sur un plan d’interview', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-panel').getByText('Institutionnel', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-interview').click();
  const itw = page.getByTestId('interview');
  await itw.getByTestId('setup-placement').getByRole('radio', { name: 'Séq. 2' }).click();
  await expect(itw).toContainText('Plans 2.9A, 2.9B');
  await page.getByTestId('view-table').click();
  await page.goto('/#/settings?section=minutage');
  await page.getByRole('radiogroup', { name: 'Mode de TC' }).getByText('Durée de chaque plan').click();
  await page.getByTestId('settings-save').click();
  await page.setViewportSize(PHONE);
  await page.goto('/#/grid');
  await page.getByTestId('mobile-overview').click();
  await page.getByTestId('mobile-list-shot').filter({ hasText: '2.9A' }).click();
  await expect(page.getByTestId('mobile-cut')).toContainText('Plan 2.9A');
  const field = page.getByLabel('Durée', { exact: true });
  await expect(field).toHaveAttribute('readonly', '');
  await expect(field).toHaveAttribute('placeholder', /\d+:\d\d/);
});

const ROWS = '[data-testid="shot-row"]';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('⌘⌫ sur une grande sélection demande confirmation', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const grid = page.getByTestId('grid');
  await grid.focus();
  await expect(page.locator(ROWS)).toHaveCount(11);
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press(`${MOD}+Backspace`);
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('Supprimer 11 plans');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator(ROWS)).toHaveCount(11);
  await grid.focus();
  await page.keyboard.press(`${MOD}+Backspace`);
  await dlg.getByLabel('Oui, je supprime ces 11 plans').check();
  await dlg.getByRole('button', { name: 'Supprimer les plans' }).click();
  await expect(page.locator(ROWS)).toHaveCount(0);
});

test('⌘⇧↓ dans la colonne Séquence ne renomme pas les séquences suivantes', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const labels = () =>
    page.evaluate(() => {
      const d = (window as unknown as { __ds: { doc: () => { project: { sequenceIds: string[] }; sequences: Record<string, { label: string }> } } }).__ds.doc();
      return d.project.sequenceIds.map((id) => d.sequences[id].label);
    });
  const before = await labels();
  await page.locator('[data-cell="0:sequence"]').click();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press(`${MOD}+Shift+ArrowDown`);
  expect(await labels()).toEqual(before);
});

test('plan-séquence : Alt + → déplace un temps au clavier', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator(ROWS).first().getByTestId('shot-gutter').dispatchEvent('contextmenu', { clientX: 200, clientY: 300, button: 2 });
  await page.getByRole('menuitem', { name: 'Transformer en plan-séquence' }).click();
  const studio = page.getByTestId('oneshot-studio');
  const beats = studio.getByTestId('studio-beat');
  await expect(beats).toHaveCount(2);
  await beats.nth(1).getByLabel('Valeur').fill('Insert');
  await beats.nth(1).getByLabel('Valeur').blur();
  const first = await beats.nth(0).getByLabel('Valeur').inputValue();
  await studio.getByRole('button', { name: 'Temps 1', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(beats.nth(0).getByLabel('Valeur')).toHaveValue('Insert');
  await expect(beats.nth(1).getByLabel('Valeur')).toHaveValue(first);
  await expect(studio.getByRole('button', { name: 'Temps 2', exact: true })).toBeFocused();
});

test('storyboard : une grande photo importée est réduite à 2400 px', async ({ page }) => {
  await page.goto('/#/storyboard?seed=fiction');
  // Image 3000 × 2000 bruitée (plusieurs Mo en PNG), fabriquée dans la page.
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 2000;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(3000, 2000);
    for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  });
  const card = page.getByTestId('storyboard-card').nth(2);
  await card.getByLabel('Importer une image pour le plan 1.3').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  const img = card.getByRole('img', { name: 'Storyboard du plan 1.3' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(2400);
});

test('dessin : enregistrer sans trait ne pose pas d’image blanche', async ({ page }) => {
  await page.goto('/#/storyboard?seed=fiction');
  const card = page.getByTestId('storyboard-card').first();
  await card.hover();
  await card.getByTestId('storyboard-draw').click();
  const ed = page.getByTestId('sketch-editor');
  await ed.getByTestId('sketch-save').click();
  await expect(ed).toHaveCount(0);
  await expect(card.getByRole('img', { name: /Storyboard du plan/ })).toHaveCount(0);
});

test('storyboard : ⌘P suit l’orientation choisie à l’export', async ({ page }) => {
  await page.goto('/#/storyboard?seed=rav3');
  await page.getByTestId('storyboard-export').click();
  await page.getByTestId('storyboard-export-panel').getByText('Portrait', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ media: 'print' });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __ds: { doc: () => { project: { settings: { exportPrefs?: { storyboard?: { orientation?: string } } } } } } }).__ds.doc().project.settings.exportPrefs
            ?.storyboard?.orientation,
      ),
    )
    .toBe('portrait');
  await expect(page.getByText(/^planche 1 \//)).toBeVisible();
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
  expect(pdf).toMatch(/\/MediaBox \[0 0 59\d/);
});

test('plan abandonné : texte estompé dans le tableau', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  await page.locator('[data-cell="1:subject"]').click();
  const subject = page.locator('[data-cell="1:subject"]');
  const normal = await subject.evaluate((el) => getComputedStyle(el).color);
  await page.getByTestId('inspector').getByLabel('Statut').selectOption('abandonné');
  await expect(page.locator(ROWS).nth(1)).toHaveAttribute('data-status', 'abandonné');
  await page.locator('[data-cell="0:subject"]').click();
  await expect.poll(() => subject.evaluate((el) => getComputedStyle(el).color)).not.toBe(normal);
});

test('Alt + ↓ sur le dernier plan d’une séquence le fait passer dans la suivante', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  type D = { project: { sequenceIds: string[] }; sequences: Record<string, { shotIds: string[] }>; shots: Record<string, { sequenceId: string }> };
  const read = () => page.evaluate(() => (window as unknown as { __ds: { doc: () => D } }).__ds.doc());
  const d0 = await read();
  const [s1, s2] = d0.project.sequenceIds;
  const last = d0.sequences[s1].shotIds.at(-1)!;
  const row = d0.sequences[s1].shotIds.length - 1;
  await page.locator(`[data-cell="${row}:subject"]`).click();
  await page.keyboard.press('Alt+ArrowDown');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Déplacer' }).click();
  await expect.poll(async () => (await read()).sequences[s2].shotIds[0]).toBe(last);
  expect((await read()).shots[last].sequenceId).toBe(s2);
});

test('mode piste : un simple clic sur la piste garde la plage calée', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.locator('[data-cell="3:subject"]').click();
  const tc = page.locator('[data-cell="3:tc"]');
  const before = await tc.textContent();
  const box = (await page.getByTestId('waveform').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(tc).toHaveText(before ?? '');
  await expect(page.getByTestId('toast')).toHaveCount(0);
});
