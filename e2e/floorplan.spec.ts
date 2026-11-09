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
  // Outil caméra toujours actif : cliquer la caméra posée la reprend au lieu d'en ajouter une.
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('fp-camera')).toHaveCount(1);
  const props = page.getByTestId('fp-properties');
  await expect(props).toContainText('Caméra');
  // Plans couverts : cochés dans la liste des plans du panneau, caméra sélectionnée.
  await page.getByTestId('fp-shots').getByLabel('Plan 1.1 couvert par CAM A').check();
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
  const cam = page.getByTestId('fp-camera-body');
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
  // Lampe de jeu : rayonne tout autour.
  await page.getByTestId('tool-practical').click();
  const lamp = await at(page, 0.8, 0.2);
  await page.mouse.click(lamp.x, lamp.y);
  await expect(page.getByTestId('fp-practical')).toHaveCount(1);
  await expect(page.getByTestId('fp-properties')).toContainText('Lampe de jeu');
  await page.getByTestId('tool-select').click();
  await page.getByTestId('floorplan').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('fp-practical')).toHaveCount(0);
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
  // Pivoter le réflecteur en tirant une extrémité.
  const line = page.getByTestId('fp-reflector').locator('line').last();
  const before = await line.getAttribute('x2');
  const end = (await page.getByTestId('fp-end2').boundingBox())!;
  const r = await at(page, 0.55, 0.62);
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x, r.y, { steps: 6 });
  await page.mouse.up();
  expect(await line.getAttribute('x2')).not.toBe(before);
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
  await expect(page.getByTestId('fp-wall')).toHaveCount(3);
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

test('plan au sol : palette, raccourcis, clic droit sans effet, vues renommées et dupliquées, un geste = une annulation', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  const canvas = page.getByTestId('floorplan');
  await canvas.focus();
  await page.keyboard.press('c');
  await expect(page.getByTestId('tool-camera')).toHaveAttribute('aria-pressed', 'true');
  const box = (await canvas.boundingBox())!;
  // Le clic droit ne pose rien.
  await page.mouse.click(box.x + 420, box.y + 300, { button: 'right' });
  await expect(page.getByTestId('fp-camera')).toHaveCount(0);
  await page.mouse.click(box.x + 420, box.y + 300);
  await expect(page.getByTestId('fp-camera')).toHaveCount(1);
  // Une vue se renomme sur place et se duplique avec son contenu.
  await page.getByRole('tab', { name: 'Vue 1' }).dblclick();
  await page.getByLabel('Nom de la vue').fill('Plan large');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Plan large', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dupliquer la vue' }).click();
  await expect(page.getByRole('tab', { name: 'Plan large (copie)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('fp-camera')).toHaveCount(1);
  const ids = await page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { floorPlans: Record<string, { items: Array<{ id: string }> }> } } }).__ds.doc();
    return Object.values(d.floorPlans).flatMap((p) => p.items.map((i) => i.id));
  });
  expect(new Set(ids).size).toBe(ids.length);
  // Un projecteur : glisser le curseur de puissance n'ajoute qu'une étape d'annulation.
  await page.keyboard.press('Escape');
  await canvas.focus();
  await page.keyboard.press('l');
  await page.mouse.click(box.x + 250, box.y + 200);
  const props = page.getByTestId('fp-properties');
  await expect(props).toContainText('Intensité : 100 %');
  const slider = (await props.getByLabel('Intensité').boundingBox())!;
  await page.mouse.move(slider.x + slider.width * 0.55, slider.y + slider.height / 2);
  await page.mouse.down();
  for (const f of [0.6, 0.7, 0.8, 0.95]) await page.mouse.move(slider.x + slider.width * f, slider.y + slider.height / 2);
  await page.mouse.up();
  await expect(props).not.toContainText('Intensité : 100 %');
  await page.keyboard.press('Control+z');
  await expect(props).toContainText('Intensité : 100 %');
});

test('plan au sol : l’assistant trace les murs depuis l’image du plan des locaux (aperçu à valider)', async ({ page }) => {
  // Fournisseur compatible OpenAI simulé : il reçoit l'image et répond par le plan.
  await page.addInitScript(() => localStorage.setItem('ds-ai', JSON.stringify({ provider: 'custom', keys: {}, models: { custom: 'vision-test' }, baseUrl: 'https://ia.test/v1' })));
  let sent: { model?: string; messages?: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }> } = {};
  await page.route('https://ia.test/v1/chat/completions', async (route) => {
    sent = JSON.parse(route.request().postData() ?? '{}');
    const plan = ['Voici le plan :', '# PLAN DECOUPAGE-STUDIO v2', 'repere: image', 'grille: 1000x750', 'echelle_cm_par_unite: inconnue', 'murs: 2', 'portes: 0', 'fenetres: 1', '## MURS', 'M001 | 100,100 -> 900,100 | standard', 'M002 | 900,100 -> 900,650 | standard', '## PORTES', '## FENETRES', 'F001 | 900,400 | 80 | 90', '## FIN'].join('\n');
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: plan }, finish_reason: 'stop' }] }) });
  });
  await page.goto('/#/floorplan?seed=rav3');
  // Image de fond : un rectangle tracé à la volée (4:3).
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 300);
    ctx.strokeRect(40, 40, 320, 220);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('fp-bg-input').setInputFiles({ name: 'locaux.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByTestId('fp-background')).toHaveCount(1);
  await page.getByTestId('fp-plan-menu').click();
  await page.getByTestId('fp-ai-trace').click();
  await expect(page.getByTestId('fp-ai-report')).toContainText('2 murs, 0 portes, 1 fenêtres');
  await expect(page.getByTestId('fp-ai-errors')).toHaveCount(0);
  const content = sent.messages![0].content;
  expect(sent.model).toBe('vision-test');
  expect(content.find((c) => c.type === 'image_url')!.image_url!.url).toMatch(/^data:image\/png;base64,/);
  expect(content.find((c) => c.type === 'text')!.text).toContain('LIVRAISON : LE PLAN');
  await page.getByTestId('fp-ai-apply').click();
  await expect(page.getByTestId('fp-wall')).toHaveCount(2);
});

test('plan au sol : pièce aux dimensions réelles et projecteur chiffré (W, K)', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  await page.getByTestId('fp-panel').getByRole('button', { name: 'Pièce moyenne' }).click();
  await expect(page.getByTestId('fp-room-size')).toContainText('Superficie 45 m² · volume 135 m³');
  await expect(page.getByTestId('fp-items')).toContainText('4 murs');
  await page.getByRole('button', { name: /^Projecteur/ }).first().click();
  const svg = page.locator('svg').filter({ has: page.locator('pattern') }).first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByLabel('Modèle du projecteur').fill('HMI 1 800 W (M18)');
  await expect(page.getByTestId('fp-watts')).toHaveValue('1800');
  await expect(page.getByTestId('fp-kelvin')).toHaveValue('5600');
  await expect(page.getByTestId('fp-light').last()).toContainText('1,8 kW');
  await page.goto('/#/equipment');
  await expect(page.getByText('HMI 1 800 W (M18) (1800 W, 5600 K)')).toBeVisible();
});


test('plan au sol : panneau latéral, caméra posée depuis un plan, éléments du plan sélectionnables', async ({ page }) => {
  await page.goto('/#/floorplan?seed=fiction');
  const panel = page.getByTestId('fp-panel');
  const shots = panel.getByTestId('fp-shot');
  await expect(shots).toHaveCount(4);
  await expect(shots.first()).toContainText('Général · 24mm');
  await expect(panel.getByTestId('fp-shots')).toContainText('0 / 4 avec caméra');
  // Un plan sans caméra : on la pose d'un clic, liée au plan, et elle est sélectionnée.
  await panel.getByRole('button', { name: 'Placer une caméra pour le plan 1.1' }).click();
  await expect(page.getByTestId('fp-camera')).toHaveCount(1);
  await expect(page.getByTestId('fp-camera')).toContainText('CAM A · 24mm');
  await expect(page.getByTestId('fp-properties')).toContainText('Caméra');
  await expect(panel.getByTestId('fp-shots')).toContainText('1 / 4 avec caméra');
  await expect(shots.first().getByRole('button', { name: 'CAM A' })).toBeVisible();
  // Inventaire de la vue : un projecteur posé, puis repris depuis la liste.
  await page.getByTestId('tool-light').click();
  const box = (await page.getByTestId('floorplan').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.getByTestId('tool-select').click();
  const items = panel.getByTestId('fp-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('CAM A');
  await expect(items.nth(1)).toContainText('L1');
  await items.first().click();
  await expect(page.getByTestId('fp-properties')).toContainText('Caméra');
  await shots.first().getByRole('button', { name: 'CAM A' }).click();
  await expect(items.first()).toHaveAttribute('aria-pressed', 'true');
  // Un rail tracé : sa longueur s'affiche.
  await page.getByTestId('tool-rail').click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('fp-length')).toContainText(/Longueur \d+(,\d+)? m/);
  // Tout sélectionner : un seul bouton pour retirer la sélection.
  await page.getByTestId('tool-select').click();
  await page.getByTestId('floorplan').focus();
  await page.keyboard.press('Control+a');
  await expect(panel.getByTestId('fp-multi')).toContainText('3 éléments');
  await panel.getByTestId('fp-multi').getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByTestId('fp-items')).toHaveCount(0);
  await expect(panel.getByTestId('fp-shots')).toContainText('0 / 4 avec caméra');
});
