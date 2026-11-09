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
  await expect(guest.getByRole('button', { name: 'Paramètres' })).toHaveCount(0);
  await expect(guest.getByTestId('project-menu')).toHaveCount(0);
  await expect(guest.getByTestId('assistant-toggle')).toHaveCount(0);
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

test('QR code du partage en plein écran : lien et mot de passe en grand, Échap referme', async ({ browser }) => {
  const host = await participant(browser);
  await host.goto('/#/grid?seed=rav3');
  await host.getByTestId('share-button').click();
  await host.getByTestId('share-start').click();
  const password = await host.getByTestId('share-password').textContent();
  await host.getByTestId('share-qr').click();
  const screen = host.getByTestId('share-qr-screen');
  await expect(screen).toBeVisible();
  await expect(host.getByTestId('share-qr-password')).toHaveText(password!);
  await expect(screen.locator('svg[role="img"] path')).toHaveAttribute('d', /^M4 4h/);
  await host.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await host.getByTestId('share-stop').click();
});

test('relecture : l’invité commente le découpage et le scénario ; l’auteur lit, répond et retire depuis le menu des versions', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await participant(browser);
  await host.goto('/#/grid?seed=fiction');
  await host.getByTestId('share-button').click();
  await host.getByTestId('share-panel').getByText('Commenter').click();
  await host.getByTestId('share-start').click();
  const link = await host.getByTestId('share-link').textContent();
  const password = await host.getByTestId('share-password').textContent();
  await host.getByTestId('share-button').click();
  await expect(host.getByTestId('share-panel')).toHaveCount(0);

  const guest = await participant(browser);
  await guest.goto(link!);
  await guest.getByLabel('Votre nom').fill('Nina');
  await guest.getByLabel('Mot de passe').fill(password!);
  await guest.getByTestId('join-go').click();
  await expect(guest.getByTestId('guest-banner')).toContainText('relecture');
  // Le découpage en aperçu ; un clic sur une cellule ouvre la bulle.
  await guest.locator('tr[data-shot] td[data-col="value"]').first().click();
  await guest.getByTestId('comment-text').fill('Plutôt un plan large ici ?');
  await guest.getByTestId('comment-send').click();
  await expect(guest.getByTestId('comment-popover').getByTestId('comment')).toContainText('Plutôt un plan large');
  await guest.keyboard.press('Escape');
  await expect(guest.locator('td[data-commented]')).toHaveCount(1);
  // Scénario : un mot sélectionné, commenté.
  await guest.getByRole('button', { name: /^Scénario$/ }).first().click();
  await guest.evaluate(() => {
    // Sélection du mot « valise » dans le texte (comme à la souris).
    const ed = document.querySelector('[data-testid="script-editor"]')!;
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf('valise');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 'valise'.length);
      const sl = window.getSelection()!;
      sl.removeAllRanges();
      sl.addRange(r);
      return;
    }
  });
  await guest.getByTestId('comment-selection').click();
  await guest.getByTestId('comment-text').fill('Quelle valise ? On la voit avant ?');
  await guest.getByTestId('comment-send').click();
  await expect(guest.getByTestId('comment-popover')).toContainText('Quelle valise');

  // L'auteur : le menu des versions compte les commentaires ; la fenêtre les liste.
  await host.getByTestId('version-switcher').click();
  await expect(host.getByTestId('version-comments')).toContainText('2');
  await host.getByTestId('version-comments').click();
  const panel = host.getByTestId('comments-panel');
  await expect(panel.getByTestId('comment')).toHaveCount(2);
  await expect(panel).toContainText('Nina');
  await panel.getByTestId('comment').filter({ hasText: 'plan large' }).getByTestId('comment-reply').fill('Oui, on change.');
  await host.keyboard.press('Enter');
  // La réponse arrive chez l'invité (bulle du découpage).
  await guest.getByRole('button', { name: /Découpage technique/ }).click();
  await guest.locator('td[data-commented]').first().click();
  await expect(guest.getByTestId('comment-popover')).toContainText('Oui, on change.');
  await guest.keyboard.press('Escape');
  // L'auteur retire le commentaire : la marque disparaît chez l'invité.
  await panel.getByTestId('comment').filter({ hasText: 'plan large' }).getByTestId('comment-delete').click();
  await expect(panel.getByTestId('comment')).toHaveCount(1);
  await expect(guest.locator('td[data-commented]')).toHaveCount(0);
  // « Voir » mène au passage du scénario, bulle ouverte.
  await panel.getByRole('button', { name: /Scénario · « valise/ }).click();
  await expect(host.getByTestId('comment-popover')).toContainText('Quelle valise');
});
