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

  const md = ['# DECOUPAGE DECOUPAGE-STUDIO v1', '', '## INT. CUISINE - JOUR', '| Sujet | Valeur | Action |', '|---|---|---|', '| Léa | Gros plan | Elle boit son café. |', '| Tasse | Insert | La vapeur monte. |'].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('ai-cut-import').click();
  await (await chooser).setFiles({ name: 'decoupage.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await expect(rows).toHaveCount(n + 2);
  await expect(page.getByText('Elle boit son café.')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(n);
});
