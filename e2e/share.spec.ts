import { expect, test, type Browser, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

test.describe.configure({ mode: 'serial' });

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

  // Lecture seule : l'invité ne peut plus rien modifier.
  await host.getByTestId('share-button').click();
  await host.getByTestId('share-panel').getByText('Lire seulement').click();
  await expect(guest.getByTestId('guest-banner')).toContainText('lecture seule');
  // La grille éditable laisse place à l'aperçu ; même au clavier, rien ne passe.
  await expect(guest.locator('[data-testid="shot-row"]')).toHaveCount(0);
  await expect(guest.getByTestId('export-table').first()).toBeVisible();
  await guest.keyboard.press('Control+Enter');
  await expect(host.locator('[data-testid="shot-row"]')).toHaveCount(53);

  // Fermeture du partage, copie permise : l'invité revient à l'accueil, où figure sa copie.
  await host.getByTestId('share-panel').getByText('Ils gardent une copie du projet').click();
  await host.getByTestId('share-stop').click();
  await expect(guest.getByTestId('home')).toBeVisible();
  await expect(guest.getByTestId('guest-banner')).toHaveCount(0);
  await expect(guest.getByTestId('project-list').locator('li')).toHaveCount(1);
});

test('invité en lecture seule : aucune commande d’édition, découpage en aperçu', async ({ browser }) => {
  const host = await participant(browser);
  await host.goto('/#/grid?seed=rav3');
  await host.getByTestId('share-button').click();
  await host.getByText('Lire seulement').click();
  await host.getByTestId('share-start').click();
  const link = await host.getByTestId('share-link').textContent();
  const password = await host.getByTestId('share-password').textContent();
  const guest = await participant(browser);
  await guest.goto(link!);
  await guest.getByLabel('Votre nom').fill('Léo');
  await guest.getByLabel('Mot de passe').fill(password!);
  await guest.getByTestId('join-go').click();
  await expect(guest.getByTestId('guest-banner')).toContainText('lecture seule');
  // Découpage : l'aperçu, ni grille éditable ni outils.
  await expect(guest.getByTestId('export-table').first()).toBeVisible();
  await expect(guest.getByTestId('shot-row')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Colonnes' })).toBeHidden();
  await expect(guest.getByRole('button', { name: /^Annuler/ })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Réglages' })).toHaveCount(0);
  // Sans droit de copie : pas d'export.
  await expect(guest.getByRole('navigation').getByText('Exporter', { exact: true })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Exporter' })).toBeHidden();
  // Storyboard et plan au sol : on regarde, on ne modifie pas.
  await guest.evaluate(() => void (window.location.hash = '#/storyboard'));
  await expect(guest.getByTestId('storyboard-card').first()).toBeVisible();
  await expect(guest.getByTestId('storyboard-add-keyframe').first()).toBeHidden();
  await guest.evaluate(() => void (window.location.hash = '#/floorplan'));
  await expect(guest.getByRole('toolbar', { name: 'Outils du plan au sol' })).toBeHidden();
  await expect(guest.getByTestId('fp-fit')).toBeVisible();
  // Fermeture sans copie permise : retour à l'accueil, rien de conservé.
  await host.getByTestId('share-stop').click();
  await expect(guest.getByTestId('home')).toBeVisible();
  await expect(guest.getByTestId('project-list').locator('li')).toHaveCount(0);
});
