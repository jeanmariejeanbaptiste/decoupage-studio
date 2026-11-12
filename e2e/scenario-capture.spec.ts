import { expect, test, type Locator, type Page } from '@playwright/test';

/** Sélectionne à la souris le texte d'un segment du lecteur, du début à la fin. */
async function drag(page: Page, seg: Locator) {
  // Du début de la première ligne à la fin de la dernière (une phrase peut tenir sur deux lignes).
  const [a, b] = await seg.evaluate((el) => {
    const r = Array.from(el.getClientRects());
    const f = r[0];
    const l = r[r.length - 1];
    return [
      { x: f.left + 1, y: f.top + f.height / 2 },
      { x: l.right - 1, y: l.top + l.height / 2 },
    ];
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test('scénario vers la cellule Action : seulement en saisie, au curseur, lié au passage, sans nouveau plan', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await page.getByTestId('toggle-scenario').click();
  const panel = page.getByTestId('scenario-panel');
  await expect(panel).toBeVisible();
  const action = page.locator('[data-cell="0:action"]');
  const before = (await action.innerText()).trim();

  // Cellule seulement sélectionnée : rien ne la vise, la sélection relâchée crée un plan.
  await action.click();
  await expect(panel.getByTestId('capture-target')).toHaveCount(0);
  await expect(panel.getByTestId('scenario-link-mode')).toBeVisible();
  const third = panel.getByTestId('script-sentence').nth(2).locator('span').first();
  await drag(page, third);
  await expect(rows).toHaveCount(n + 1);
  await expect(action).toHaveText(before);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(n);

  // Double-clic : la cellule s'ouvre en saisie, le panneau nomme sa destination à la place du réglage.
  await action.dblclick();
  const editor = page.getByTestId('cell-editor');
  await expect(editor).toBeFocused();
  await expect(panel.getByTestId('capture-target')).toHaveText('Action du plan 1.1');
  await expect(panel.getByTestId('scenario-link-mode')).toHaveCount(0);
  await expect(panel).toHaveAttribute('data-capturing', 'true');

  // La sélection dans le lecteur entre dans la cellule, à la suite, et la saisie reste ouverte.
  const picked = (await third.innerText()).trim();
  await drag(page, third);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(`${before} ${picked}`);
  // Un simple clic dans le lecteur ne ferme pas la saisie.
  const box = (await third.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expect(editor).toBeFocused();
  // Une autre sélection s'ajoute au curseur.
  await page.keyboard.press('End');
  const fifth = panel.getByTestId('script-sentence').nth(4);
  const fifthText = (await fifth.locator('span').first().innerText()).trim();
  await drag(page, fifth.locator('span').first());
  await expect(editor).toHaveValue(`${before} ${picked} ${fifthText}`);
  await page.keyboard.type(' Fin.');
  await page.keyboard.press('Enter');

  // Validée : le texte est dans la cellule, aucun plan créé, le passage apparaît lié dans le lecteur.
  await expect(page.getByTestId('cell-editor')).toHaveCount(0);
  await expect(action).toContainText(`${picked} ${fifthText} Fin.`);
  await expect(rows).toHaveCount(n);
  await expect(panel.getByTestId('capture-target')).toHaveCount(0);
  // Le passage est lié à l'action du plan (aucune marque dans le lecteur).
  await expect
    .poll(() => page.evaluate(() => Object.values((window as unknown as { __ds: { doc: () => { blocks: Record<string, { scenarioAnchor?: unknown }> } } }).__ds.doc().blocks).filter((b) => b.scenarioAnchor).length))
    .toBeGreaterThan(0);
  await expect(panel.locator('[class*="linked"]')).toHaveCount(0);
  // Un seul pas d'annulation.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(action).toHaveText(before);
});

test('scénario du découpage : lecture seule ; panneau fermé, la saisie se valide comme avant', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('toggle-scenario').click();
  const panel = page.getByTestId('scenario-panel');
  // Plus de mode Écrire : le scénario s'écrit dans l'onglet Scénario.
  await expect(panel.getByRole('radio')).toHaveCount(0);
  await expect(panel.locator('textarea')).toHaveCount(0);
  await expect(panel.getByTestId('scenario-link-mode')).toBeVisible();
  await panel.getByRole('button', { name: 'Fermer le scénario' }).click();
  const action = page.locator('[data-cell="0:action"]');
  await action.dblclick();
  await page.getByTestId('cell-editor').fill('Texte libre');
  await page.locator('[data-cell="1:subject"]').click();
  await expect(page.getByTestId('cell-editor')).toHaveCount(0);
  await expect(action).toHaveText('Texte libre');
});
