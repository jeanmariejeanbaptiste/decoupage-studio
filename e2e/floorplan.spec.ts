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
  await props.getByLabel('Personnage').selectOption({ label: 'Admiratrice' });
  await props.getByRole('button', { name: 'Ajouter un déplacement' }).click();
  await expect(page.getByTestId('fp-actor')).toContainText('Admiratrice');
  await expect(page.getByTestId('fp-actor').locator('line')).toHaveCount(1);

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
