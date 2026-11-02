import { expect, test, type Browser, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

// Serveur de mise en relation local : le service public de PeerJS n'est pas joignable en test.
const PORT = 9123;
let server: ReturnType<typeof PeerServer> | null = null;
test.beforeAll(() => {
  server = PeerServer({ port: PORT, path: '/', host: '127.0.0.1' });
});
test.afterAll(() => {
  (server as unknown as { close?: () => void } | null)?.close?.();
});

async function participant(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript((port) => localStorage.setItem('ds-peer-server', `localhost:${port}`), PORT);
  return ctx.newPage();
}

test('partager un projet : lien et mot de passe, modifications en direct, lecture seule, fermeture', async ({ browser }) => {
  const host = await participant(browser);
  await host.goto('/#/grid?seed=rav3');
  await host.getByTestId('share-button').click();
  await host.getByTestId('share-start').click();
  const link = await host.getByTestId('share-link').textContent();
  const password = await host.getByTestId('share-password').textContent();
  expect(link).toContain('#/join?room=');

  const guest = await participant(browser);
  await guest.goto(link!);
  await guest.getByLabel('Votre nom').fill('Nina');
  // Mauvais mot de passe : refusé.
  await guest.getByLabel('Mot de passe').fill('faux');
  await guest.getByTestId('join-go').click();
  await expect(guest.getByText('Mot de passe incorrect.')).toBeVisible();
  await guest.getByLabel('Mot de passe').fill(password!);
  await guest.getByTestId('join-go').click();
  await expect(guest.getByTestId('guest-banner')).toContainText('modification');
  await expect(guest.locator('[data-testid="shot-row"]')).toHaveCount(53);
  await expect(host.getByTestId('share-guests')).toContainText('Nina');

  // L'invité modifie : l'hôte le voit, et inversement.
  await guest.locator('[data-cell="0:subject"]').click();
  await guest.keyboard.type('Depuis Nina');
  await guest.keyboard.press('Enter');
  await expect(host.locator('[data-cell="0:subject"]')).toHaveText('Depuis Nina');
  await host.keyboard.press('Escape');
  await host.locator('[data-cell="1:value"]').click();
  await host.keyboard.type('Insert');
  await host.keyboard.press('Enter');
  await expect(guest.locator('[data-cell="1:value"]')).toHaveText('Insert');

  // Lecture seule : les saisies de l'invité ne changent plus rien.
  await host.getByTestId('share-button').click();
  await host.getByTestId('share-panel').getByText('seulement lire').click();
  await expect(guest.getByTestId('guest-banner')).toContainText('lecture seule');
  await guest.locator('[data-cell="2:subject"]').click();
  await guest.keyboard.type('Interdit');
  await guest.keyboard.press('Enter');
  await expect(host.locator('[data-cell="2:subject"]')).not.toContainText('Interdit');

  // Fermeture du partage : l'invité est prévenu.
  await host.getByTestId('share-stop').click();
  await expect(guest.getByTestId('guest-banner')).toContainText('Partage fermé');
});
