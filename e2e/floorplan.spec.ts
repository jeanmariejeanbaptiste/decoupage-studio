import { expect, test, type Page } from '@playwright/test';

async function at(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('floorplan').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

test('plan au sol : caméra liée à un plan, comédien, mur', async ({ page }) => {
  await page.goto('/#/floorplan?seed=rav3');
  await page.getByTestId('tool-camera').click();
  let p = await at(page, 0.3, 0.7);
  await page.mouse.click(p.x, p.y);
  const props = page.getByTestId('fp-properties');
  await expect(props).toContainText('Caméra');
  await props.getByLabel(/1\.1/).check();
  await expect(page.getByTestId('fp-camera')).toContainText('CAM A · 16mm · 97°');
  await expect(props).toContainText('angle horizontal 96,7°');

  await page.getByTestId('tool-wall').click();
  p = await at(page, 0.1, 0.1);
  const q = await at(page, 0.6, 0.1);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.mouse.up();
  await expect(props).toContainText('Mur');

  await page.getByTestId('tool-actor').click();
  p = await at(page, 0.5, 0.4);
  await page.mouse.click(p.x, p.y);
  // Nommage automatique : le premier personnage de la séquence est attribué.
  await expect(page.getByTestId('fp-actor')).toContainText('Admiratrice');
  await props.getByLabel('Personnage').selectOption({ label: 'Admiratrice' });
  await props.getByRole('button', { name: 'Ajouter un déplacement' }).click();
  await expect(page.getByTestId('fp-actor')).toContainText('Admiratrice');
  await expect(page.getByTestId('fp-actor').locator('line')).toHaveCount(1);

  // L'outil reste actif : un second comédien se place sans re-sélectionner l'outil.
  p = await at(page, 0.7, 0.4);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('fp-actor')).toHaveCount(2);
  await props.getByRole('button', { name: 'Vedette' }).click();
  await expect(page.getByTestId('fp-actor').nth(1)).toContainText('Vedette');
  await page.getByTestId('tool-select').click();
  // Déplacer la caméra par glisser puis la retirer au clavier.
  const cam = page.getByTestId('fp-camera').locator('rect');
  const c = (await cam.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(props).toContainText('Caméra');
  await page.getByTestId('floorplan').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('fp-camera')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __ds: { invariants: () => string[] } }).__ds.invariants())).toEqual([]);
});

test('plan au sol : lumière, réflecteur et plusieurs plans', async ({ page }) => {
  await page.goto('/#/floorplan?seed=rav3');
  await page.getByTestId('tool-light').click();
  let p = await at(page, 0.2, 0.5);
  await page.mouse.click(p.x, p.y);
  const props = page.getByTestId('fp-properties');
  await props.getByLabel('Repère').fill('L1');
  await page.getByTestId('floorplan').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+r');
  await expect(page.getByTestId('fp-beam')).toHaveCount(1);
  // Réflecteur tracé en travers du faisceau (lumière orientée vers la droite).
  await page.getByTestId('tool-reflector').click();
  p = await at(page, 0.45, 0.35);
  const q = await at(page, 0.45, 0.65);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('fp-reflector')).toHaveCount(1);
  await expect(page.getByTestId('fp-bounce')).toHaveCount(1);
  await page.getByTestId('add-plan').click();
  await expect(page.getByRole('tab', { name: 'Vue 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('fp-reflector')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Vue 1' }).click();
  await expect(page.getByTestId('fp-reflector')).toHaveCount(1);
});

test('plan au sol : import du fichier .md de l’IA, aperçu ajustable, sélection au rectangle', async ({ page }) => {
  await page.goto('/#/floorplan?seed=rav3');
  const md = ['# PLAN DECOUPAGE-STUDIO v2', 'repere: cm', 'grille: 600x400', 'echelle_cm_par_unite: 1', 'murs: 3', 'portes: 1', 'fenetres: 0', '## MURS', 'M001 | 0,0 -> 600,0 | blanc', 'M002 | 600,0 -> 600,400 | standard', 'M003 | 0,400 -> 600,400 | standard', '## PORTES', 'P001 | 300,400 | 90 | 0', '## FENETRES', '## FIN', ''].join('\n');
  await page.getByTestId('fp-ai-file').setInputFiles({ name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await expect(page.getByTestId('fp-ai-report')).toContainText('3 murs, 1 portes');
  await expect(page.getByTestId('fp-ai-errors')).toHaveCount(0);
  await expect(page.getByTestId('fp-ai-ghost').locator('line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Agrandir les murs importés' }).click();
  await expect(page.getByTestId('fp-ai-scale')).toHaveText('110 %');
  await page.getByTestId('fp-ai-apply').click();
  await expect(page.getByTestId('toast')).toContainText('3 murs, 1 portes');
  await expect(page.getByTestId('fp-ai-ghost')).toHaveCount(0);
  // Rectangle de sélection sur tout le plan, puis suppression groupée.
  const box = (await page.getByTestId('floorplan').boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 8 });
  await expect(page.getByTestId('fp-marquee')).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('fp-wall')).toHaveCount(0);
  const vb = () => page.getByTestId('floorplan').getAttribute('viewBox');
  const before = await vb();
  await page.getByRole('button', { name: 'Zoomer', exact: true }).click();
  expect(await vb()).not.toBe(before);
  const zoomed = await vb();
  await page.getByTestId('fp-fit').click();
  expect(await vb()).not.toBe(zoomed);
});
