import { expect, test } from '@playwright/test';

test('découpage par une IA externe : consignes copiées, réponse .md importée en une opération', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await page.getByTestId('ai-cut').click();
  await page.getByTestId('ai-cut-copy').click();
  await expect(page.getByTestId('ai-cut-copy')).toHaveText('Consignes copiées');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('# DECOUPAGE DECOUPAGE-STUDIO v1');
  expect(text).toContain('| Sujet | Valeur | Angle | Mouvement de caméra | Focale | Action |');
  expect(text).toContain('Réponds UNIQUEMENT par un bloc de code Markdown');

  const md = ['# DECOUPAGE DECOUPAGE-STUDIO v1', '', '## INT. CUISINE - JOUR', '| Sujet | Valeur | Action |', '|---|---|---|', '| Léa | Gros plan | Elle boit son café. |', '| Tasse | Insert | La vapeur monte. |'].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('ai-cut-import').click();
  await (await chooser).setFiles({ name: 'decoupage.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await expect(rows).toHaveCount(n + 2);
  await expect(page.getByText('Elle boit son café.')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(n);

  // Réponse copiée depuis la conversation (bloc de code) : collée d'un clic.
  await page.evaluate((t) => navigator.clipboard.writeText('```markdown\n' + t + '\n```'), md);
  await page.getByTestId('ai-cut').click();
  await page.getByTestId('ai-cut-paste').click();
  await expect(rows).toHaveCount(n + 2);

  // Réponse non conforme : les écarts sont montrés avant l'import, qu'on peut refuser.
  await page.evaluate(() => navigator.clipboard.writeText('# DECOUPAGE DECOUPAGE-STUDIO v1\n## INT. SALON - NUIT\n| Sujet | Valeur |\n|---|---|\n| Léa | Plan serré |'));
  await page.getByTestId('ai-cut').click();
  await page.getByTestId('ai-cut-paste').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('1 écart aux consignes');
  await expect(dialog).toContainText('« Plan serré » n’est pas dans la liste Valeur');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(rows).toHaveCount(n + 2);
});
