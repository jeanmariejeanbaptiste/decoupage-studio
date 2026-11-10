import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Fausses tuiles et fausses réponses Nominatim : rien ne part sur le réseau.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGO4AAAA0gDR29kOtwAAAABJRU5ErkJggg==', 'base64');
const KNOWN: Record<string, [number, number]> = {
  voltaire: [48.8589, 2.3318],
  clovis: [48.853, 2.3499],
  belleville: [48.8722, 2.3767],
  'ambroise-paré': [48.8826, 2.3522],
  bastille: [48.8532, 2.3691],
};

async function fakeOsm(page: Page) {
  const queries: Array<{ q: string; at: number }> = [];
  const tiles: string[] = [];
  await page.route(/^https?:\/\/(?!localhost)/, (route) => {
    const url = route.request().url();
    if (url.startsWith('https://tile.openstreetmap.org/')) {
      tiles.push(url);
      // Servies en CORS, comme les vraies : l'export peut les dessiner sur un canevas.
      return route.fulfill({ contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.startsWith('https://nominatim.openstreetmap.org/search?')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      queries.push({ q, at: Date.now() });
      const hit = Object.entries(KNOWN).find(([k]) => q.toLowerCase().includes(k));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(hit ? [{ lat: String(hit[1][0]), lon: String(hit[1][1]) }] : []) });
    }
    return route.abort();
  });
  return { queries, tiles };
}

test('carte des lieux : géocodage une fois, marqueurs par jour, masquable, hors ligne', async ({ page, context }) => {
  const osm = await fakeOsm(page);
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  // Sans adresse, ni carte ni bouton.
  await expect(page.getByTestId('map-toggle')).toHaveCount(0);

  // Adresses du jour 1 sur la feuille de service, dont une introuvable, et l'hôpital.
  await page.getByRole('button', { name: 'Feuille de service' }).click();
  const stops = page.getByTestId('stop-address');
  await stops.nth(0).fill('3 quai Voltaire, Paris');
  await stops.nth(1).fill('23 rue Clovis, Paris');
  await stops.nth(2).fill('7 impasse Introuvable, Nulle-Part');
  await page.getByLabel('Hôpital le plus proche').fill('Hôpital Lariboisière, 2 rue Ambroise-Paré, 75010 Paris, 01 49 95 65 65');
  // Carte réduite des lieux du jour, numérotés dans l'ordre de la journée.
  const dayMap = page.getByTestId('day-map');
  await expect(dayMap.getByTestId('map-place')).toHaveCount(4);
  await expect(dayMap.locator('.ds-pin')).toHaveText(['1', '2', 'H'], { timeout: 10_000 });
  await expect(dayMap.getByTestId('map-place').nth(2)).toHaveAttribute('data-state', 'missing');
  await expect(dayMap.getByTestId('map-place').nth(2)).toContainText('introuvable');
  await expect(dayMap.getByTestId('map-place').nth(3)).toContainText('2 rue Ambroise-Paré, 75010 Paris');
  // Une requête par seconde au plus ; le téléphone de l'hôpital n'est jamais envoyé.
  for (let i = 1; i < osm.queries.length; i++) expect(osm.queries[i].at - osm.queries[i - 1].at).toBeGreaterThanOrEqual(950);
  expect(osm.queries.some((x) => /01 49/.test(x.q))).toBe(false);
  expect(osm.tiles.length).toBeGreaterThan(0);

  // Le plan de travail : tous les lieux ; un jour choisi met les siens en avant.
  await page.getByLabel('Jour de tournage').selectOption('2');
  await page.getByTestId('stop-address').first().fill('Place de la Bastille, Paris');
  await page.getByRole('button', { name: 'Plan de travail' }).click();
  const map = page.getByTestId('schedule-map');
  await expect(page.getByTestId('map-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByTestId('map-place')).toHaveCount(5);
  await expect(map.locator('.ds-pin')).toHaveCount(4, { timeout: 10_000 });
  await map.getByTestId('map-day-2').click();
  await expect(map.getByTestId('map-place')).toHaveCount(1);
  await expect(map.locator('.ds-pin--on')).toHaveText(['2']);
  await expect(map.locator('.ds-pin--off')).toHaveCount(3);
  // Infobulle : décor et adresse.
  await map.locator('.ds-pin--on').hover();
  await expect(page.locator('.ds-tip')).toContainText('Place de la Bastille, Paris');
  await expect(map.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();

  // Rien n'est recherché deux fois : les résultats sont gardés dans le projet.
  const asked = osm.queries.length;
  await page.waitForTimeout(800);
  await expect(page.getByText('Enregistré dans le navigateur')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('schedule-map').locator('.ds-pin')).toHaveCount(4);
  await page.waitForTimeout(1500);
  expect(osm.queries.length).toBe(asked);

  // Carte masquée (retenu) : aucune recherche pour une nouvelle adresse.
  await page.getByTestId('map-toggle').click();
  await expect(page.getByTestId('schedule-map')).toHaveCount(0);
  await page.getByRole('button', { name: 'Feuille de service' }).click();
  await expect(page.getByTestId('day-map')).toHaveCount(0);
  await page.getByLabel('Jour de tournage').selectOption('2');
  await page.getByTestId('stop-address').nth(1).fill('12 rue de Belleville, Paris');
  await page.waitForTimeout(800);
  await expect(page.getByText('Enregistré dans le navigateur')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('map-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  expect(osm.queries.length).toBe(asked);

  // Hors ligne : ni tuiles ni recherche, l'adresse attend.
  await context.setOffline(true);
  const tiles = osm.tiles.length;
  await page.getByLabel('Jour de tournage').selectOption('2');
  await page.getByTestId('map-toggle').click();
  await expect(page.getByTestId('day-map').getByTestId('map-place').filter({ hasText: 'Belleville' })).toHaveAttribute('data-state', 'offline');
  await page.waitForTimeout(1500);
  expect(osm.queries.length).toBe(asked);
  expect(osm.tiles.length).toBe(tiles);
  // De retour en ligne, la recherche reprend.
  await context.setOffline(false);
  await expect(page.getByTestId('day-map').getByTestId('map-place').filter({ hasText: 'Belleville' })).toHaveAttribute('data-state', 'ok', { timeout: 10_000 });
  expect(osm.queries.length).toBe(asked + 1);
});

test('feuille de service : carte des lieux du jour et liens d’itinéraire cliquables dans le PDF et le Word', async ({ page }) => {
  const osm = await fakeOsm(page);
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  await page.getByRole('button', { name: 'Feuille de service' }).click();
  await page.getByTestId('stop-address').first().fill('3 quai Voltaire, Paris');
  await page.getByLabel('Hôpital le plus proche').fill('Hôpital Lariboisière, 2 rue Ambroise-Paré, 75010 Paris');
  const rows = page.getByTestId('day-map').getByTestId('map-place');
  await expect(rows.first()).toHaveAttribute('data-state', 'ok', { timeout: 10_000 });
  await expect(rows.last()).toHaveAttribute('data-state', 'ok', { timeout: 10_000 });
  const exportAs = async (format: string) => {
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId('tab-export').click();
    await page.getByTestId('tab-export-panel').getByText(format, { exact: true }).click();
    await page.getByTestId('tab-export-go').click();
    return readFileSync(await (await dl).path()).toString('latin1');
  };
  // PDF : une annotation par lien, vers l'itinéraire de chaque lieu géocodé (décor, hôpital) ;
  // la carte réduite est composée à l'export, à partir des tuiles.
  const tiles = osm.tiles.length;
  const pdf = await exportAs('PDF');
  expect(osm.tiles.length).toBeGreaterThan(tiles);
  expect(pdf).toContain('/URI (https://www.openstreetmap.org/directions?route=%3B48.8589%2C2.3318#map=16/48.8589/2.3318)');
  expect(pdf).toContain('/URI (https://www.openstreetmap.org/directions?route=%3B48.8826%2C2.3522#map=16/48.8826/2.3522)');
  const word = await exportAs('Word');
  expect(word).toContain('href="https://www.openstreetmap.org/directions?route=%3B48.8589%2C2.3318');
  expect(word).toMatch(/<h3>Lieux du jour<\/h3><div class="cs-map"><img src="data:image\/png;base64,[A-Za-z0-9+/=]{400,}" width="560" height="260"/);
  expect(word).toContain('<li><span class="pin">1</span>');
  expect(word).toMatch(/<li><span class="pin h">H<\/span>H.{1,2}pital Lariboisi/);
  // Carte masquée : ni carte ni tuile à l'export.
  await page.getByTestId('map-toggle').click();
  const before = osm.tiles.length;
  const plain = await exportAs('Word');
  expect(plain).not.toContain('class="cs-map"');
  expect(osm.tiles.length).toBe(before);
});

test('plan de travail : la carte reste sous les fenêtres et les panneaux ; outils du jour à place fixe', async ({ page }) => {
  await fakeOsm(page);
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto('/#/schedule?seed=rav3');
  await page.getByTestId('suggest-schedule').click();
  // Tout est planifié : la réserve le dit, sans en-tête ni indication.
  await expect(page.getByTestId('band-0')).toHaveText('Tout est planifié.');
  await page.getByRole('button', { name: 'Feuille de service' }).click();
  await page.getByTestId('stop-address').first().fill('3 quai Voltaire, Paris');
  await page.getByRole('button', { name: 'Plan de travail' }).click();
  const map = page.getByTestId('schedule-map').getByTestId('map');
  await expect(page.getByTestId('schedule-map').locator('.ds-pin')).toHaveCount(1, { timeout: 10_000 });
  // Les tuiles ignorent le pointeur : on les rend visibles au test de recouvrement, sans rien changer à l'ordre d'affichage.
  await page.addStyleTag({ content: '.ds-map * { pointer-events: auto !important; }' });

  // Ce qui s'ouvre par-dessus la carte reste au-dessus : fenêtre de confirmation, panneau d'export.
  type Box = { x: number; y: number; width: number; height: number };
  const onTop = async (box: Box, selector: string) =>
    page.evaluate(([x, y, sel]) => !!document.elementFromPoint(x, y)?.closest(sel), [box.x + box.width / 2, box.y + box.height / 2, selector] as [number, number, string]);
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  await page.getByTestId('suggest-schedule').click();
  const dialog = page.getByRole('alertdialog');
  const dlgBox = (await dialog.boundingBox())!;
  expect(overlaps(dlgBox, (await map.boundingBox())!)).toBe(true);
  expect(await onTop(dlgBox, '[role="alertdialog"]')).toBe(true);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await page.getByTestId('tab-export').click();
  const panel = page.getByTestId('tab-export-panel');
  const panelBox = (await panel.boundingBox())!;
  expect(overlaps(panelBox, (await map.boundingBox())!)).toBe(true);
  expect(await onTop(panelBox, '[data-testid="tab-export-panel"]')).toBe(true);
  await page.keyboard.press('Escape');

  // Une date longue ne déplace pas les outils du jour.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByLabel('Date du jour 1').fill('2026-11-09');
  const place = async (n: number) => {
    const band = (await page.getByTestId(`band-${n}`).boundingBox())!;
    const tool = (await page.getByTestId(`timeline-toggle-${n}`).boundingBox())!;
    return { x: Math.round(tool.x), dy: Math.round(tool.y - band.y) };
  };
  expect(await place(1)).toEqual(await place(2));
});
