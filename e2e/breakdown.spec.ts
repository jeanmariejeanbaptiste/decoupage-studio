import { expect, test, type Page } from '@playwright/test';

/** Sélectionne un mot du texte de la scène, comme à la souris. */
async function selectWord(page: Page, word: string) {
  const text = page.getByTestId('scene-text');
  await text.evaluate((root, w) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue?.indexOf(w) ?? -1;
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + w.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      const box = r.getBoundingClientRect();
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: box.right, clientY: box.bottom }));
      return;
    }
    throw new Error(`introuvable : ${w}`);
  }, word);
}

test('dépouillement : texte de la scène, suggestions, étiquetage par sélection et ajout manuel', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-scene').filter({ hasText: 'PARVIS DE LA GARE' }).click();
  const text = page.getByTestId('scene-text');
  await expect(text).toContainText('Marc attend sous la pluie');
  // Suggestions soulignées dans le texte : un clic les ajoute.
  await text.getByTestId('tag-suggestion').filter({ hasText: 'cigarette' }).click();
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Cigarette');
  await expect(text.getByTestId('tag-mark').filter({ hasText: 'cigarette' })).toHaveCount(1);
  await page.getByTestId('breakdown-add-all').click();
  await expect(page.getByTestId('breakdown-effets')).toContainText('Pluie');
  await expect(page.getByTestId('breakdown-add-all')).toHaveCount(0);
  await expect(page.getByTestId('breakdown-personnages')).toContainText('Marc');
  // Sélection d'un mot du texte : choix de la catégorie.
  await selectWord(page, 'lèvres');
  await page.getByTestId('tag-as-maquillage').click();
  await expect(page.getByTestId('breakdown-maquillage')).toContainText('Lèvres');
  // Ajout de ce qui n'est pas écrit dans le scénario.
  await page.getByLabel('Ajouter (Costumes)').fill('Imperméable beige');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-costumes')).toContainText('Imperméable beige');
  await page.getByRole('button', { name: 'Retirer Imperméable beige' }).click();
  await expect(page.getByTestId('breakdown-costumes')).not.toContainText('Imperméable');
  // Une marque du texte se retire aussi depuis le texte.
  await text.getByTestId('tag-mark').filter({ hasText: 'lèvres' }).click();
  await page.getByRole('menuitem', { name: 'Retirer du dépouillement' }).click();
  await expect(page.getByTestId('breakdown-maquillage')).not.toContainText('Lèvres');
});

test('dépouillement : une scène écrite mais absente du découpage y entre au premier élément', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await page.getByTestId('script-editor').locator('[data-bid]').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nEXT. QUAI - NUIT\nUn train passe sans s’arrêter.');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario)).toContain('EXT. QUAI - NUIT');
  await page.getByRole('button', { name: /Dépouillement/ }).click();
  const scene = page.getByTestId('breakdown-scene').filter({ hasText: 'QUAI' });
  await expect(scene).toContainText('–');
  await scene.click();
  await expect(page.getByText('pas encore au découpage')).toBeVisible();
  await selectWord(page, 'train');
  await page.getByTestId('tag-as-vehicules').click();
  await expect(page.getByTestId('breakdown-vehicules')).toContainText('Train');
  await expect(page.getByText('pas encore au découpage')).toHaveCount(0);
  await expect(scene).toContainText('4');
  await page.getByRole('button', { name: /Découpage technique/ }).click();
  await expect(page.locator('tbody[data-seq]')).toHaveCount(4);
});

test('dépouillement : catégorie personnalisée, ajoutée puis supprimée sans boîte du navigateur', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('add-breakdown-category').fill('Animaux');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-perso:Animaux')).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer la catégorie Animaux' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByTestId('breakdown-perso:Animaux')).toHaveCount(0);
});

test('dépouillement : le scénario entier d’un seul tenant, la fiche suit la séquence travaillée', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-view-full').click();
  const full = page.getByTestId('breakdown-full');
  await expect(full.getByTestId('breakdown-entry')).toHaveCount(3);
  await expect(full).toContainText('Le hall bruisse');
  await expect(full).toContainText('Marc attend sous la pluie');
  // Une suggestion de la dernière séquence : la fiche passe à cette séquence et la reçoit.
  await full.getByTestId('tag-suggestion').filter({ hasText: 'cigarette' }).click();
  await expect(page.getByLabel('Fiche de dépouillement')).toContainText('PARVIS DE LA GARE');
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Cigarette');
  // La liste mène à la séquence dans le texte continu.
  await page.getByTestId('breakdown-scene').first().click();
  await expect(page.getByLabel('Fiche de dépouillement')).toContainText('HALL');
  await expect(page.getByTestId('breakdown-accessoires')).not.toContainText('Cigarette');
  // Le choix d'affichage est retenu.
  await page.reload();
  await expect(page.getByTestId('breakdown-full')).toBeVisible();
});
