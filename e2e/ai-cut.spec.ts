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

test('IA externe : une nouvelle version d’une séquence met ses plans à jour au lieu de les doubler', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  const paste = async (md: string) => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), md);
    await page.getByTestId('ai-cut').click();
    await page.getByTestId('ai-cut-paste').click();
  };
  const v1 = ['# DECOUPAGE DECOUPAGE-STUDIO v1', '## INT. CUISINE - JOUR', '| Sujet | Action |', '|---|---|', '| Léa | Elle boit. |', '| Tasse | Vapeur. |'].join('\n');
  await paste(v1);
  await expect(rows).toHaveCount(n + 2);
  // Garde-fou par défaut : rien d'existant ne change, les plans viennent à la suite, sans question.
  await paste(v1.replace('Elle boit.', 'Elle boit son café, pensive.'));
  await expect(rows).toHaveCount(n + 4);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Elle boit.', { exact: true })).toBeVisible();
  await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
  await expect(rows).toHaveCount(n + 2);
  await page.getByTestId('ai-cut').click();
  await page.getByTestId('ai-cut-protect').uncheck();
  await page.keyboard.press('Escape');
  await paste(v1.replace('Elle boit.', 'Elle boit son café, pensive.'));
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('Cette séquence existe déjà');
  await expect(dlg).toContainText('1 plan modifié, 0 plan ajouté');
  await dlg.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(rows).toHaveCount(n + 2);
  await expect(page.getByText('Elle boit son café, pensive.')).toBeVisible();
  await expect(page.getByText('Elle boit.', { exact: true })).toHaveCount(0);
});

test('le découpage se copie en Markdown depuis Exporter', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/grid?seed=rav3');
  await expect(page.locator('[data-testid="shot-row"]').first()).toBeVisible();
  await page.getByTestId('grid-export').click();
  const panel = page.getByTestId('grid-export-panel');
  await panel.getByText('Markdown', { exact: true }).click();
  await expect(page.getByTestId('grid-export-nomerge')).toHaveCount(0);
  await panel.getByTestId('grid-export-go').click();
  await expect(page.getByTestId('toast')).toContainText('Découpage copié en Markdown');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('# DECOUPAGE DECOUPAGE-STUDIO v1');
  expect(text).toContain('## 1. INT. CHAMBRE ADMIRATRICE - JOUR');
  expect(text).toContain('| 1.1 | Admiratrice | Taille |');
});
