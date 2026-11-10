import { expect, test, type Page } from '@playwright/test';

/** Sélectionne un passage du texte de la scène (à l'envers si demandé) et relâche la souris sur `target`. */
async function select(page: Page, words: string, opts: { backward?: boolean; releaseOn?: 'mark' } = {}) {
  await page.getByTestId('scene-text').first().evaluate(
    (root, { w, backward, releaseOn }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) nodes.push(n as Text);
      const full = nodes.map((t) => t.nodeValue ?? '').join('');
      const at = full.indexOf(w);
      if (at < 0) throw new Error(`introuvable : ${w}`);
      const locate = (pos: number): [Text, number] => {
        let k = 0;
        for (const t of nodes) {
          const len = t.nodeValue?.length ?? 0;
          if (pos <= k + len) return [t, pos - k];
          k += len;
        }
        throw new Error('hors du texte');
      };
      const [a, ai] = locate(at);
      const [b, bi] = locate(at + w.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      if (backward) sel.setBaseAndExtent(b, bi, a, ai);
      else sel.setBaseAndExtent(a, ai, b, bi);
      const target = releaseOn === 'mark' ? (a.parentElement?.closest('mark') ?? root) : root;
      const box = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: box.left + 2, clientY: box.bottom }));
    },
    { w: words, backward: !!opts.backward, releaseOn: opts.releaseOn },
  );
}

/** ⌘Z hors d'un champ de saisie (le focus quitte le champ d'abord). */
async function undo(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+z');
}

test('dépouillement : un repère déduit n’ouvre pas de menu ; un repère saisi se range ailleurs', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' }).click();
  const text = page.getByTestId('scene-text');
  // Léa vient des plans : pas de menu « Retirer » qui ne ferait rien.
  await text.getByTestId('tag-mark').filter({ hasText: 'Léa' }).click();
  await expect(page.locator('[data-tag-pop]')).toHaveCount(0);
  // Un élément saisi : son menu le retire ou le range dans une autre catégorie.
  await text.getByTestId('tag-suggestion').filter({ hasText: 'valise' }).click();
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Valise');
  await text.getByTestId('tag-mark').filter({ hasText: 'valise' }).click();
  await expect(page.getByRole('menuitem', { name: 'Retirer du dépouillement' })).toBeFocused();
  await page.getByTestId('move-to-costumes').click();
  await expect(page.getByTestId('breakdown-costumes')).toContainText('Valise');
  await expect(page.getByTestId('breakdown-accessoires')).not.toContainText('Valise');
  await undo(page);
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Valise');
  await expect(page.getByTestId('breakdown-costumes')).not.toContainText('Valise');
});

test('dépouillement : une sélection relâchée sur un repère ouvre le choix, au clavier jusqu’au bout', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-scene').filter({ hasText: 'GARE — HALL' }).click();
  // De droite à gauche, la souris relâchée sur « valise » (souligné) : le choix s'ouvre.
  await select(page, 'valise cabossée', { backward: true, releaseOn: 'mark' });
  const pop = page.locator('[data-tag-pop]');
  await expect(pop).toContainText('Valise cabossée');
  // Le focus est dans le menu ; Échap le ferme et le rend au texte.
  await expect(page.getByTestId('tag-as-personnages')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(page.getByTestId('scene-text')).toBeFocused();
  // Flèches dans la grille, Entrée ajoute.
  await select(page, 'roue');
  await expect(page.getByTestId('tag-as-personnages')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('tag-as-accessoires')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tag-as-costumes')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-accessoires')).toContainText('Roue');
});

test('dépouillement : une orthographe par élément, retrait quelle que soit la casse', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  const scenes = page.getByTestId('breakdown-scene');
  await scenes.nth(0).click();
  await page.getByLabel('Ajouter (Accessoires)').fill('valise');
  await page.keyboard.press('Enter');
  await scenes.nth(1).click();
  // Proposé à la saisie : un élément d'une autre séquence, pas ceux de celle-ci.
  const options = await page.getByLabel('Ajouter (Accessoires)').evaluate((el) => Array.from((el as HTMLInputElement).list?.options ?? []).map((o) => o.value));
  expect(options).toContain('valise');
  await page.getByLabel('Ajouter (Accessoires)').fill('Valise');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-accessoires').locator('li')).toHaveText(['valise']);
  const after = await page.getByLabel('Ajouter (Accessoires)').evaluate((el) => Array.from((el as HTMLInputElement).list?.options ?? []).map((o) => o.value));
  expect(after).not.toContain('valise');
  // Liste du film : retirée de la séquence 2, elle reste à la 1.
  await page.getByTestId('breakdown-view-full').click();
  const item = page.getByTestId('whole-item').filter({ hasText: 'valise' });
  await expect(item.locator('button')).toHaveText(['1', '2', '']);
  await page.getByRole('button', { name: 'Retirer valise de cette séquence' }).click();
  await expect(item.locator('button')).toHaveText(['1', '']);
});

test('dépouillement : coller une liste ajoute un élément par ligne, annulé d’un coup', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  const field = page.getByLabel('Ajouter (Accessoires)');
  await field.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Valise\nParapluie\n\nBillet\n');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('breakdown-accessoires').locator('li')).toHaveText(['Valise', 'Parapluie', 'Billet']);
  await expect(field).toHaveValue('');
  await undo(page);
  await expect(page.getByTestId('breakdown-accessoires').locator('li')).toHaveCount(0);
});

test('dépouillement : catégories sans doublon, renommées sans perdre leurs éléments', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('add-breakdown-category').fill('son');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid^="breakdown-perso:"]')).toHaveCount(0);
  await expect(page.getByLabel('Ajouter (Son)')).toBeFocused();
  await page.getByTestId('add-breakdown-category').fill('Animeaux');
  await page.keyboard.press('Enter');
  await page.getByLabel('Ajouter (Animeaux)').fill('Chien');
  await page.keyboard.press('Enter');
  await page.getByTestId('breakdown-perso:Animeaux').getByText('Animeaux').dblclick();
  await page.getByTestId('breakdown-rename').fill('Animaux');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakdown-perso:Animaux')).toContainText('Chien');
  await expect(page.getByTestId('breakdown-perso:Animeaux')).toHaveCount(0);
  await undo(page);
  await expect(page.getByTestId('breakdown-perso:Animeaux')).toContainText('Chien');
});

test('dépouillement : renommer un élément dans tout le film depuis la liste', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-view-full').click();
  const full = page.getByTestId('breakdown-full');
  await full.getByTestId('tag-suggestion').filter({ hasText: 'valise' }).first().click();
  await full.getByTestId('tag-suggestion').filter({ hasText: 'valise' }).first().click();
  const item = page.getByTestId('whole-item').filter({ hasText: 'Valise' });
  await expect(item.locator('button')).toHaveText(['1', '2', '']);
  await item.getByText('Valise').dblclick();
  await page.getByTestId('breakdown-rename').fill('Valise cabossée');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('whole-item').filter({ hasText: 'Valise cabossée' }).locator('button')).toHaveText(['1', '2', '']);
  await expect(full.getByTestId('tag-mark').filter({ hasText: 'valise cabossée' })).toHaveCount(1);
  await undo(page);
  await expect(page.getByTestId('whole-item').filter({ hasText: 'Valise cabossée' })).toHaveCount(0);
  // Un personnage (registre) ne se renomme pas d'ici.
  await page.getByTestId('whole-item').filter({ hasText: 'Léa' }).getByText('Léa').dblclick();
  await expect(page.getByTestId('breakdown-rename')).toHaveCount(0);
});

test('dépouillement : clavier dans la liste des séquences et le choix d’affichage', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  const scenes = page.getByTestId('breakdown-scene');
  await scenes.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(scenes.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(scenes.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(scenes.nth(0)).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('breakdown-view-sequence').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('breakdown-view-full')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('breakdown-view-full')).toBeFocused();
  await expect(page.getByTestId('breakdown-full')).toBeVisible();
});

test('dépouillement : à 390 px, barre sur une ligne par bouton et séquence courante en vue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/breakdown?seed=fiction');
  for (const v of ['sequence', 'full', 'reports']) {
    const h = await page.getByTestId(`breakdown-view-${v}`).evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeLessThan(34);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const scenes = page.getByTestId('breakdown-scene');
  await scenes.nth(0).focus();
  await page.keyboard.press('End');
  await expect(scenes.nth(2)).toHaveAttribute('aria-current', 'true');
  const [strip, last] = await Promise.all([page.locator('nav[aria-label="Séquences"] ol').boundingBox(), scenes.nth(2).boundingBox()]);
  expect(last!.x + last!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
  expect(last!.x).toBeGreaterThanOrEqual(strip!.x - 1);
});

test('dépouillement : annuler l’ajout qui a créé la séquence garde la scène courante', async ({ page }) => {
  await page.goto('/#/scenario?seed=fiction');
  await page.getByTestId('script-editor').locator('[data-bid]').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nEXT. QUAI - NUIT\nUn train passe sans s’arrêter.');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ds: { doc: () => { scenario: string } } }).__ds.doc().scenario)).toContain('EXT. QUAI - NUIT');
  await page.getByRole('button', { name: /Dépouillement/ }).click();
  const scene = page.getByTestId('breakdown-scene').filter({ hasText: 'QUAI' });
  await scene.click();
  await select(page, 'train');
  await page.getByTestId('tag-as-vehicules').click();
  await expect(page.getByText('pas encore au découpage')).toHaveCount(0);
  await undo(page);
  await expect(page.getByText('pas encore au découpage')).toBeVisible();
  await expect(scene).toHaveAttribute('aria-current', 'true');
});

test('dépouillement : les rapports retiennent catégorie et tri', async ({ page }) => {
  await page.goto('/#/breakdown?seed=fiction');
  await page.getByTestId('breakdown-view-reports').click();
  await page.getByTestId('breakdown-report-cat').selectOption({ label: 'Machinerie' });
  await page.getByLabel('Trier').selectOption('often');
  await page.getByTestId('breakdown-report-item').first().getByRole('button').first().click();
  await expect(page.getByTestId('breakdown-reports')).toHaveCount(0);
  await page.getByTestId('breakdown-view-reports').click();
  await expect(page.getByTestId('breakdown-report-cat')).toHaveValue('machinerie');
  await expect(page.getByLabel('Trier')).toHaveValue('often');
  // Une valeur abîmée revient au défaut, sans erreur.
  await page.evaluate(() => localStorage.setItem('ds-breakdown-report', '{"cat":"perso:Disparue","sort":42'));
  await page.reload();
  await expect(page.getByTestId('breakdown-report-cat')).toHaveValue('');
  await expect(page.getByLabel('Trier')).toHaveValue('film');
});
