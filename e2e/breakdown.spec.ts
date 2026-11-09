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
  // Pas de numéro tant qu'elle n'est pas au découpage ; ensuite, celui de sa séquence.
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
  // La liste du film garde la cigarette, qui n'est pas de cette séquence (elle s'y ajoute d'un clic).
  await expect(page.getByRole('button', { name: 'Ajouter Cigarette à cette séquence' })).toBeVisible();
  // Le choix d'affichage est retenu.
  await page.reload();
  await expect(page.getByTestId('breakdown-full')).toBeVisible();
});

test('dépouillement : liste du film entier, et rapports par élément et par séquence', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-view-full').click();
  const full = page.getByTestId('breakdown-full');
  await full.getByTestId('tag-suggestion').filter({ hasText: 'cigarette' }).click();
  // La liste du film garde la cigarette (séquence 3) quand on lit la séquence 2, et l'y ajoute d'un clic.
  await page.getByTestId('breakdown-scene').nth(1).click();
  const whole = page.getByTestId('breakdown-whole');
  await expect(whole.getByTestId('breakdown-accessoires')).toContainText('Cigarette');
  await whole.getByRole('button', { name: 'Ajouter Cigarette à cette séquence' }).click();
  await expect(whole.getByRole('button', { name: 'Retirer Cigarette de cette séquence' })).toBeVisible();
  // Rapports : l'élément et ses deux séquences ; la séquence et ses éléments.
  await page.getByTestId('breakdown-view-reports').click();
  const item = page.getByTestId('breakdown-report-item').filter({ hasText: 'Cigarette' });
  await expect(item).toContainText('2');
  await page.getByLabel('Rapport', { exact: true }).selectOption('sequences');
  await expect(page.getByTestId('breakdown-report-seq')).toHaveCount(3);
  // Un numéro de séquence ramène au texte.
  await page.getByLabel('Rapport', { exact: true }).selectOption('items');
  await item.getByRole('button', { name: '3' }).click();
  await expect(page.getByTestId('breakdown-full')).toBeVisible();
});

test('dépouillement : numéros du découpage ; une scène pas encore au découpage n’en décale aucun', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  const ed = page.getByTestId('script-editor');
  await ed.locator('[data-type="heading"]').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.type('INT. QUAI - NUIT\n');
  await expect(ed.locator('[data-type="heading"]').first()).toHaveText('INT. QUAI - NUIT');
  await page.getByRole('button', { name: /Dépouillement/ }).first().click();
  const scenes = page.getByTestId('breakdown-scene');
  await expect(scenes.nth(0)).toContainText('–QUAI');
  await expect(scenes.nth(1)).toContainText('1GARE — HALL');
  await expect(scenes.nth(3)).toContainText('3PARVIS DE LA GARE');
  await page.getByTestId('breakdown-view-reports').click();
  await page.getByLabel('Rapport', { exact: true }).selectOption('sequences');
  await expect(page.getByTestId('breakdown-report-seq').nth(1)).toContainText('1, GARE — HALL');
});

test('dépouillement : un personnage ajouté entre au registre, suit son renommage et se retire', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' }).click();
  await page.getByLabel('Ajouter (Personnages)').fill('Marc');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-personnages')).toContainText('Marc');
  await page.getByRole('link', { name: /Registre/ }).or(page.getByRole('button', { name: /Registre/ })).first().click();
  const row = page.getByRole('table', { name: 'Séquences' }).locator('tbody tr').first();
  await expect(row).toContainText('Marc');
  await page.getByRole('tab', { name: /Personnages/ }).click();
  const marc = page.getByTestId('character-row').filter({ has: page.locator('td:nth-child(2)', { hasText: 'Marc' }) });
  await marc.locator('td').nth(1).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Marco');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('character-row').filter({ has: page.locator('td:nth-child(2)', { hasText: 'Marco' }) })).toHaveCount(1);
  await page.getByRole('button', { name: /Dépouillement/ }).first().click();
  await page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' }).click();
  await expect(page.getByTestId('breakdown-personnages')).toContainText('Marco');
  await page.getByRole('button', { name: 'Retirer Marco' }).click();
  await expect(page.getByTestId('breakdown-personnages')).not.toContainText('Marco');
});

test('dépouillement : le compteur de la liste compte les éléments de la fiche, saisis ou déduits', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  const hall = page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' });
  await hall.click();
  // Léa et deux éléments de machinerie viennent des plans : 3, sans rien de saisi.
  await expect(hall.locator('em')).toHaveText('3');
  await expect(page.getByTestId('breakdown-add-all').first()).toHaveText('Ajouter la suggestion soulignée');
  await page.getByTestId('breakdown-add-all').first().click();
  await expect(hall.locator('em')).toHaveText('4');
});
