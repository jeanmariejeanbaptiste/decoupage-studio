import { expect, test, type Page } from '@playwright/test';

async function selectText(page: Page, needle: string, length = needle.length) {
  await page.getByTestId('scenario-editor').evaluate(
    (el, [n, len]) => {
      const ta = el as HTMLTextAreaElement;
      const i = ta.value.indexOf(n as string);
      ta.focus();
      ta.setSelectionRange(i, i + (len as number));
    },
    [needle, length] as const,
  );
}

test.describe('scénario et liaison', () => {
  test('clic droit → créer un plan avec cette action', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    const marc = page.getByTestId('scenario-shot').filter({ hasText: 'Marc attend sous la pluie' });
    await expect(page.getByTestId('scenario-shot').first()).toBeVisible();
    const before = await marc.count();
    await selectText(page, 'Marc attend sous la pluie');
    await page.getByTestId('scenario-editor').dispatchEvent('contextmenu', { clientX: 500, clientY: 400, button: 2 });
    // Mode lié (par défaut) : le plan va directement dans la séquence de la scène.
    await expect(marc).toHaveCount(before + 1);
  });

  test('les répliques sélectionnées vont dans le dialogue', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    const src = "GUICHETIER\nC'est pour combien de temps ?";
    // Mode libre : la séquence se choisit, celle de la scène est suggérée en premier.
    await page.getByTestId('scenario-link-mode').uncheck();
    await selectText(page, src);
    await page.getByTestId('create-shot-from-selection').click();
    await expect(page.getByRole('menuitem').first()).toContainText('(suggérée)');
    await page.getByRole('menuitem').first().click();
    const doc = await page.evaluate(() => (window as unknown as { __ds: { doc: () => { shots: Record<string, { subject: string; actionBlockId: string }>; blocks: Record<string, { dialogue?: string }> } } }).__ds.doc());
    const shot = Object.values(doc.shots).find((s) => doc.blocks[s.actionBlockId].dialogue === "GUICHETIER : C'est pour combien de temps ?");
    expect(shot?.subject).toBe('Guichetier');
  });

  test('un nouvel en-tête ne touche pas le découpage, sauf sur demande', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    const editor = page.getByTestId('scenario-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nINT. CAFÉ DE LA GARE - NUIT\n\nNINA\nBonsoir.\n');
    await page.waitForTimeout(900);
    await expect(page.locator('aside').getByText('4, CAFÉ DE LA GARE')).toHaveCount(0);
    await page.getByTestId('import-scenes').click();
    await expect(page.locator('aside').getByText('4, CAFÉ DE LA GARE')).toBeVisible();
    await page.getByRole('button', { name: 'Ouvrir le découpage' }).click();
    await expect(page.locator('tbody[data-seq]').nth(3)).toContainText('CAFÉ DE LA GARE');
    await page.locator('tbody[data-seq]').nth(3).getByRole('button', { name: 'Ajouter un plan' }).click();
    await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(12);
    await page.goto('/#/registry?tab=characters');
    await expect(page.getByTestId('character-row').filter({ has: page.locator('td:first-child', { hasText: 'Nina' }) })).toHaveCount(1);
  });

  test('vue page, import et export .fountain', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    await page.getByRole('radio', { name: 'Page', exact: true }).click();
    await expect(page.getByTestId('script-reader')).toContainText('INT. GARE — CONSIGNE - JOUR');
    await page.getByRole('radio', { name: 'Découpage' }).click();
    await expect(page.getByTestId('scenario-cut')).toContainText('GARE');
    await page.getByRole('radio', { name: 'Page', exact: true }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: '.fountain' }).click();
    expect((await dl).suggestedFilename()).toBe('La Consigne.fountain');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Importer/ }).click();
    await (await chooser).setFiles({ name: 'court.fountain', mimeType: 'text/plain', buffer: Buffer.from('EXT. TOIT - AUBE\n\nLe soleil se lève.\n') });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remplacer' }).click();
    await expect(page.getByTestId('script-reader')).toContainText('Le soleil se lève.');
  });

  test('l’inspecteur montre le passage lié', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await page.getByRole('button', { name: 'Inspecteur' }).click();
    await page.locator('[data-cell="4:subject"]').click();
    await expect(page.getByTestId('inspector-passage')).toContainText('Léa pose la valise sur le comptoir.');
  });
});

test('scénario dans le découpage : un seul panneau à droite, + par phrase et sur sélection', async ({ page }) => {
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await page.getByRole('button', { name: 'Inspecteur' }).click();
  await page.getByTestId('toggle-scenario').click();
  const panel = page.getByTestId('scenario-panel');
  await expect(panel).toBeVisible();
  // Un seul panneau : l'inspecteur s'est refermé.
  await expect(page.getByRole('button', { name: 'Inspecteur' })).toHaveAttribute('aria-pressed', 'false');
  // Survol d'une phrase : le « + » apparaît à sa fin et ajoute la phrase au découpage.
  const sentence = panel.getByTestId('script-sentence').first();
  await sentence.hover();
  await sentence.getByTestId('script-plus').click();
  await expect(rows).toHaveCount(n + 1);
  // Sélection libre : un « + » apparaît au-dessus de la fin de la sélection.
  const target = panel.getByTestId('script-sentence').nth(2).locator('span').first();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await panel.getByTestId('script-selection-plus').click();
  await expect(rows).toHaveCount(n + 2);
});
