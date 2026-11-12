import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ROWS = '[data-testid="shot-row"]';
const SCRIPT = `INT. ENTREPRISE / ACCUEIL - JOUR

Flora entre et pose son badge sur le comptoir.

MARC
Vous êtes en avance.

FLORA
Comme toujours.

EXT. RUE - NUIT

Une voiture passe, phares éteints.

INT. COULOIR - JOUR
`;

/** Projet de démonstration (11 plans), scénario remplacé puis ses séquences importées, vides. */
async function importEmpty(page: Page, script: string | Buffer = SCRIPT, expected = 3) {
  await page.goto('/#/scenario?seed=fiction');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('version-import').click();
  await (await chooser).setFiles({ name: 'court.fountain', mimeType: 'text/plain', buffer: Buffer.isBuffer(script) ? script : Buffer.from(script) });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remplacer' }).click();
  await page.getByRole('tablist', { name: 'Scénario' }).getByRole('tab', { name: 'Découpage' }).click();
  await page.getByTestId('import-scenes').click();
  await page.goto('/#/grid');
  await expect(page.getByTestId('empty-sequence')).toHaveCount(expected);
  await expect(page.locator(ROWS)).toHaveCount(11);
}

/** Modèle KIT : 22 séquences importées, vides, au-dessus des trois séquences découpées (23 à 25). */
const KIT = readFileSync(new URL('../src/domain/__fixtures__/kit/modele-complet.fountain', import.meta.url));
const importKit = (page: Page) => importEmpty(page, KIT, 22);

type Shots = Record<string, { subject: string; value: string; sequenceId: string }>;
const shotsOf = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __ds: { doc: () => { shots: Shots } } }).__ds.doc();
    return JSON.stringify(Object.values(d.shots).map((x) => [x.subject, x.value, x.sequenceId]));
  });

test('séquence sans plan : en-tête, aperçu du texte, premier plan à la souris ou au clavier, plans depuis le texte', async ({ page }) => {
  await importEmpty(page);
  const [accueil, rue, couloir] = [0, 1, 2].map((i) => page.getByTestId('empty-sequence').nth(i));
  // Même en-tête que les séquences pleines ; aperçu de l'action ; aucun bouton en vitrine.
  await expect(accueil.locator('td').first()).toContainText('1, ENTREPRISE / ACCUEIL');
  await expect(accueil.getByTestId('seq-intext')).toHaveValue('INT');
  await expect(accueil).toContainText('Flora entre et pose son badge sur le comptoir.');
  await expect(rue).toContainText('Une voiture passe, phares éteints.');
  await page.mouse.move(5, 895);
  await expect(accueil.getByTestId('shots-from-text')).toHaveCSS('opacity', '0');
  await expect(page.getByText('séquence vide')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Supprimer la séquence', exact: true })).toHaveCount(0);
  // Sans texte : ni aperçu ni « depuis le texte ».
  await expect(couloir.getByTestId('shots-from-text')).toHaveCount(0);

  // Les plans d'un coup depuis le texte : un par paragraphe d'action et par réplique.
  await accueil.hover();
  await expect(accueil.getByTestId('shots-from-text')).toHaveCSS('opacity', '1');
  await expect(accueil.getByTestId('shots-from-text')).toHaveText('3 plans depuis le texte');
  await accueil.getByTestId('shots-from-text').click();
  await expect(page.locator(ROWS)).toHaveCount(14);
  await expect(page.getByTestId('empty-sequence')).toHaveCount(2);
  const first = page.locator('tbody[data-seq]').first();
  await expect(first.locator(ROWS)).toHaveCount(3);
  await expect(first.locator(ROWS).nth(1)).toContainText('Marc');
  await expect(page.getByTestId('grid')).toBeFocused();
  // Annulable d'un coup.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('empty-sequence')).toHaveCount(3);
  await expect(page.locator(ROWS)).toHaveCount(11);

  // Au clavier : le « + » de la séquence se rejoint par Tab, Entrée crée le premier plan et la saisie suit.
  await page.getByTestId('empty-sequence').nth(1).getByTestId('seq-effect').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('empty-sequence').nth(1).getByTestId('add-first-shot')).toBeFocused();
  await expect(page.getByTestId('empty-sequence').nth(1).getByTestId('add-first-shot')).toHaveAccessibleName('Ajouter un plan à la séquence 2');
  await page.keyboard.press('Enter');
  await expect(page.locator(ROWS)).toHaveCount(12);
  await expect(page.getByTestId('grid')).toBeFocused();
  await page.keyboard.type('Voiture');
  await page.keyboard.press('Enter');
  await expect(page.locator('tbody[data-seq]').nth(1).locator(ROWS)).toContainText('Voiture');

  // À la souris : un clic sur la ligne fantôme.
  await page.getByTestId('empty-sequence').last().getByTestId('add-first-shot').click();
  await expect(page.locator(ROWS)).toHaveCount(13);
  await expect(page.getByTestId('empty-sequence')).toHaveCount(1);

  // La suppression reste là, au survol de l'en-tête, comme pour les séquences pleines (annulable).
  const left = page.getByTestId('empty-sequence').first();
  await expect(left.getByTestId('delete-sequence')).toHaveCSS('opacity', '0');
  await left.hover();
  await left.getByTestId('delete-sequence').click();
  await expect(page.getByTestId('empty-sequence')).toHaveCount(0);
  await expect(page.locator('tbody[data-seq]')).toHaveCount(5);
  expect(await page.evaluate(() => (window as unknown as { __ds: { invariants: () => string[] } }).__ds.invariants())).toEqual([]);
});

test('séquence sans plan : absente de l’aperçu et de l’export, numéros des autres inchangés ; rien de coupé au-dessus du pied', async ({ page }) => {
  await importEmpty(page);
  // Arrivée sur la page : la grille commence en haut (la sélection posée d'office ne la fait pas défiler).
  await expect(page.getByTestId('empty-sequence').first()).toBeInViewport();
  // La grille tient dans la fenêtre : défilée jusqu'en bas, son dernier plan est entier au-dessus du pied.
  const grid = page.getByTestId('grid');
  const footer = page.getByTestId('grid-footer');
  await grid.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const [g, f, last] = await Promise.all([grid.boundingBox(), footer.boundingBox(), page.locator(ROWS).last().boundingBox()]);
  expect(f!.y + f!.height).toBeLessThanOrEqual(900);
  expect(g!.y + g!.height).toBeLessThanOrEqual(f!.y + 1);
  expect(last!.y + last!.height).toBeLessThanOrEqual(f!.y + 1);

  await page.getByTestId('toggle-print').click();
  const table = page.getByTestId('export-table');
  await expect(table).toContainText('4, GARE — HALL');
  await expect(table).not.toContainText('ACCUEIL');
  await expect(table).not.toContainText('COULOIR');
});

test('séquence sans plan au clavier : le « + » garde ses touches (Tab en sort, Suppr retire la séquence vide), aucun plan caché n’est touché', async ({ page }) => {
  await importEmpty(page);
  const empty = page.getByTestId('empty-sequence');
  const add = empty.first().getByTestId('add-first-shot');
  const before = await shotsOf(page);
  await add.focus();
  // Une lettre n'ouvre la saisie d'aucun plan, la grille ne défile pas.
  await page.keyboard.press('x');
  await expect(page.getByTestId('grid').locator('input, textarea')).toHaveCount(0);
  await expect(add).toBeFocused();
  expect(await page.getByTestId('grid').evaluate((el) => el.scrollTop)).toBe(0);
  // Tab mène au bouton « depuis le texte », Maj+Tab revient.
  await page.keyboard.press('Tab');
  await expect(empty.first().getByTestId('shots-from-text')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(add).toBeFocused();
  // Suppr : la séquence vide s'en va (annulable), aucun plan ne change ; le focus passe au « + » suivant.
  await page.keyboard.press('Delete');
  await expect(empty).toHaveCount(2);
  await expect(page.locator(ROWS)).toHaveCount(11);
  expect(await shotsOf(page)).toBe(before);
  await expect(empty.first().getByTestId('add-first-shot')).toBeFocused();
  await expect(empty.first()).toContainText('1, RUE');
  await page.keyboard.press('Control+z');
  await expect(empty).toHaveCount(3);
  await expect(empty.first()).toContainText('1, ENTREPRISE / ACCUEIL');
});

test('vérifications : chaque lien mène à sa séquence ou à sa cellule ; les séquences sans plan groupées', async ({ page }) => {
  await importKit(page);
  // Deux contrôles de plus : valeur effacée (23.1), zoom sans focale de départ (24.4).
  await page.locator('[data-cell="0:value"]').click();
  await page.keyboard.press('Delete');
  await page.locator('[data-cell="7:focal"]').click();
  await page.keyboard.press('Delete');
  await page.goto('/#/checks');
  const group = page.getByTestId('check-group-empty-sequence');
  await expect(group.getByTestId('issue')).toHaveCount(22);
  // Badge du menu : autant que de lignes sur la page.
  const issues = await page.getByTestId('issue').count();
  await expect(page.getByRole('link', { name: /Vérifications/ }).or(page.getByRole('button', { name: /Vérifications/ })).first()).toContainText(String(issues));

  // Séquence sans plan : la grille l'amène dans la vue, sous l'en-tête, et son « + » a le focus.
  await group.getByTestId('check-go').filter({ has: page.locator('span', { hasText: /^20$/ }) }).click();
  await expect(page).toHaveURL(/#\/grid/);
  const seq20 = page.getByTestId('empty-sequence').nth(19);
  await expect(seq20.getByTestId('add-first-shot')).toBeFocused();
  await expect(seq20).toBeInViewport();
  const [grid, head, row] = await Promise.all([page.getByTestId('grid').boundingBox(), page.getByTestId('grid').locator('thead').boundingBox(), seq20.boundingBox()]);
  expect(row!.y).toBeGreaterThanOrEqual(grid!.y + head!.height - 1);
  await page.keyboard.press('Enter');
  await expect(page.locator(ROWS)).toHaveCount(12);
  await expect(page.getByTestId('empty-sequence')).toHaveCount(21);

  // Plan sans valeur de cadre : la cellule VALEUR du plan ; zoom sans focales : la cellule FOCALE.
  for (const [label, code, col] of [
    ['missing-value', '23.1', 'value'],
    ['zoom-focal', '24.4', 'focal'],
  ] as const) {
    await page.goto('/#/checks');
    await page.getByTestId(`check-group-${label}`).getByTestId('check-go').filter({ hasText: code }).click();
    const cell = page.locator(`[aria-selected="true"][data-cell$=":${col}"]`);
    await expect(cell).toHaveCount(1);
    await expect(cell).toBeInViewport();
    await expect(page.locator('tr[data-shot]').filter({ has: cell }).locator('[data-cell$=":number"]')).toHaveText(code.slice(-1));
  }
});

test('retour sur le découpage : la grille reste en haut, l’inspecteur n’affiche aucun plan tant qu’on n’en a choisi aucun', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importKit(page);
  const grid = page.getByTestId('grid');
  for (let k = 0; k < 2; k++) {
    await expect(page.getByTestId('empty-sequence').first()).toBeInViewport();
    expect(await grid.evaluate((el) => el.scrollTop)).toBe(0);
    await page.getByRole('button', { name: 'Inspecteur', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Inspecteur du plan' })).toContainText('Sélectionnez un plan');
    await page.getByRole('button', { name: 'Inspecteur', exact: true }).click();
    await page.goto('/#/registry');
    await page.goto('/#/grid');
  }
  // Un choix au clavier : la sélection devient la sienne, la grille va la montrer.
  await grid.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[aria-selected="true"][data-cell$=":value"]')).toBeInViewport();
});

test('séquence sans plan : ligne compacte, « depuis le texte » visible même grille étroite (1280 px, panneau ouvert)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await importEmpty(page);
  const empty = page.getByTestId('empty-sequence');
  // Lignes compactes ; entre deux séquences vides, un simple filet.
  for (let k = 0; k < 3; k++) expect((await empty.nth(k).boundingBox())!.height).toBeLessThanOrEqual(66);
  const [a, b] = await Promise.all([empty.nth(0).boundingBox(), empty.nth(1).boundingBox()]);
  expect(b!.y - (a!.y + a!.height)).toBeLessThanOrEqual(12);
  const grid = page.getByTestId('grid');
  for (const panel of [null, 'Scénario', 'Inspecteur']) {
    if (panel) await page.getByRole('toolbar').getByRole('button', { name: panel, exact: true }).click();
    await empty.first().hover();
    const [g, btn] = await Promise.all([grid.boundingBox(), empty.first().getByTestId('shots-from-text').boundingBox()]);
    expect(btn!.x).toBeGreaterThan(g!.x);
    expect(btn!.x + btn!.width).toBeLessThanOrEqual(g!.x + g!.width);
    await expect(empty.first().getByTestId('shots-from-text')).toHaveCSS('opacity', '1');
    if (panel) await page.getByRole('toolbar').getByRole('button', { name: panel, exact: true }).click();
  }
});

test('téléphone : une pastille de séquence sans plan ouvre la vue d’ensemble sur cette séquence', async ({ page }) => {
  await importEmpty(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('mobile-cut')).toBeVisible();
  // Le menu, resté ouvert depuis l'ordinateur, devient un tiroir : on le referme.
  await page.getByRole('button', { name: 'Afficher ou réduire le menu' }).click();
  await page.getByTestId('mobile-seq-tab').filter({ hasText: 'COULOIR' }).click();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: /COULOIR/ }) });
  await expect(section).toBeInViewport();
  await section.getByTestId('mobile-add-first-shot').click();
  await expect(page.getByTestId('mobile-cut')).toContainText('Plan 3.1');
});

test('découpage sans aucun plan : l’export Excel reste possible (séquences dans l’onglet Registre)', async ({ page }) => {
  await importEmpty(page);
  // Les trois séquences découpées s'en vont : 3 séquences, 0 plan.
  for (let k = 0; k < 3; k++) {
    const seq = page.locator('tbody[data-seq]').filter({ has: page.locator(ROWS) }).first();
    await seq.hover();
    await seq.getByTestId('delete-sequence').click();
  }
  await expect(page.locator(ROWS)).toHaveCount(0);
  await page.getByTestId('grid-export').click();
  const panel = page.getByTestId('grid-export-panel');
  await expect(panel.getByText('PDF', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Images A4')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await panel.getByTestId('grid-export-go').click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
});
