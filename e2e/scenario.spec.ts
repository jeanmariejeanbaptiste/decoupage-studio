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
    await selectText(page, 'Marc attend sous la pluie');
    await page.getByTestId('scenario-editor').dispatchEvent('contextmenu', { clientX: 500, clientY: 400, button: 2 });
    // Un menu demande la séquence ; celle du passage est proposée en premier.
    await page.getByRole('menuitem').first().click();
    await expect(page.getByTestId('toast')).toContainText('Plan 3.4 créé');
    await expect(page.getByTestId('scenario-shot').filter({ hasText: '3.4' })).toContainText('Marc attend sous la pluie');
    await page.getByTestId('toast').getByRole('button', { name: 'Voir dans la grille' }).click();
    await expect(page.locator('[data-cell="11:action"]')).toContainText('Marc attend sous la pluie');
  });

  test('les répliques sélectionnées vont dans le dialogue', async ({ page }) => {
    await page.goto('/#/scenario?seed=fiction');
    const src = "GUICHETIER\nC'est pour combien de temps ?";
    await selectText(page, src);
    await page.getByTestId('create-shot-from-selection').click();
    await expect(page.getByRole('menuitem').first()).toContainText('(suggérée)');
    await page.getByRole('menuitem').first().click();
    await expect(page.getByTestId('toast')).toContainText('Plan 2.5 créé');
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
    await expect(page.getByTestId('scenario-page')).toContainText('INT. GARE — CONSIGNE - JOUR');
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
    await expect(page.getByTestId('scenario-page')).toContainText('Le soleil se lève.');
  });

  test('l’inspecteur montre le passage lié', async ({ page }) => {
    await page.goto('/#/grid?seed=fiction');
    await page.getByRole('button', { name: 'Inspecteur' }).click();
    await page.locator('[data-cell="4:subject"]').click();
    await expect(page.getByTestId('inspector-passage')).toContainText('Léa pose la valise sur le comptoir.');
  });
});
