import { expect, test } from '@playwright/test';

test('lien sans connexion : s’ouvre sans l’hôte, en lecture seule, rien n’est enregistré', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const host = await hostCtx.newPage();
  await host.goto('/#/grid?seed=rav3');
  await expect(host.locator('[data-testid="shot-row"]').first()).toBeVisible();
  await host.getByTestId('share-button').click();
  await host.getByTestId('share-snapshot').click();
  await expect(host.getByTestId('share-snapshot')).toHaveText('Lien copié');
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#/view/');
  // L'hôte s'en va : le lien marche quand même.
  await hostCtx.close();

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(link);
  await expect(guest.getByTestId('guest-banner')).toContainText('lecture seule');
  await expect(guest).toHaveURL(/#\/grid/);
  await expect(guest.getByTestId('export-table').first()).toBeVisible();
  await expect(guest.locator('[data-testid="shot-row"]')).toHaveCount(0);
  await guest.goto('/#/scenario?view=script');
  await expect(guest.getByTestId('guest-banner')).toBeVisible();
  // Rien n'est enregistré chez l'invité.
  expect(await guest.evaluate(async () => (await indexedDB.databases()).length === 0 || !(await new Promise<number>((res) => {
    const r = indexedDB.open('decoupage-studio');
    r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('projects')) return res(0); const c = db.transaction('projects').objectStore('projects').count(); c.onsuccess = () => res(c.result); };
    r.onerror = () => res(0);
  })))).toBe(true);

  // Lien abîmé : message clair.
  await guest.goto('/#/view/abime');
  await expect(guest.getByTestId('snapshot-landing')).toContainText('Lien illisible');
});
