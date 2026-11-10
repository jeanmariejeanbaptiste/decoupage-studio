import { expect, test, type Locator, type Page } from '@playwright/test';

async function at(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('floorplan').boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Couleur calculée (r, g, b) d'une propriété CSS. */
async function rgb(loc: Locator, prop: 'stopColor' | 'fill' | 'backgroundColor'): Promise<[number, number, number]> {
  const v = await loc.evaluate((el, p) => getComputedStyle(el)[p as 'fill'], prop);
  const m = v.match(/[\d.]+/g)!.map(Number);
  return [m[0], m[1], m[2]];
}

for (const theme of ['papier', 'encre'] as const) {
  test(`plan au sol (${theme}) : la température de couleur teinte le faisceau, la lampe de jeu et la liste ; sans elle, gris`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('ds-theme', t), theme);
    await page.goto('/#/floorplan?seed=fiction');
    await page.getByTestId('tool-light').click();
    const p = await at(page, 0.3, 0.3);
    await page.mouse.click(p.x, p.y);
    const beam = page.getByTestId('fp-beam');
    await expect(beam).toHaveCount(1);
    const stop = beam.locator('stop').first();
    // Sans température : le gris du thème (aucune teinte dominante), rien dans la liste.
    const [r0, g0, b0] = await rgb(stop, 'stopColor');
    expect(Math.max(r0, g0, b0) - Math.min(r0, g0, b0)).toBeLessThan(25);
    await expect(page.getByTestId('fp-item-kelvin')).toHaveCount(0);
    // Chaque valeur courante porte sa teinte, discrètement.
    const props = page.getByTestId('fp-properties');
    const presets = props.getByRole('button', { name: /^\d\s?\d{3} K$/ });
    await expect(presets).toHaveCount(3);
    const [w3] = await rgb(presets.first().locator('i'), 'backgroundColor').then(([r, , b]) => [r - b]);
    const [w56] = await rgb(presets.last().locator('i'), 'backgroundColor').then(([r, , b]) => [r - b]);
    expect(w3).toBeGreaterThan(w56);
    // Tungstène : faisceau chaud, repère dans la liste.
    await presets.first().click();
    await expect(beam).toHaveAttribute('data-kelvin', '3200');
    const [r1, , b1] = await rgb(stop, 'stopColor');
    expect(r1 - b1).toBeGreaterThan(60);
    await expect(page.getByTestId('fp-item-kelvin')).toHaveCount(1);
    await expect(page.getByTestId('fp-kelvin-tint')).toBeVisible();
    // 8 000 K saisi : bleuté.
    await page.getByTestId('fp-kelvin').fill('8000');
    await page.getByTestId('fp-kelvin').blur();
    await expect(beam).toHaveAttribute('data-kelvin', '8000');
    const [r2, , b2] = await rgb(stop, 'stopColor');
    expect(b2 - r2).toBeGreaterThan(40);
    // Annuler : de nouveau le tungstène.
    await page.getByTestId('floorplan').focus();
    await page.keyboard.press('Control+z');
    await expect(beam).toHaveAttribute('data-kelvin', '3200');
    // Valeur aberrante : pas de teinte, le faisceau redevient gris.
    await page.getByTestId('fp-item').filter({ hasText: 'L1' }).click();
    await page.getByTestId('fp-kelvin').fill('32');
    await page.getByTestId('fp-kelvin').blur();
    await expect(beam).not.toHaveAttribute('data-kelvin', /./);
    await expect(page.getByTestId('fp-item-kelvin')).toHaveCount(0);
    // Lampe de jeu à 2 700 K : l'ampoule et sa lumière prennent la teinte.
    await page.getByTestId('tool-practical').click();
    const q = await at(page, 0.7, 0.7);
    await page.mouse.click(q.x, q.y);
    await page.getByTestId('fp-kelvin').fill('2700');
    await page.getByTestId('fp-kelvin').blur();
    const [r3, , b3] = await rgb(page.getByTestId('fp-practical').locator('circle'), 'fill');
    expect(r3 - b3).toBeGreaterThan(80);
    await expect(page.getByTestId('fp-items')).toContainText('Lampe de jeu · 2');
    await expect(page.getByTestId('fp-item-kelvin')).toHaveCount(1);
    // Le reste du plan reste en noir, gris et blanc : le symbole du projecteur n'est pas teinté.
    const [rs, gs, bs] = await rgb(page.getByTestId('fp-light').locator('path').first(), 'fill');
    expect(Math.max(rs, gs, bs) - Math.min(rs, gs, bs)).toBeLessThan(12);
  });
}
