import { expect, test, type Page } from '@playwright/test';

// Fausses tuiles et fausses réponses Nominatim : rien ne part sur le réseau.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==', 'base64');
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
      return route.fulfill({ contentType: 'image/png', body: PNG });
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
