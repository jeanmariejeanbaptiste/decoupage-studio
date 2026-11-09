import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

interface Body {
  model?: string;
  tools?: Array<{ name: string }>;
  messages?: Array<{ role: string; content: unknown }>;
}

const SHOTS = [
  { subject: 'Marc', value: 'Ensemble', angle: ['Dos', 'Hauteur regard'], movement: ['Fixe'], focal: 24, action: 'Marc attend sous la pluie.' },
  { subject: 'Marc', value: 'Gros plan', angle: ['3/4 Face', 'Hauteur regard'], movement: ['Trav avant'], focal: 85, link_with_previous: true },
];

const CORS = { 'access-control-allow-origin': '*' };
const PREFLIGHT = { status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' } };

const go = (page: Page, hash: string) => page.evaluate((h) => void (location.hash = h), hash);

test('assistant : réglé dans les paramètres, il apparaît en haut à droite et ajoute des plans en un seul pas d’annulation (API simulée)', async ({ page }) => {
  const bodies: Body[] = [];
  const probes: Body[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    // Vérification de la clé : liste des modèles, puis un essai sans outils de chacun.
    if (route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({ data: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: null, last_id: null }),
      });
    }
    const body = route.request().postDataJSON() as Body;
    if (!body.tools) {
      probes.push(body);
      return route.fulfill({
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({ id: 'msg_probe', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 1 } }),
      });
    }
    bodies.push(body);
    const first = bodies.length === 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({
        id: `msg_${bodies.length}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        stop_reason: first ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        content: first
          ? [
              { type: 'text', text: 'J’ajoute deux plans à la séquence 3.' },
              { type: 'tool_use', id: 'toolu_1', name: 'add_shots', input: { sequence: 3, shots: SHOTS } },
            ]
          : [{ type: 'text', text: 'Deux plans ajoutés : un ensemble de dos, puis un gros plan.' }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });
  });

  await page.goto('/#/settings?seed=fiction&section=assistant');
  const toggle = page.getByTestId('assistant-toggle');
  // Pas réglé : rien en haut à droite.
  await expect(toggle).toHaveCount(0);
  const form = page.getByTestId('ai-settings');
  await form.getByLabel('Clé API Anthropic').fill('sk-ant-test-123');
  // La clé est essayée sur chaque modèle ; le plus rapide de ceux qui répondent est choisi.
  await expect(form.getByTestId('ai-probe')).toHaveText('Connecté · 3 modèles disponibles');
  await expect(form.getByLabel('Modèle')).toHaveValue('claude-haiku-5-5');
  expect(probes.map((b) => b.model).sort()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  await expect(toggle).toHaveCount(0);
  await page.getByTestId('settings-save').click();
  await expect(toggle).toBeVisible();

  await go(page, '#/grid');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows).toHaveCount(11);
  await toggle.click();
  const panel = page.getByTestId('assistant-panel');
  // Le panneau ne porte que la conversation.
  await expect(panel.getByTestId('ai-settings')).toHaveCount(0);
  await panel.getByTestId('assistant-input').fill('Ajoute deux plans de Marc à la séquence 3');
  await panel.getByTestId('assistant-input').press('Enter');
  await expect(panel.getByTestId('assistant-assistant')).toContainText('Deux plans ajoutés');
  await expect(rows).toHaveCount(13);
  await expect(panel.getByText('2 plans ajoutés à la séquence 3', { exact: false })).toBeVisible();

  expect(bodies).toHaveLength(2);
  expect(bodies[0].model).toBe('claude-haiku-5-5');
  expect(bodies[0].tools?.map((t) => t.name)).toContain('add_shots');
  // Le résultat de l'outil revient au modèle, sous la réponse complète du tour précédent.
  const last = bodies[1].messages!.at(-1)!;
  expect(last.role).toBe('user');
  expect(JSON.stringify(last.content)).toContain('toolu_1');
  expect(JSON.stringify(bodies[1].messages!.at(-2)!.content)).toContain('tool_use');

  // Toutes les modifications d'un tour s'annulent d'un coup.
  await panel.getByTestId('assistant-undo').click();
  await expect(rows).toHaveCount(11);

  // Au lancement suivant, le bouton revient d'office ; seul le modèle retenu est réessayé.
  const before = probes.length;
  await page.reload();
  await expect(toggle).toBeVisible();
  await expect.poll(() => probes.slice(before).map((b) => b.model)).toEqual(['claude-haiku-5-5']);

  // La clé n'est jamais exportée.
  await go(page, '#/export');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  expect(readFileSync(await (await dl).path(), 'utf8')).not.toContain('sk-ant-test-123');
});

test('assistant : clé refusée, message clair et pas de bouton en haut à droite', async ({ page }) => {
  let calls = 0;
  await page.route('https://api.anthropic.com/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    calls++;
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    });
  });
  // Clé déjà enregistrée : essayée sans bruit au lancement.
  await page.addInitScript(() => localStorage.setItem('ds-ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-ant-fausse-cle' }, models: {} })));
  await page.goto('/#/grid?seed=fiction');
  await expect.poll(() => calls).toBeGreaterThan(0);
  const toggle = page.getByTestId('assistant-toggle');
  await expect(toggle).toHaveCount(0);

  await go(page, '#/settings?section=assistant');
  const form = page.getByTestId('ai-settings');
  await form.getByLabel('Clé API Anthropic').fill('sk-ant-autre-fausse-cle');
  await expect(form.getByTestId('ai-probe')).toHaveText('Clé API refusée.');
  await expect(form.getByLabel('Modèle')).toHaveCount(0);
  await page.getByTestId('settings-save').click();
  await expect(toggle).toHaveCount(0);
});

test('assistant : seuls les modèles qui répondent sont proposés, gratuits et payants séparés (OpenRouter simulé)', async ({ page }) => {
  const models = [
    { id: 'google/gemini-2.5-flash:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    { id: 'meta-llama/llama-4-maverick:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
    { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.000001', completion: '0.000005' }, supported_parameters: ['tools'] },
    { id: 'openai/gpt-5-mini', pricing: { prompt: '0.0000003', completion: '0.000002' }, supported_parameters: ['tools'] },
  ];
  await page.route('https://openrouter.ai/api/v1/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    if (req.method() === 'GET') return route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: models }) });
    // Un modèle gratuit saturé ne répond pas : il n'est pas proposé.
    const { model } = req.postDataJSON() as Body;
    if (model === 'meta-llama/llama-4-maverick:free') return route.fulfill({ status: 429, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error: { message: 'Rate limited' } }) });
    return route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) });
  });

  await page.goto('/#/settings?seed=fiction&section=assistant');
  const form = page.getByTestId('ai-settings');
  await form.getByLabel('Fournisseur').selectOption('openrouter');
  await form.getByLabel('Clé API OpenRouter').fill('sk-or-test-1234567890');
  await expect(form.getByTestId('ai-probe')).toHaveText('Connecté · 3 modèles disponibles');
  const select = form.getByLabel('Modèle');
  await expect(select.locator('optgroup[label="Gratuits"] option')).toHaveText(['google/gemini-2.5-flash:free']);
  await expect(select.locator('optgroup[label="Payants"] option')).toHaveText(['anthropic/claude-haiku-5.5', 'openai/gpt-5-mini']);
  // Le meilleur gratuit est retenu d'office.
  await expect(select).toHaveValue('google/gemini-2.5-flash:free');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('assistant-toggle')).toBeVisible();
});
