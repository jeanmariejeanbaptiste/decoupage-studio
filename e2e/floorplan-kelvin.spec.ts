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

/**
 * Couleur affichée (moyenne de 5 × 5 pixels) sur l'axe du faisceau, à `f` de sa portée : ce que
 * l'œil voit, dégradé, opacité et mode de fusion compris.
 */
async function pixel(page: Page, beam: Locator, f: number): Promise<[number, number, number]> {
  const p = await beam.locator('polygon').evaluate((el, frac) => {
    const poly = el as SVGPolygonElement;
    const pts = poly.getAttribute('points')!.split(' ').map((s) => s.split(',').map(Number));
    const [ax, ay] = pts[0];
    const [mx, my] = pts[1 + Math.floor((pts.length - 1) / 2)];
    const ctm = poly.getScreenCTM()!;
    const q = new DOMPoint(ax + (mx - ax) * frac, ay + (my - ay) * frac).matrixTransform(ctm);
    return { x: q.x, y: q.y };
  }, f);
  await page.mouse.move(0, 0);
  const png = await page.screenshot({ clip: { x: Math.round(p.x) - 2, y: Math.round(p.y) - 2, width: 5, height: 5 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    const n = d.length / 4;
    return sum.map((v) => Math.round(v / n)) as [number, number, number];
  }, png.toString('base64'));
}

const spread = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b);

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
    // Sans température : un gris strictement neutre, rien dans la liste.
    expect(spread(await rgb(stop, 'stopColor'))).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('fp-item-kelvin')).toHaveCount(0);
    const grey = await pixel(page, beam, 0.25);
    // Chaque valeur courante porte sa teinte, discrètement.
    const props = page.getByTestId('fp-properties');
    const presets = props.getByRole('button', { name: /^\d\s?\d{3} K$/ });
    await expect(presets).toHaveCount(3);
    const [w3] = await rgb(presets.first().locator('i'), 'backgroundColor').then(([r, , b]) => [r - b]);
    const [w56] = await rgb(presets.last().locator('i'), 'backgroundColor').then(([r, , b]) => [r - b]);
    expect(w3).toBeGreaterThan(w56);
    // Puissance et température : deux champs de même largeur.
    const [wBox, kBox] = [await page.getByTestId('fp-watts').boundingBox(), await page.getByTestId('fp-kelvin').boundingBox()];
    expect(Math.abs(wBox!.width - kBox!.width)).toBeLessThan(1);
    // Lumière du jour (5 600 K) : nettement plus froide que le gris sans température, au rendu même.
    await presets.last().click();
    await expect(beam).toHaveAttribute('data-kelvin', '5600');
    const [rd, , bd] = await rgb(stop, 'stopColor');
    expect(bd - rd).toBeGreaterThanOrEqual(25);
    const day = await pixel(page, beam, 0.25);
    expect(day[2] - day[0] - (grey[2] - grey[0])).toBeGreaterThanOrEqual(12);
    // Tungstène : faisceau chaud, repère dans la liste ; la valeur courante porte seule la teinte.
    await presets.first().click();
    await expect(beam).toHaveAttribute('data-kelvin', '3200');
    const [r1, , b1] = await rgb(stop, 'stopColor');
    expect(r1 - b1).toBeGreaterThan(60);
    const warm = await pixel(page, beam, 0.22);
    expect(warm[0] - warm[2]).toBeGreaterThan(50);
    await expect(page.getByTestId('fp-item-kelvin')).toHaveCount(1);
    await expect(page.getByTestId('fp-kelvin-tint')).toHaveCount(0);
    // 8 000 K saisi : bleuté ; valeur libre, sa teinte se loge dans le champ.
    await page.getByTestId('fp-kelvin').fill('8000');
    await page.getByTestId('fp-kelvin').blur();
    await expect(beam).toHaveAttribute('data-kelvin', '8000');
    const [r2, , b2] = await rgb(stop, 'stopColor');
    expect(b2 - r2).toBeGreaterThan(40);
    const cold = await pixel(page, beam, 0.22);
    expect(cold[2] - cold[0]).toBeGreaterThan(grey[2] - grey[0] + 15);
    await expect(page.getByTestId('fp-kelvin-tint')).toBeVisible();
    const [tBox, k2Box] = [await page.getByTestId('fp-kelvin-tint').boundingBox(), await page.getByTestId('fp-kelvin').boundingBox()];
    expect(tBox!.x).toBeGreaterThan(k2Box!.x);
    expect(tBox!.x + tBox!.width).toBeLessThan(k2Box!.x + k2Box!.width);
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
    await expect(page.getByTestId('fp-kelvin-tint')).toHaveCount(0);
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
