import { expect, test, type Page } from '@playwright/test';

type Item = { id: string; kind: string; x: number; y: number; x2?: number; y2?: number; rot?: number; width?: number; label?: string };

const items = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { floorPlans?: Record<string, { items: Item[] }> } } }).__ds.doc();
    return Object.values(d.floorPlans ?? {}).flatMap((p) => p.items);
  });

async function at(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('floorplan').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function place(page: Page, tool: string, fx: number, fy: number) {
  await page.getByTestId(`tool-${tool}`).click();
  const p = await at(page, fx, fy);
  await page.mouse.click(p.x, p.y);
}

test('plan au sol : à 390 et 768 px, le dessin prend la largeur et le panneau passe dessous', async ({ page }) => {
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/floorplan?seed=fiction');
    const svg = (await page.getByTestId('floorplan').boundingBox())!;
    const panel = (await page.getByTestId('fp-panel').boundingBox())!;
    expect(svg.width).toBeGreaterThan((width - 48) * 0.9);
    expect(panel.y).toBeGreaterThanOrEqual(svg.y + svg.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('plan au sol : sélection multiple, annulation, raccourcis et copie', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await place(page, 'light', 0.4, 0.5);
  await place(page, 'light', 0.6, 0.5);
  const canvas = page.getByTestId('floorplan');
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByTestId('fp-multi')).toContainText('2 éléments');
  // Les éléments annulés quittent la sélection.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fp-light')).toHaveCount(0);
  await expect(page.getByTestId('fp-multi')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('fp-multi')).toContainText('2 éléments');
  // Les lettres choisissent l'outil ; Échap défait la sélection et revient à l'outil Sélection.
  await page.keyboard.press('c');
  await expect(page.getByTestId('tool-camera')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fp-multi')).toHaveCount(0);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  // Copie (Ctrl+D) : nouveaux repères, la copie sélectionnée, une seule étape d'annulation.
  await page.getByTestId('fp-item').first().click();
  await canvas.focus();
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('fp-light')).toHaveCount(3);
  await expect(page.getByTestId('fp-properties').getByLabel('Repère')).toHaveValue('L3');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fp-light')).toHaveCount(2);
  await page.keyboard.press('Control+a');
  await page.getByTestId('fp-multi').getByTestId('fp-duplicate').click();
  await expect(page.getByTestId('fp-light')).toHaveCount(4);
  await expect(page.getByTestId('fp-multi')).toContainText('2 éléments');
});

test('plan au sol : Échap abandonne un glisser, une flèche maintenue fait une seule étape', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await place(page, 'camera', 0.5, 0.5);
  await page.getByTestId('tool-select').click();
  const [cam0] = await items(page);
  const body = (await page.getByTestId('fp-camera-body').boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + 200, body.y + 100, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await items(page))[0]).toMatchObject({ x: cam0.x, y: cam0.y });
  await expect(page.getByTestId('fp-properties')).toContainText('Caméra');
  // Flèche maintenue (répétitions sans relâcher) : une seule étape d'annulation.
  for (let k = 0; k < 5; k++) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  expect((await items(page))[0].x).toBe(cam0.x + 100);
  await page.keyboard.press('Control+z');
  expect((await items(page))[0].x).toBe(cam0.x);
  // Deux appuis distincts : deux étapes.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+z');
  expect((await items(page))[0].x).toBe(cam0.x + 20);
});

test('plan au sol : Alt pendant le glisser place au centimètre près', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await place(page, 'camera', 0.5, 0.5);
  await page.getByTestId('tool-select').click();
  const drag = async (alt: boolean) => {
    const b = (await page.getByTestId('fp-camera-body').boundingBox())!;
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(x + 23, y, { steps: 4 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
  };
  await drag(false);
  expect((await items(page))[0].x % 20).toBe(0);
  await drag(true);
  expect((await items(page))[0].x % 20).not.toBe(0);
});

test('plan au sol : repère vidé et largeur d’ouverture vide ou démesurée reprennent une valeur sûre', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await place(page, 'camera', 0.5, 0.5);
  const props = page.getByTestId('fp-properties');
  const label = props.getByLabel('Repère');
  await label.fill('');
  await label.press('Enter');
  await expect(props.getByLabel('Repère')).toHaveValue('CAM A');
  expect((await items(page))[0].label).toBe('CAM A');
  await place(page, 'door', 0.3, 0.3);
  const width = props.getByLabel('Largeur (cm)');
  await width.fill('');
  await width.press('Tab');
  await expect(width).toHaveValue('80');
  await width.fill('50000');
  await width.press('Enter');
  await expect(width).toHaveValue('1000');
});

test('plan au sol : porte couchée sur le mur, rails au simple clic, mur blanc nommé simplement', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await page.getByTestId('fp-room-toggle').click();
  await page.getByTestId('fp-panel').getByRole('radio', { name: /^Petite/ }).click();
  await expect(page.getByTestId('fp-wall')).toHaveCount(4);
  // Le mur est (vertical) : la porte posée dessus prend son angle.
  const walls = (await items(page)).filter((i) => i.kind === 'wall');
  const east = walls.find((w) => w.x === w.x2 && w.x === Math.max(...walls.map((v) => v.x)))!;
  const boxes = await Promise.all((await page.getByTestId('fp-wall').all()).map((l) => l.boundingBox()));
  const eastBox = boxes.reduce((a, b) => (b!.x > a!.x ? b : a))!;
  await page.getByTestId('tool-door').click();
  await page.mouse.click(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
  const door = (await items(page)).find((i) => i.kind === 'door')!;
  expect(door).toMatchObject({ x: east.x, rot: 90 });
  // Rails : un simple clic pose 1,6 m, à orienter par les poignées.
  await place(page, 'rail', 0.5, 0.85);
  await expect(page.getByTestId('fp-rail')).toHaveCount(1);
  await expect(page.getByTestId('fp-length')).toHaveText('Longueur 1,6 m');
  await expect(page.getByTestId('fp-end2')).toHaveCount(1);
  // Mur ajouté : la case se nomme sans explication.
  await place(page, 'wall', 0.2, 0.9);
  await expect(page.getByTestId('fp-properties').getByLabel('Mur blanc', { exact: true })).toHaveCount(1);
});

test('plan au sol : distances caméra → comédiens, comédien nommé une fois', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await place(page, 'camera', 0.5, 0.8);
  await place(page, 'actor', 0.5, 0.4);
  const actor = page.getByTestId('fp-actor');
  const name = (await actor.locator('text').allTextContents()).join('|');
  expect(name.split('|').filter(Boolean)).toHaveLength(1);
  await page.getByTestId('tool-select').click();
  await page.getByTestId('fp-item').first().click();
  await expect(page.getByTestId('fp-distances')).toHaveText(/ \d+(,\d+)? m$/);
});

test('plan au sol : onglets des vues au clavier, élément du panneau ramené dans le champ', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await page.getByTestId('add-plan').click();
  const v1 = page.getByRole('tab', { name: 'Vue 1' });
  await v1.click();
  await v1.press('F2');
  await page.getByLabel('Nom de la vue').fill('Large');
  await page.getByLabel('Nom de la vue').press('Enter');
  await expect(page.getByRole('tab', { name: 'Large' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Vue 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Large' })).toHaveAttribute('tabindex', '-1');
  // Projecteur posé, vue déplacée au loin à la molette : la ligne du panneau le ramène.
  await place(page, 'light', 0.5, 0.5);
  await page.getByTestId('tool-select').click();
  const c = await at(page, 0.5, 0.5);
  await page.mouse.move(c.x, c.y);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(600, 0);
  const svg = (await page.getByTestId('floorplan').boundingBox())!;
  const vb0 = await page.getByTestId('floorplan').getAttribute('viewBox');
  await page.getByTestId('fp-item').first().click();
  await expect(page.getByTestId('floorplan')).not.toHaveAttribute('viewBox', vb0!);
  const light = (await page.getByTestId('fp-light').locator('circle').first().boundingBox())!;
  expect(light.x).toBeGreaterThan(svg.x + 64);
  expect(light.x + light.width).toBeLessThan(svg.x + svg.width);
  expect((await page.getByTestId('floorplan').getAttribute('viewBox'))!.split(' ')[2]).toBe(vb0!.split(' ')[2]);
});

test('plan au sol : recentrer une grande pièce laisse la place à la palette et aux cotes', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await page.getByTestId('fp-room-toggle').click();
  const room = page.getByTestId('fp-panel').getByTestId('fp-room');
  await room.getByLabel('Largeur de la pièce (m)').fill('30');
  await room.getByLabel('Longueur de la pièce (m)').fill('12');
  await room.getByLabel('Longueur de la pièce (m)').press('Enter');
  await expect(page.getByTestId('fp-wall')).toHaveCount(4);
  await page.getByTestId('fp-fit').click();
  const svg = (await page.getByTestId('floorplan').boundingBox())!;
  const palette = (await page.getByRole('toolbar', { name: 'Outils du plan au sol' }).boundingBox())!;
  const boxes = await Promise.all((await page.getByTestId('fp-wall').all()).map((l) => l.boundingBox()));
  expect(Math.min(...boxes.map((b) => b!.x))).toBeGreaterThan(palette.x + palette.width);
  for (const d of await page.getByTestId('fp-dimension').all()) {
    const b = (await d.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(svg.x);
    expect(b.y).toBeGreaterThanOrEqual(svg.y);
    expect(b.x + b.width).toBeLessThanOrEqual(svg.x + svg.width);
    expect(b.y + b.height).toBeLessThanOrEqual(svg.y + svg.height);
  }
});

test('plan au sol : bouton du milieu ou Espace + glisser déplacent la vue, sans rien modifier', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await place(page, 'light', 0.5, 0.5);
  await page.getByTestId('tool-select').click();
  await page.getByTestId('floorplan').press('Escape');
  const canvas = page.getByTestId('floorplan');
  const box = (await canvas.boundingBox())!;
  const vb = async () => (await canvas.getAttribute('viewBox'))!.split(' ').map(Number);
  const before = await items(page);
  const [x0, , w0] = await vb();
  const step = (200 * w0) / box.width;
  const c = await at(page, 0.3, 0.3);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(c.x - 200, c.y, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const [x1, , w1] = await vb();
  expect(w1).toBe(w0);
  expect(Math.abs(x1 - x0 - step)).toBeLessThan(2);
  expect(await items(page)).toEqual(before);
  // Espace maintenu : même geste au bouton principal, sans cadre de sélection.
  await canvas.focus();
  await page.keyboard.down(' ');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 200, c.y + 50, { steps: 5 });
  await expect(page.getByTestId('fp-marquee')).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up(' ');
  const [x2] = await vb();
  expect(Math.abs(x2 - x1 - step)).toBeLessThan(2);
  expect(await items(page)).toEqual(before);
});
