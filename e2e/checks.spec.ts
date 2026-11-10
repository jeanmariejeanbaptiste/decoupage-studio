import { expect, test, type Page } from '@playwright/test';

/** Retour aux vérifications sans recharger (le projet modifié reste ouvert). */
async function toChecks(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/checks'));
  await expect(page.getByTestId('issue').first()).toBeVisible();
}

const group = (page: Page, code: string) => page.getByTestId(`check-group-${code}`);

type Doc = {
  project: { sequenceIds: string[] };
  sequences: Record<string, { shotIds: string[]; estimatedSec?: number; label: string }>;
  shots: Record<string, { subject: string; value: string; angle: string[]; movement: string[]; focal: { from?: number; to?: number } }>;
};
const docOf = (page: Page) => page.evaluate(() => (window as unknown as { __ds: { doc: () => Doc } }).__ds.doc());
/** Plan à la ligne `row` de la grille (ordre du découpage). */
const shotAt = async (page: Page, row: number) => {
  const d = await docOf(page);
  return d.shots[d.project.sequenceIds.flatMap((id) => d.sequences[id].shotIds)[row]];
};

async function editCell(page: Page, cell: string, text: string) {
  await page.locator(`[data-cell="${cell}"]`).click();
  if (text) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.press('Delete');
  }
}

/**
 * RAV3, avec un avertissement de chaque type de plan : 1.1 sans valeur, 1.2 sans sujet, 1.3 en
 * drone et zoom sans focale d'arrivée, 1.4 en angles incompatibles.
 */
async function rav3WithIssues(page: Page) {
  await page.goto('/#/grid?seed=rav3');
  await expect(page.locator('[data-cell="0:value"]')).toBeVisible();
  await editCell(page, '0:value', '');
  await editCell(page, '1:subject', '');
  await page.locator('[data-cell="2:movement"]').click();
  await page.keyboard.press('Delete');
  await editCell(page, '2:movement', 'Drone, Zoom avant');
  await page.locator('[data-cell="3:angle"]').click();
  await page.keyboard.press('Delete');
  await editCell(page, '3:angle', 'Face, Dos');
  await expect.poll(async () => Object.values((await docOf(page)).shots).some((s) => s.movement.includes('Drone'))).toBe(true);
}

/** Ouvre la première ligne d'un groupe au clavier, après avoir vérifié son nom et sa destination. */
async function openFirst(page: Page, code: string, place: string, description: string) {
  await toChecks(page);
  const line = group(page, code).getByTestId('issue').first();
  await expect(line).toContainText(place);
  // Toute la ligne est le lien (au clavier aussi), nommée par son contenu ; « Ignorer » est une autre commande.
  const go = line.getByTestId('check-go');
  await expect(go).toHaveAccessibleName(new RegExp('^' + place.replace('.', '\\.') + ' '));
  await expect(go).toHaveAccessibleDescription(description);
  await expect(go).not.toHaveAttribute('title');
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/grid$/);
}

/** La cellule est ouverte en saisie, comme après un double-clic : son champ a le clavier. */
async function expectEditing(page: Page, cell: string) {
  await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute('data-flash', '');
  await expect(page.getByTestId('cell-editor')).toHaveCount(1);
  await expect(page.locator(`[data-cell="${cell}"] :focus`)).toHaveCount(1);
}

test.describe('vérifications : chaque contrôle mène à l’endroit exact', () => {
  test('plan sans valeur : la cellule Valeur en saisie, il n’y a plus qu’à écrire', async ({ page }) => {
    await rav3WithIssues(page);
    await openFirst(page, 'missing-value', '1.1', 'Ouvre le plan dans le découpage');
    await expectEditing(page, '0:value');
    await page.keyboard.type('Large');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await shotAt(page, 0)).value).toBe('Large');
    // Validé, le clavier reste dans la grille ; la mise en évidence est brève.
    await expect(page.getByTestId('cell-editor')).toHaveCount(0);
    await expect(page.getByTestId('grid')).toBeFocused();
    await expect(page.locator('[data-flash]')).toHaveCount(0, { timeout: 4000 });
  });

  test('plan sans sujet : la cellule Sujet en saisie ; Échap la referme sans rien changer', async ({ page }) => {
    await rav3WithIssues(page);
    await openFirst(page, 'missing-subject', '1.2', 'Ouvre le plan dans le découpage');
    await expectEditing(page, '1:subject');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cell-editor')).toHaveCount(0);
    await expect(page.getByTestId('grid')).toBeFocused();
    expect((await shotAt(page, 1)).subject).toBe('');
    await page.locator('[data-cell="1:subject"]').dblclick();
    await page.keyboard.type('Admiratrice');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await shotAt(page, 1)).subject).toBe('Admiratrice');
  });

  test('zoom sans focale d’arrivée : la cellule Focale en saisie, directement dans « à »', async ({ page }) => {
    await rav3WithIssues(page);
    await openFirst(page, 'zoom-focal', '1.3', 'Ouvre le plan dans le découpage');
    await expectEditing(page, '2:focal');
    await expect(page.getByTestId('focal-to')).toBeFocused();
    await page.keyboard.type('50');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await shotAt(page, 2)).focal.to).toBe(50);
  });

  test('angles incompatibles : la cellule Angle en saisie', async ({ page }) => {
    await rav3WithIssues(page);
    await openFirst(page, 'angle-conflict', '1.4', 'Ouvre le plan dans le découpage');
    await expectEditing(page, '3:angle');
  });

  test('rappel drone : la cellule Mouvement sélectionnée, sans saisie (rien n’y manque)', async ({ page }) => {
    await rav3WithIssues(page);
    await openFirst(page, 'drone', '1.3', 'Ouvre le plan dans le découpage');
    await expect(page.locator('[data-cell="2:movement"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-cell="2:movement"]')).toHaveAttribute('data-flash', '');
    await expect(page.getByTestId('cell-editor')).toHaveCount(0);
    // La grille reprend le clavier sur la cellule choisie.
    await expect(page.getByTestId('grid')).toBeFocused();
  });

  test('rappel machiniste : la cellule Mouvement sélectionnée, sans saisie ; ignorer à part', async ({ page }) => {
    await page.goto('/#/checks?seed=fiction');
    await expect(group(page, 'stabilizer-safety')).toContainText('prévoir un machiniste de sécurité');
    await group(page, 'stabilizer-safety').getByTestId('issue').first().getByTestId('check-go').click();
    await expect(page).toHaveURL(/#\/grid$/);
    await expect(page.locator('[data-cell$=":movement"][data-flash]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-cell$=":movement"][data-flash]')).toContainText(/Épaule|Steadicam/i);
    await expect(page.getByTestId('cell-editor')).toHaveCount(0);

    // Ignorer ne navigue pas ; le clavier passe à la ligne suivante.
    await toChecks(page);
    const lines = page.getByTestId('issue');
    const n = await lines.count();
    const second = (await lines.nth(1).getByTestId('check-go').textContent()) ?? '';
    await lines.first().getByRole('button', { name: /^Ignorer / }).click();
    await expect(page).toHaveURL(/#\/checks$/);
    await expect(lines).toHaveCount(n - 1);
    await expect(page.locator('[data-check-go]:focus')).toHaveText(second);
    // Dernière ligne ignorée : le clavier va sur « Rétablir ».
    for (let k = n - 1; k > 0; k--) await page.locator('[data-check-go]:focus').locator('..').getByRole('button', { name: /^Ignorer / }).click();
    await expect(page.locator('[data-restore]')).toBeFocused();
  });

  test('sautes : une série en une ligne, ses plans sélectionnés sans saisie ; la barre du découpage reste en vue', async ({ page }) => {
    await page.goto('/#/checks?seed=rav3');
    // Six plans identiques (4.1 à 4.6) : une ligne, pas cinq.
    const jumps = group(page, 'jump-cut').getByTestId('issue');
    await expect(jumps).toHaveCount(2);
    const loge = jumps.first();
    await expect(loge).toContainText(/4\.1\s–\s4\.6/);
    await expect(loge).toContainText('6 plans');
    await expect(loge.getByTestId('check-go')).toHaveAccessibleDescription('Sélectionne ces plans dans le découpage');
    await loge.getByTestId('check-go').click();
    await expect(page).toHaveURL(/#\/grid$/);
    const d = await docOf(page);
    const ids = d.sequences[d.project.sequenceIds[3]].shotIds;
    for (const id of ids) {
      const row = page.locator(`tr[data-shot="${id}"]`);
      await expect(row).toHaveAttribute('data-flash', '');
      for (const c of ['subject', 'value', 'angle', 'movement']) await expect(row.locator(`[data-cell$=":${c}"]`)).toHaveAttribute('aria-selected', 'true');
    }
    await expect(page.getByTestId('cell-editor')).toHaveCount(0);
    // Seule la grille a défilé : la barre d'outils du découpage est toujours là.
    await expect(page.getByRole('toolbar', { name: 'Outils de la grille' })).toBeInViewport();
    await expect(page.locator(`tr[data-shot="${ids[0]}"]`)).toBeInViewport();
  });

  test('séquence sans plan : le clavier va sur son « + », jamais sur un plan hors de vue', async ({ page }) => {
    await page.goto('/#/grid?seed=rav3');
    await page.getByRole('button', { name: 'Insérer une séquence après la séquence 7' }).click({ force: true });
    // La nouvelle séquence naît avec un plan : on le retire.
    await page.locator('tbody[data-seq]').last().getByTestId('delete-shot').click({ force: true });
    await expect(page.locator('[data-empty-seq]')).toHaveCount(1);
    // Une sélection ancienne, en haut de la grille.
    await page.locator('[data-cell="0:subject"]').click();
    const before = JSON.stringify((await docOf(page)).shots);
    await toChecks(page);
    const empty = group(page, 'empty-sequence').getByTestId('issue');
    await expect(empty).toHaveCount(1);
    // Sans libellé : un tiret estompé, pas un blanc.
    await expect(empty).toContainText('8');
    await expect(empty).toContainText('—');
    await expect(empty.getByTestId('check-go')).toHaveAccessibleDescription('Ouvre la séquence dans le découpage');
    await empty.getByTestId('check-go').click();
    const target = page.locator('[data-empty-seq]');
    await expect(target).toHaveAttribute('data-flash', '');
    await expect(target).toBeInViewport();
    const add = target.getByTestId('add-first-shot');
    await expect(add).toBeFocused();
    // Une frappe ne part pas dans un autre plan.
    await page.keyboard.type('ZZZ');
    await expect(page.getByTestId('cell-editor')).toHaveCount(0);
    expect(JSON.stringify((await docOf(page)).shots)).toBe(before);
    // Entrée : le premier plan de la séquence.
    await add.press('Enter');
    await expect(page.locator('[data-empty-seq]')).toHaveCount(0);
  });

  test('écart de durée : la durée estimée de l’en-tête de séquence, en saisie', async ({ page }) => {
    await page.goto('/#/checks?seed=fiction');
    const gap = group(page, 'estimate-gap').getByTestId('issue').first();
    await expect(gap.getByTestId('check-go')).toHaveAccessibleDescription('Ouvre la durée estimée de la séquence');
    await gap.getByTestId('check-go').click();
    await expect(page).toHaveURL(/#\/grid$/);
    const input = page.locator('input[data-seq-estimate][data-flash]');
    await expect(input).toHaveCount(1);
    await expect(page.locator('tbody[data-seq]', { has: input })).toContainText('PARVIS DE LA GARE');
    await expect(input).toBeFocused();
    // Le texte est sélectionné : la frappe le remplace.
    await page.keyboard.type('0:20');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('grid')).toBeFocused();
    const d = await docOf(page);
    expect(Object.values(d.sequences).find((q) => q.label === 'PARVIS DE LA GARE')!.estimatedSec).toBe(20);
  });
});

test.describe('vérifications : institutionnel', () => {
  async function instit(page: Page) {
    await page.goto('/#/');
    await page.getByTestId('new-project').click();
    await page.getByLabel('Titre du projet').fill('Instit');
    await page.getByRole('radio', { name: 'Institutionnel' }).click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('view-table').click();
    await page.getByTestId('create-first').click();
    await editCell(page, '0:subject', 'Atelier');
    await editCell(page, '0:value', 'Insert');
    // On part de l'onglet Interview : la vérification ramène à la grille des illustrations.
    await page.getByTestId('tab-interview').click();
  }

  for (const code of ['doc-open-wide', 'doc-close-wide']) {
    test(`${code === 'doc-open-wide' ? 'ouverture' : 'fermeture'} sans plan large : la Valeur du plan en saisie, même depuis l’onglet Interview`, async ({ page }) => {
      await instit(page);
      await toChecks(page);
      // Un seul plan d'illustration : la fermeture le vise aussi.
      await group(page, code).getByTestId('check-go').filter({ hasText: '1.1' }).click();
      await expect(page.getByTestId('grid')).toBeVisible();
      await expectEditing(page, '0:value');
      await page.keyboard.press('Control+a');
      await page.keyboard.type('Plan général');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await shotAt(page, 0)).value).toBe('Plan général');
    });
  }

  test('plan d’interview : sa caméra dans la fiche, le champ en saisie', async ({ page }) => {
    await page.goto('/#/grid?seed=rav3');
    await page.getByTestId('project-menu').click();
    await page.getByTestId('project-panel').getByText('Institutionnel', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('tab-interview').click();
    const itw = page.getByTestId('interview');
    await itw.getByTestId('setup-placement').getByRole('radio', { name: 'Séq. 2' }).click();
    await expect(itw).toContainText('Plans 2.9A, 2.9B');
    // Caméra B sans valeur de cadre.
    const camB = itw.locator('[data-itw-cam]').nth(1);
    await camB.getByLabel('Valeur', { exact: true }).fill('');
    await camB.getByLabel('Valeur', { exact: true }).press('Tab');
    await page.getByTestId('view-table').click();

    await toChecks(page);
    const line = group(page, 'missing-value').getByTestId('check-go').filter({ hasText: '2.9B' });
    await expect(line).toHaveAccessibleDescription('Ouvre la caméra dans la fiche d’interview');
    await line.click();
    await expect(page.getByTestId('interview')).toBeVisible();
    const cam = page.getByTestId('interview').locator('[data-itw-cam]').nth(1);
    await expect(cam).toHaveAttribute('data-flash', '');
    await expect(cam.getByLabel('Valeur', { exact: true })).toBeFocused();
  });
});

test.describe('vérifications sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('le plan visé s’ouvre, pas le premier ; un rappel ne met pas le champ en saisie', async ({ page }) => {
    await page.goto('/#/checks?seed=fiction');
    const line = group(page, 'stabilizer-safety').getByTestId('check-go').first();
    const place = (await line.locator('span').first().innerText()).trim();
    expect(place).not.toBe('1.1');
    await line.click();
    await expect(page.getByTestId('mobile-cut')).toBeVisible();
    await expect(page.locator('[data-mobile-title]')).toContainText(`Plan ${place}`);
    await expect(page.locator('[data-testid="mobile-cut"] [data-field="movement"]')).toHaveAttribute('data-flash', '');
    await expect(page.locator('[data-testid="mobile-cut"] :focus')).toHaveCount(0);
  });

  test('plan sans valeur : le champ Valeur du plan en saisie', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await page.getByTestId('mobile-next').click();
    await expect(page.locator('[data-mobile-title]')).toContainText('Plan 1.2');
    const value = page.locator('[data-field="value"] input');
    await value.fill('');
    await value.blur();
    await expect.poll(async () => (await shotAt(page, 1)).value).toBe('');
    await page.getByTestId('mobile-prev').click();

    await toChecks(page);
    await group(page, 'missing-value').getByTestId('check-go').filter({ hasText: '1.2' }).click();
    await expect(page.locator('[data-mobile-title]')).toContainText('Plan 1.2');
    await expect(page.locator('[data-field="value"]')).toHaveAttribute('data-flash', '');
    await expect(value).toBeFocused();
    await page.keyboard.type('Moyen');
    await value.blur();
    await expect.poll(async () => (await shotAt(page, 1)).value).toBe('Moyen');
  });

  test('écart de durée : la durée estimée de l’en-tête, en saisie', async ({ page }) => {
    await page.goto('/#/checks?seed=fiction');
    await group(page, 'estimate-gap').getByTestId('check-go').first().click();
    await expect(page.getByTestId('mobile-cut')).toBeVisible();
    await expect(page.locator('[data-mobile-title]')).toContainText('Plan 3.1');
    const input = page.locator('[data-testid="mobile-cut"] input[data-seq-estimate]');
    await expect(input).toBeFocused();
    await page.keyboard.type('0:20');
    await page.keyboard.press('Enter');
    const d = await docOf(page);
    expect(Object.values(d.sequences).find((q) => q.label === 'PARVIS DE LA GARE')!.estimatedSec).toBe(20);
  });
});
