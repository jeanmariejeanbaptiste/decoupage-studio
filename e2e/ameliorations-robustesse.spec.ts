import { expect, test, type Page } from '@playwright/test';

/** Écritures IndexedDB refusées (stockage plein) ou rétablies. */
const breakStorage = (page: Page, broken: boolean) =>
  page.evaluate((b) => {
    const w = window as unknown as { __put?: typeof IDBObjectStore.prototype.put };
    w.__put ??= IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = b
      ? () => {
          throw new DOMException('Stockage plein', 'QuotaExceededError');
        }
      : w.__put;
  }, broken);

test.describe('échec de l’enregistrement', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test('alerte visible sur écran étroit, nouvel essai automatique, confirmation avant de fermer', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    const status = page.getByTestId('save-status');
    // En temps normal, l'état d'enregistrement est masqué à cette largeur.
    await expect(page.locator('[data-cell="0:subject"]')).toBeVisible();
    await expect(status).toBeHidden();
    await breakStorage(page, true);
    await page.locator('[data-cell="0:subject"]').click();
    await page.keyboard.type('Robustesse');
    await page.keyboard.press('Enter');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('role', 'alert');
    await expect(status).toHaveAttribute('title', 'Échec de l’enregistrement');

    // Fermer l'onglet maintenant ferait perdre la modification : le navigateur demande confirmation.
    const dialog = page.waitForEvent('dialog');
    void page.close({ runBeforeUnload: true });
    const d = await dialog;
    expect(d.type()).toBe('beforeunload');
    await d.dismiss();
    await expect.poll(() => page.isClosed()).toBe(false);

    // Stockage rétabli : l'essai suivant enregistre sans autre geste, l'alerte disparaît.
    await breakStorage(page, false);
    await expect(status).toBeHidden({ timeout: 10_000 });
    const stored = await page.evaluate(
      () =>
        new Promise<string>((ok, ko) => {
          const id = (window as unknown as { __ds: { doc: () => { project: { id: string } } } }).__ds.doc().project.id;
          const req = indexedDB.open('decoupage-studio');
          req.onerror = () => ko(req.error);
          req.onsuccess = () => {
            const get = req.result.transaction('projects').objectStore('projects').get(id);
            get.onsuccess = () => ok(JSON.stringify(get.result?.doc ?? null));
            get.onerror = () => ko(get.error);
          };
        }),
    );
    expect(stored).toContain('Robustesse');
  });
});
