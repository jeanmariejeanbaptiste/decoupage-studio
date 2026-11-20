import { expect, test, type Locator, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

type Doc = {
  project: { sequenceIds: string[] };
  sequences: Record<string, { label: string; shotIds: string[] }>;
  shots: Record<string, { subject: string; value: string; angle: string[]; movement: string[]; focal: { from?: number; to?: number }; sound?: string; actionBlockId: string }>;
  blocks: Record<string, { text: string; scenarioAnchor?: { start: number; end: number } }>;
};
const docOf = (page: Page): Promise<Doc> => page.evaluate(() => (window as unknown as { __ds: { doc: () => Doc } }).__ds.doc());

const plan = (page: Page) => page.getByTestId('mobile-cut');
const code = (page: Page) => page.getByTestId('mobile-code');
const field = (page: Page, col: string) => plan(page).locator(`[data-field="${col}"]`);
const done = (page: Page) => page.getByTestId('sheet-done').click();
const undo = (page: Page) => page.getByRole('button', { name: /^Annuler \(/ }).click();

/** Appui long sur la poignée puis glissement du doigt jusqu'à `toY` (événements tactiles réels). */
async function longPressDrag(page: Page, grip: Locator, toY: number, hold = 340) {
  const box = (await grip.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(hold);
  for (let k = 1; k <= 12; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + ((toY - y) * k) / 12 }] });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Y de la frontière entre une rangée et la suivante (la rangée soulevée y tombera). */
const below = async (row: Locator) => {
  const b = (await row.boundingBox())!;
  return b.y + b.height - 2;
};
const row = (page: Page, shot: string) => page.locator(`[data-drop-shot="${shot}"]`);

test('téléphone : un plan à la fois, valeur en titre, flèches et balayage, vue d’ensemble', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(code(page)).toHaveText('1.1');
  await expect(page.getByTestId('shot-row')).toHaveCount(0);
  await expect(page.locator('[data-mobile-title]')).toHaveText('Général');
  await expect(plan(page).locator('[data-field="subject"]')).toHaveText('Hall de gare');
  await page.getByTestId('mobile-next').click();
  await expect(code(page)).toHaveText('1.2');
  await expect(page.getByTestId('mobile-prev')).toContainText('1.1');
  await expect(page.getByTestId('mobile-next')).toContainText('1.3');
  // Balayage vers la gauche : plan suivant.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: 600 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 605 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 608 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(code(page)).toHaveText('1.3');
  // Nouveau plan : vide, juste après.
  await page.getByTestId('mobile-add-shot').click();
  await expect(code(page)).toHaveText('1.4');
  await expect(page.locator('[data-mobile-title]')).toHaveText('Valeur');
  // Vue d'ensemble : un plan par ligne ; le toucher l'ouvre.
  await page.getByTestId('mobile-overview').click();
  await expect(page.getByTestId('mobile-list-shot')).toHaveCount(12);
  await expect(page.getByTestId('mobile-overview-list')).toContainText('3 séquences · 12 plans');
  await page.getByTestId('mobile-list-shot').filter({ hasText: 'Insert' }).click();
  await expect(code(page)).toHaveText('1.5');
  // « … » : dupliquer, supprimer (le voisin s'ouvre), une annulation chacun.
  await page.getByTestId('mobile-more').click();
  await page.getByRole('menuitem', { name: 'Dupliquer le plan' }).click();
  await expect(code(page)).toHaveText('1.6');
  await expect(page.locator('[data-mobile-title]')).toHaveText('Insert');
  await page.getByTestId('mobile-more').click();
  await page.getByRole('menuitem', { name: 'Supprimer le plan' }).click();
  await expect(code(page)).toHaveText('2.1');
  await undo(page);
  expect(Object.keys((await docOf(page)).shots)).toHaveLength(13);
});

test('téléphone : la valeur, l’angle et la focale dans la feuille Valeur, une seule annulation', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('mobile-next').click();
  await page.getByTestId('mobile-next').click();
  await expect(page.locator('[data-mobile-title]')).toHaveText('Rapproché');
  await page.locator('[data-mobile-title]').click();
  const sheet = page.getByTestId('sheet-value');
  await expect(sheet.getByRole('option', { name: 'Rapproché' })).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('option', { name: 'Gros plan', exact: true }).click();
  await sheet.getByRole('group', { name: 'angle' }).getByRole('button', { name: 'Profil', exact: true }).click();
  await sheet.getByRole('group', { name: 'hauteur' }).getByRole('button', { name: 'Plongée', exact: true }).click();
  await sheet.getByRole('group', { name: 'focale' }).getByRole('button', { name: '85' }).click();
  await done(page);
  await expect(page.locator('[data-mobile-title]')).toHaveText('Gros plan');
  await expect(field(page, 'angle')).toHaveText('Profil');
  await expect(field(page, 'focal')).toHaveText(/85\s*mm/);
  const shotId = (await docOf(page)).sequences[(await docOf(page)).project.sequenceIds[0]].shotIds[2];
  let shot = (await docOf(page)).shots[shotId];
  expect([shot.value, shot.angle, shot.focal]).toEqual(['Gros plan', ['Profil', 'Plongée'], { from: 85 }]);
  // Le voile referme et valide aussi ; une seule annulation défait toute la feuille.
  await undo(page);
  shot = (await docOf(page)).shots[shotId];
  expect([shot.value, shot.angle, shot.focal]).toEqual(['Rapproché', ['3/4 Face', 'Hauteur regard'], { from: 50 }]);
  await expect(page.locator('[data-mobile-title]')).toHaveText('Rapproché');
});

test('téléphone : mouvements à pictogrammes dans l’ordre, échelle des focales dès qu’un zoom est choisi', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('mobile-next').click();
  await page.getByTestId('mobile-next').click();
  await field(page, 'movement').click();
  const sheet = page.getByTestId('sheet-movement');
  await expect(sheet.getByRole('button', { name: 'Trav. arrière' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('zoom-range')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Zoom avant' }).click();
  // Numérotés dans l'ordre, la suite écrite en toutes lettres.
  await expect(sheet.getByRole('button', { name: /Trav\. arrière/ })).toContainText('1');
  await expect(sheet.getByRole('button', { name: /Zoom avant/ })).toContainText('2');
  await expect(page.getByTestId('movement-chain')).toHaveText(/Travelling arrière\s*puis zoom avant/);
  // La focale du plan (50) est le départ ; on touche l'arrivée.
  await page.getByTestId('zoom-range').getByRole('button', { name: '85' }).click();
  await done(page);
  await expect(field(page, 'movement')).toContainText('Travelling arrière, puis zoom avant');
  await expect(field(page, 'focal')).toHaveText(/50\s*→\s*85\s*mm/);
  const d = await docOf(page);
  const id = d.sequences[d.project.sequenceIds[0]].shotIds[2];
  const shot = d.shots[id];
  expect(shot.movement).toEqual(['Trav arrière', 'Zoom avant']);
  expect(shot.focal).toEqual({ from: 50, to: 85 });
  // Un sens pour le panoramique ; « Fixe » remplace le reste.
  await field(page, 'movement').click();
  await sheet.getByRole('button', { name: 'Panoramique' }).click();
  await sheet.getByRole('group', { name: 'panoramique' }).getByRole('button', { name: 'Droite' }).click();
  await expect(page.getByTestId('movement-chain')).toContainText('panoramique droite');
  await sheet.getByRole('button', { name: 'Fixe' }).click();
  await expect(page.getByTestId('movement-chain')).toHaveText('Plan fixe');
  await done(page);
  expect((await docOf(page)).shots[id].movement).toEqual(['Fixe']);
});

test('téléphone : action prise du scénario (phrase insérée au curseur, surlignée, liée) ; son écrit librement', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  // Colonne Son affichée depuis les outils, au bas de la vue d'ensemble.
  await page.getByTestId('mobile-overview').click();
  await page.getByRole('button', { name: 'Colonnes' }).click();
  await page.getByRole('menu').getByText('Son', { exact: true }).click();
  await page.getByRole('button', { name: 'Colonnes' }).click();
  await page.getByTestId('mobile-overview-close').click();
  // Plan neuf à la fin de la séquence 1.
  await page.getByTestId('mobile-next').click();
  await page.getByTestId('mobile-next').click();
  await page.getByTestId('mobile-next').click();
  await page.getByTestId('mobile-add-shot').click();
  await expect(code(page)).toHaveText('1.5');
  await field(page, 'action').click();
  const sheet = page.getByTestId('sheet-action');
  await expect(sheet.getByRole('tab', { name: 'Depuis le scénario' })).toHaveAttribute('aria-selected', 'true');
  const first = sheet.getByTestId('script-sentence').filter({ hasText: 'Le hall bruisse' });
  await first.click();
  await expect(sheet.getByRole('textbox', { name: 'Action' })).toHaveValue('Le hall bruisse, les annonces se succèdent.');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('mark')).toHaveText('Le hall bruisse, les annonces se succèdent.');
  // Au clavier, on complète ; la phrase reste surlignée.
  await sheet.getByRole('tab', { name: 'Clavier' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Action' })).toBeFocused();
  await page.keyboard.type(' Léa entre.');
  await done(page);
  await expect(field(page, 'action')).toContainText('Le hall bruisse, les annonces se succèdent. Léa entre.');
  let d = await docOf(page);
  const id = d.sequences[d.project.sequenceIds[0]].shotIds[4];
  expect(d.blocks[d.shots[id].actionBlockId].scenarioAnchor).toBeTruthy();
  // Une annulation défait le texte et le lien d'un coup.
  await undo(page);
  d = await docOf(page);
  expect(d.blocks[d.shots[id].actionBlockId].text).toBe('');
  expect(d.blocks[d.shots[id].actionBlockId].scenarioAnchor).toBeUndefined();

  // Son : un champ de texte libre, sur plusieurs lignes.
  await field(page, 'sound').click();
  const son = page.getByTestId('sheet-sound');
  await expect(son.getByRole('button')).toHaveCount(1);
  await son.getByRole('textbox').fill('Son direct\nAmbiance du hall, roue qui grince');
  await done(page);
  await expect(field(page, 'sound')).toContainText('Ambiance du hall, roue qui grince');
  d = await docOf(page);
  expect(d.shots[id].sound).toBe('Son direct\nAmbiance du hall, roue qui grince');
});

test('téléphone : insérer un plan entre deux plans, une séquence entre deux séquences', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('mobile-overview').click();
  let d = await docOf(page);
  const [s1, s2] = d.project.sequenceIds;
  // L'espace entre 1.1 et 1.2 s'ouvre sur « + Plan 1.2 ».
  await page.locator(`[data-gap="${s1}:1:"]`).click();
  await expect(page.getByTestId('mobile-insert-shot')).toHaveText(/Plan\s*1\.2/);
  await expect(page.getByTestId('mobile-insert-seq')).toHaveCount(0);
  await page.getByTestId('mobile-insert-shot').click();
  await expect(code(page)).toHaveText('1.2');
  await expect(page.getByTestId('mobile-next')).toContainText('1.3');
  d = await docOf(page);
  expect(d.sequences[s1].shotIds).toHaveLength(5);
  expect(d.shots[d.sequences[s1].shotIds[1]].subject).toBe('');
  // Au bout de la séquence 1 : « + Plan 1.6 » et « + Séquence ».
  await page.getByTestId('mobile-overview').click();
  await page.locator(`[data-gap="${s1}:5:e"]`).click();
  await expect(page.getByTestId('mobile-insert-shot')).toHaveText(/Plan\s*1\.6/);
  await page.getByTestId('mobile-insert-seq').click();
  await expect(code(page)).toHaveText('2.1');
  d = await docOf(page);
  expect(d.project.sequenceIds).toHaveLength(4);
  expect(d.project.sequenceIds[2]).toBe(s2);
  // Le nom de la nouvelle séquence, depuis l'en-tête.
  await page.getByTestId('mobile-seq').click();
  await page.getByTestId('sheet-sequence').getByRole('textbox', { name: 'Nom de la séquence' }).fill('Gare — Couloir');
  await done(page);
  await expect(page.getByTestId('mobile-seq')).toContainText('Gare — Couloir');
  await page.getByTestId('mobile-overview').click();
  await expect(page.locator('h2').nth(1)).toContainText('2·Gare — Couloir');
  await expect(page.locator('h2').nth(2)).toContainText('3·GARE — CONSIGNE');
});

test('téléphone : réorganiser à l’appui long sur la poignée, dans la séquence et vers une autre', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('mobile-overview').click();
  let d = await docOf(page);
  const [s1, s2] = d.project.sequenceIds;
  const [a, b] = d.sequences[s2].shotIds;
  // 2.1 sous 2.2, dans sa séquence.
  await longPressDrag(page, row(page, a).getByTestId('mobile-grip'), (await below(row(page, b))) + 6);
  await expect.poll(async () => (await docOf(page)).sequences[s2].shotIds.slice(0, 2)).toEqual([b, a]);
  // Un simple glissement sur la poignée (sans appui long) ne soulève rien.
  await longPressDrag(page, row(page, d.sequences[s1].shotIds[0]).getByTestId('mobile-grip'), 400, 0);
  await page.waitForTimeout(200);
  expect((await docOf(page)).sequences[s1].shotIds).toEqual(d.sequences[s1].shotIds);
  const valise = d.sequences[s1].shotIds[3];
  // 1.4 (Valise) vers la séquence 2, entre 2.2 et 2.3 : confirmation, puis rangé.
  await longPressDrag(page, row(page, valise).getByTestId('mobile-grip'), await below(row(page, a)));
  await page.getByRole('button', { name: 'Déplacer', exact: true }).click();
  await expect.poll(async () => (await docOf(page)).sequences[s2].shotIds.indexOf(valise)).toBe(2);
  d = await docOf(page);
  expect(d.sequences[s1].shotIds).toHaveLength(3);
  await expect(row(page, valise)).toContainText('2.3');
  expect(await page.evaluate(() => (window as unknown as { __ds: { invariants: () => string[] } }).__ds.invariants())).toEqual([]);
  // Une annulation la remet à sa place.
  await undo(page);
  await expect.poll(async () => (await docOf(page)).sequences[s1].shotIds[3]).toBe(valise);
});

test('téléphone : invité en lecture seule, le découpage se lit sans rien pouvoir modifier', async ({ browser }) => {
  const PORT = 9131;
  const server = PeerServer({ port: PORT, path: '/', host: '127.0.0.1' });
  try {
    const open = async (phone: boolean) => {
      const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true } : {});
      await ctx.addInitScript((port) => localStorage.setItem('ds-peer-server', `localhost:${port}`), PORT);
      return ctx.newPage();
    };
    const host = await open(false);
    await host.goto('/#/grid?seed=fiction');
    await host.getByTestId('share-button').click();
    await host.getByText('Lire seulement').click();
    await host.getByTestId('share-start').click();
    const link = await host.getByTestId('share-link').textContent();
    const password = await host.getByTestId('share-password').textContent();
    const guest = await open(true);
    await guest.goto(link!);
    await guest.getByLabel('Votre nom').fill('Léo');
    await guest.getByLabel('Mot de passe').fill(password!);
    await guest.getByTestId('join-go').click();
    await expect(guest.getByTestId('guest-banner')).toContainText('lecture seule');
    await guest.evaluate(() => void (window.location.hash = '#/grid'));
    await expect(plan(guest)).toBeVisible();
    await expect(guest.locator('[data-mobile-title]')).toHaveText('Général');
    await expect(guest.locator('[data-mobile-title]')).toBeDisabled();
    await expect(field(guest, 'movement')).toBeDisabled();
    await expect(guest.getByTestId('mobile-add-shot')).toHaveCount(0);
    await expect(guest.getByTestId('mobile-more')).toHaveCount(0);
    await guest.getByTestId('mobile-next').click();
    await expect(code(guest)).toHaveText('1.2');
    await guest.getByTestId('mobile-overview').click();
    await expect(guest.getByTestId('mobile-list-shot')).toHaveCount(11);
    await expect(guest.getByTestId('mobile-grip')).toHaveCount(0);
    await expect(guest.locator('[data-gap]')).toHaveCount(0);
  } finally {
    (server as unknown as { close?: () => void }).close?.();
  }
});

test('téléphone : un champ absent du projet s’ajoute d’un appui et s’ouvre', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await expect(plan(page)).toBeVisible();
  const add = page.getByTestId('mobile-more-fields').locator('[data-add-field="dialogue"]');
  await add.click();
  const input = page.locator('input[aria-label], textarea').last();
  await input.fill('LÉA : Attends.');
  await done(page);
  await expect(field(page, 'dialogue')).toContainText('Attends.');
  await expect(add).toHaveCount(0);
});
