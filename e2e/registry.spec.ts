import { expect, test, type Page } from '@playwright/test';

/**
 * Le Registre n'existe plus : ce qu'il donnait à voir ou à modifier vit ailleurs. Durée estimée,
 * écart et avancement dans l'en-tête de séquence du découpage ; décor et personnages ajoutés dans
 * le Dépouillement ; tableaux et CSV dans Exporter ; l'ancienne adresse mène au découpage.
 */

type Doc = {
  project: { sequenceIds: string[] };
  sequences: Record<string, { estimatedSec?: number; decorId?: string; characterIds: string[]; shotIds: string[] }>;
  decors: Record<string, { name: string }>;
  characters: Record<string, { name: string }>;
  shots: Record<string, { status: string }>;
};
const docOf = (page: Page) => page.evaluate(() => (window as unknown as { __ds: { doc: () => Doc } }).__ds.doc());

test.describe('ancien registre', () => {
  test('en-tête de séquence : durée estimée modifiée sur place, écart recalculé, saisie refusée sans perte', async ({ page }) => {
    await page.goto('/#/grid?seed=rav3');
    const head = page.locator('tbody[data-seq]').first().getByTestId('seq-timing');
    await expect(head.getByLabel('Durée estimée')).toHaveValue('0:30');
    await expect(head.getByTestId('seq-gap')).toHaveText('écart +0:05 (+17 %)');
    await head.getByLabel('Durée estimée').fill('1:10');
    await page.keyboard.press('Enter');
    await expect(head.getByTestId('seq-gap')).toHaveText('écart −0:35 (−50 %)');
    // Entrée rend le clavier à la grille, sans qu'une frappe parte dans une cellule.
    await expect(page.getByTestId('grid')).toBeFocused();
    const d = await docOf(page);
    expect(d.sequences[d.project.sequenceIds[0]].estimatedSec).toBe(70);
    // Une saisie qui n'est pas une durée ne change rien et ne disparaît pas : marquée invalide, le
    // champ garde le clavier ; Échap rend la valeur d'avant.
    const est = head.getByLabel('Durée estimée');
    await est.fill('bientôt');
    await page.keyboard.press('Enter');
    await expect(est).toBeFocused();
    await expect(est).toHaveValue('bientôt');
    await expect(est).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Tab');
    await expect(est).toHaveValue('bientôt');
    expect((await docOf(page)).sequences[d.project.sequenceIds[0]].estimatedSec).toBe(70);
    await est.focus();
    await page.keyboard.press('Escape');
    await expect(est).toHaveValue('1:10');
    await expect(est).not.toHaveAttribute('aria-invalid');
    // Validée, la durée prend sa forme normale.
    await est.fill('1m30');
    await page.keyboard.press('Enter');
    await expect(est).toHaveValue('1:30');
    await est.fill('70s');
    await page.keyboard.press('Enter');
    await expect(est).toHaveValue('1:10');
    // Vidée : plus d'estimation, plus d'écart.
    await head.getByLabel('Durée estimée').fill('');
    await page.keyboard.press('Enter');
    await expect(head.getByTestId('seq-gap')).toHaveCount(0);
    await expect(head.getByLabel('Durée estimée')).toHaveAttribute('placeholder', 'Durée ?');
    // ⌘Z la fait revenir.
    await page.keyboard.press('Control+z');
    await expect(head.getByLabel('Durée estimée')).toHaveValue('1:10');
  });

  test('en-tête de séquence : l’avancement apparaît dès qu’un plan est tourné', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    const head = page.locator('tbody[data-seq]').first().getByTestId('seq-timing');
    await expect(head.getByTestId('seq-progress')).toHaveCount(0);
    await page.locator('[data-cell="0:subject"]').click();
    await page.getByRole('button', { name: 'Inspecteur', exact: true }).click();
    await page.getByTestId('inspector').getByLabel('Statut').selectOption('tourné');
    await expect(head.getByTestId('seq-progress')).toHaveText('1/4 tourné');
  });

  test('ancienne adresse : le découpage, sans entrée d’historique', async ({ page }) => {
    await page.goto('/#/checks?seed=fiction');
    await page.evaluate(() => (window.location.hash = '#/registry?tab=characters'));
    await expect(page).toHaveURL(/#\/grid$/);
    await expect(page.getByTestId('grid')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/checks/);
  });

  test('ancienne adresse ouverte telle quelle : le projet de démonstration s’ouvre dans le découpage', async ({ page }) => {
    await page.goto('/#/registry?seed=rav3&tab=decors');
    await expect(page).toHaveURL(/#\/grid/);
    await expect(page.locator('tbody[data-seq]').first()).toContainText('CHAMBRE ADMIRATRICE');
  });

  test('plus de Registre dans le menu ni dans la palette de commandes', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await expect(page.getByRole('complementary', { name: 'Étapes du projet' })).not.toContainText('Registre');
    await page.locator('[data-cell="0:subject"]').click();
    await page.keyboard.press('Control+k');
    await page.keyboard.type('registre');
    await expect(page.getByRole('dialog', { name: 'Palette de commandes' }).getByRole('option', { name: /Registre/ })).toHaveCount(0);
  });

  test('dépouillement : le décor de la séquence, choisi ou nouveau, sans doublon', async ({ page }) => {
    await page.goto('/#/breakdown?seed=fiction');
    await page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' }).click();
    const decor = page.getByTestId('breakdown-decor').getByLabel('Décor');
    await expect(decor.locator('option:checked')).toHaveText('GARE — HALL');
    // Un décor existant, dans la liste.
    await decor.selectOption({ label: 'PARVIS DE LA GARE' });
    let d = await docOf(page);
    const hall = d.project.sequenceIds[0];
    expect(d.decors[d.sequences[hall].decorId!].name).toBe('PARVIS DE LA GARE');
    // « Nouveau décor… » : un nom déjà connu (casse, accents, tirets près) rattache sans doublon.
    await decor.selectOption({ label: 'Nouveau décor…' });
    const name = page.getByTestId('breakdown-decor-new');
    await expect(name).toBeFocused();
    await name.fill('gare - hall');
    await name.press('Enter');
    d = await docOf(page);
    expect(d.decors[d.sequences[hall].decorId!].name).toBe('GARE — HALL');
    expect(Object.keys(d.decors)).toHaveLength(3);
    // Échap renonce, rien n'est créé ; un vrai nouveau nom crée un décor, une fois.
    await page.getByTestId('breakdown-decor').getByLabel('Décor').selectOption({ label: 'Nouveau décor…' });
    await name.fill('Quai');
    await name.press('Escape');
    expect(Object.keys((await docOf(page)).decors)).toHaveLength(3);
    await page.getByTestId('breakdown-decor').getByLabel('Décor').selectOption({ label: 'Nouveau décor…' });
    await name.fill('Quai 4');
    await name.press('Tab');
    d = await docOf(page);
    expect(d.decors[d.sequences[hall].decorId!].name).toBe('Quai 4');
    expect(Object.keys(d.decors)).toHaveLength(4);
    // Scénario entier : le même champ pour la séquence lue.
    await page.getByTestId('breakdown-view-full').click();
    await expect(page.getByTestId('breakdown-decor').getByLabel('Décor').locator('option:checked')).toHaveText('Quai 4');
  });

  test('dépouillement : un personnage ajouté à la séquence à la main se retire de là', async ({ page }) => {
    await page.goto('/#/breakdown?seed=fiction');
    await page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' }).click();
    await page.getByLabel('Ajouter (Personnages)').fill('Marc');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('breakdown-personnages')).toContainText('Marc');
    const d = await docOf(page);
    const marc = Object.entries(d.characters).find(([, c]) => c.name === 'Marc')![0];
    expect(d.sequences[d.project.sequenceIds[0]].characterIds).toContain(marc);
    await page.getByRole('button', { name: 'Retirer Marc' }).click();
    await expect(page.getByTestId('breakdown-personnages')).not.toContainText('Marc');
    expect((await docOf(page)).sequences[d.project.sequenceIds[0]].characterIds).not.toContain(marc);
  });

  test('exporter : le document du registre et chaque tableau en CSV', async ({ page }) => {
    await page.goto('/#/export?seed=rav3');
    const card = page.getByTestId('export-registry');
    await expect(card.getByTestId('export-csv-sequences').locator('..')).toContainText('Séquences7');
    await expect(card.getByTestId('export-csv-plans').locator('..')).toContainText('Plans53');
    for (const [key, file, head] of [
      ['sequences', 'rav3-v3-sequences.csv', 'N°'],
      ['personnages', 'rav3-v3-personnages.csv', 'Nom'],
      ['decors', 'rav3-v3-decors.csv', 'Décor'],
      ['plans', 'rav3-v3-plans.csv', 'Plan'],
    ]) {
      const dl = page.waitForEvent('download');
      await card.getByTestId(`export-csv-${key}`).click();
      const got = await dl;
      expect(got.suggestedFilename()).toBe(file);
      const text = (await (await got.createReadStream()).toArray()).join('');
      expect(text).toContain(head);
    }
    await card.getByTestId('tab-export').click();
    await expect(page.getByTestId('tab-export-panel')).toContainText('PDF');
  });
});
