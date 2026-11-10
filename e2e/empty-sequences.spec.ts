import { expect, test, type Page } from '@playwright/test';

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

/** Projet de démonstration (11 plans), scénario remplacé puis ses trois séquences importées, vides. */
async function importEmpty(page: Page) {
  await page.goto('/#/scenario?seed=fiction');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Importer/ }).click();
  await (await chooser).setFiles({ name: 'court.fountain', mimeType: 'text/plain', buffer: Buffer.from(SCRIPT) });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remplacer' }).click();
  await page.getByRole('radiogroup', { name: 'Affichage du scénario' }).getByRole('radio', { name: 'Découpage' }).click();
  await page.getByTestId('scenario-tab-shots').click();
  await page.getByTestId('import-scenes').click();
  await page.goto('/#/grid');
  await expect(page.getByTestId('empty-sequence')).toHaveCount(3);
  await expect(page.locator(ROWS)).toHaveCount(11);
}

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
