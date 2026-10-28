import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const REPLY = {
  shots: [
    { subject: 'Marc', value: 'Ensemble', angle: ['Dos', 'Hauteur regard'], movement: ['Fixe'], focal: 24, action: 'Marc attend sous la pluie.' },
    { subject: 'Marc', value: 'Gros plan', angle: ['3/4 Face', 'Hauteur regard'], movement: ['Trav avant'], focal: 85, action: 'Marc attend sous la pluie.' },
  ],
};

test('assistant désactivé sans clé, puis proposition insérée (API simulée)', async ({ page }) => {
  let body: { model?: string; output_config?: { format?: { type?: string } } } = {};
  await page.route('https://api.anthropic.com/**', async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(REPLY) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });
  });
  await page.goto('/#/settings?seed=fiction');
  await expect(page.getByTestId('assistant')).toBeDisabled();
  await page.goto('/#/settings');
  await page.getByLabel('Clé API Anthropic').fill('sk-ant-test-123');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Assistant actif')).toBeVisible();
  await page.goto('/#/grid');
  await page.locator('[data-cell="9:subject"]').click();
  await page.goto('/#/settings');
  await page.getByTestId('assistant').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Proposer' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: '2 plans proposés' })).toBeVisible();
  await page.goto('/#/grid');
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(13);
  expect(body.model).toBe('claude-opus-5-5');
  expect(body.output_config?.format?.type).toBe('json_schema');
  // La clé n'est jamais exportée.
  await page.goto('/#/export');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  expect(readFileSync(await (await dl).path(), 'utf8')).not.toContain('sk-ant-test-123');
});
