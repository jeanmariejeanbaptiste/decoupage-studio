import { expect, test } from '@playwright/test';
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

test('assistant : réglé dans son panneau, il ajoute des plans en un seul pas d’annulation (API simulée)', async ({ page }) => {
  const bodies: Body[] = [];
  const probes: Body[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' } });
    }
    // Vérification de la clé : liste des modèles, puis un essai sans outils.
    if (route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ data: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: null, last_id: null }),
      });
    }
    const body = route.request().postDataJSON() as Body;
    if (!body.tools) {
      probes.push(body);
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ id: 'msg_probe', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 1 } }),
      });
    }
    bodies.push(body);
    const first = bodies.length === 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
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

  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows).toHaveCount(11);
  await page.getByTestId('assistant-toggle').click();
  const panel = page.getByTestId('assistant-panel');
  // Sans clé : le panneau s'ouvre sur le choix du fournisseur.
  await panel.getByLabel('Clé API Anthropic').fill('sk-ant-test-123');
  // La clé est essayée, et le plus rapide des modèles qui répondent est choisi.
  await expect(panel.getByTestId('ai-probe')).toHaveText('Clé valide · claude-haiku-5-5 répond');
  await expect(panel.getByLabel('Modèle')).toHaveValue('claude-haiku-5-5');
  expect(probes.map((b) => b.model)).toEqual(['claude-haiku-5-5']);
  await panel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
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

  // La clé n'est jamais exportée.
  await page.goto('/#/export');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  expect(readFileSync(await (await dl).path(), 'utf8')).not.toContain('sk-ant-test-123');
});

test('assistant : clé refusée, message clair et rien de modifié', async ({ page }) => {
  await page.route('https://api.anthropic.com/**', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      : route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
        }),
  );
  await page.addInitScript(() => localStorage.setItem('ds-ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-ant-faux' }, models: {} })));
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('assistant-toggle').click();
  const panel = page.getByTestId('assistant-panel');
  await panel.getByTestId('assistant-input').fill('Ajoute un plan');
  await panel.getByTestId('assistant-send').click();
  await expect(panel.getByTestId('assistant-error')).toContainText('Clé API refusée');
  await expect(page.locator('[data-testid="shot-row"]')).toHaveCount(11);
});

test('raccourcis de l’assistant : dépouiller une scène, proposer le découpage d’une séquence (API simulée)', async ({ page }) => {
  // Fournisseur compatible OpenAI simulé : un appel d'outil, puis la réponse finale.
  await page.addInitScript(() => localStorage.setItem('ds-ai', JSON.stringify({ provider: 'custom', keys: {}, models: { custom: 'test' }, baseUrl: 'https://ia.test/v1' })));
  const prompts: string[] = [];
  let pending: { name: string; args: unknown } | null = null;
  await page.route('https://ia.test/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: unknown }> };
    const last = body.messages[body.messages.length - 1];
    const json = (content: string | null, calls?: unknown[]) => ({ choices: [{ message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] });
    let reply;
    if (last.role === 'user' && pending) {
      prompts.push(String(last.content));
      reply = json(null, [{ id: 'call_1', type: 'function', function: { name: pending.name, arguments: JSON.stringify(pending.args) } }]);
    } else reply = json('C’est fait.');
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply) });
  });

  await page.goto('/#/breakdown?seed=fiction');
  pending = { name: 'add_breakdown_items', args: { sequence: 1, category: 'accessoires', items: ['Horloge de gare'] } };
  await page.getByTestId('breakdown-ai').click();
  await expect(page.getByTestId('assistant-assistant').last()).toContainText('C’est fait.');
  expect(prompts[0]).toContain('Dépouillement de la séquence 1');
  await expect(page.getByLabel('Fiche de dépouillement')).toContainText('Horloge de gare');

  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator('[data-testid="shot-row"]');
  await expect(rows).toHaveCount(11);
  await page.locator('[data-cell="0:subject"]').click();
  pending = { name: 'add_shots', args: { sequence: 1, shots: [{ subject: 'Hall', value: 'Ensemble', action: 'Le hall bruisse.' }] } };
  await page.getByTestId('grid-ai').click();
  await expect(rows).toHaveCount(12);
  expect(prompts[1]).toContain('Découpage technique de la séquence 1');
});
