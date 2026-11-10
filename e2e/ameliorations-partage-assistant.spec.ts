import { expect, test, type Page } from '@playwright/test';

// --- Assistant (API Anthropic simulée) ---------------------------------------------------------

interface Body {
  model?: string;
  tools?: unknown[];
  messages?: Array<{ role: string; content: unknown }>;
}
type Reply = { status?: number; text?: string; tool?: { name: string; input: unknown } };

const CORS = { 'access-control-allow-origin': '*' };
const PREFLIGHT = { status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' } };
const ROWS = '[data-testid="shot-row"]';
const go = (page: Page, hash: string) => page.evaluate((h) => void (location.hash = h), hash);

/** Une porte : la réponse simulée attend qu'on l'ouvre. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

/** Assistant réglé d'office ; `reply` donne la réponse de chaque requête du dialogue (n = 1, 2…). */
async function mockAssistant(page: Page, reply: (n: number, body: Body) => Reply | Promise<Reply>) {
  const bodies: Body[] = [];
  await page.addInitScript(() =>
    localStorage.setItem('ds-ai', JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-ant-test-123' }, models: { anthropic: 'claude-haiku-5-5' } })),
  );
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    if (req.method() === 'GET') return route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: [{ id: 'claude-haiku-5-5', type: 'model' }], has_more: false }) });
    const body = req.postDataJSON() as Body;
    const msg = (content: unknown[], stop: string) => ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: stop, stop_sequence: null, content, usage: { input_tokens: 1, output_tokens: 1 } });
    if (!body.tools) return route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify(msg([{ type: 'text', text: 'ok' }], 'end_turn')) });
    bodies.push(JSON.parse(JSON.stringify(body)) as Body);
    const r = await reply(bodies.length, body);
    if (r.status && r.status !== 200) {
      return route.fulfill({ status: r.status, contentType: 'application/json', headers: CORS, body: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }) });
    }
    const content: unknown[] = [];
    if (r.text) content.push({ type: 'text', text: r.text });
    if (r.tool) content.push({ type: 'tool_use', id: `toolu_${bodies.length}`, name: r.tool.name, input: r.tool.input });
    // Requête abandonnée entre-temps (nouvelle conversation) : plus personne n'attend la réponse.
    await route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify(msg(content, r.tool ? 'tool_use' : 'end_turn')) }).catch(() => undefined);
  });
  return bodies;
}

const userMessages = (b: Body) => (b.messages ?? []).filter((m) => m.role === 'user' && typeof m.content === 'string');

async function openPanel(page: Page) {
  await page.getByTestId('assistant-toggle').click();
  return page.getByTestId('assistant-panel');
}

test('assistant : Entrée pendant une réponse garde le brouillon ; la page est nommée en français', async ({ page }) => {
  const g = gate();
  const bodies = await mockAssistant(page, async (n) => {
    if (n === 1) await g.wait;
    return { text: n === 1 ? 'Bonjour.' : 'Entendu.' };
  });
  await page.goto('/#/calendar?seed=fiction');
  const panel = await openPanel(page);
  const input = panel.getByTestId('assistant-input');
  await input.fill('Bonjour');
  await input.press('Enter');
  await expect(panel.getByLabel('Réponse en cours')).toBeVisible();
  await input.fill('Ajoute un insert');
  await input.press('Enter');
  await expect(input).toHaveValue('Ajoute un insert');
  await expect(panel.getByTestId('assistant-user')).toHaveCount(1);
  g.open();
  await expect(panel.getByTestId('assistant-assistant')).toHaveText('Bonjour.');
  expect(String(userMessages(bodies[0])[0].content)).toMatch(/^\[Contexte — page : Calendrier\]/);
  await input.press('Enter');
  await expect(panel.getByTestId('assistant-user')).toHaveCount(2);
  await expect(input).toHaveValue('');
  await expect(panel.getByTestId('assistant-assistant').last()).toHaveText('Entendu.');
});

test('assistant : après une erreur, « Réessayer » renvoie la demande sans doublon', async ({ page }) => {
  // Le SDK réessaie de lui-même : la limite tient jusqu'au clic.
  let limited = true;
  const bodies = await mockAssistant(page, () => (limited ? { status: 429 } : { text: 'Voici.' }));
  await page.goto('/#/grid?seed=fiction');
  const panel = await openPanel(page);
  await panel.getByTestId('assistant-input').fill('Résume la séquence 1');
  await panel.getByTestId('assistant-input').press('Enter');
  await expect(panel.getByTestId('assistant-error')).toContainText('Limite de requêtes');
  await expect(panel.getByTestId('assistant-user')).toHaveCount(1);
  limited = false;
  const n = bodies.length;
  await panel.getByTestId('assistant-retry').click();
  await expect(panel.getByTestId('assistant-assistant')).toHaveText('Voici.');
  await expect(panel.getByTestId('assistant-error')).toHaveCount(0);
  await expect(panel.getByTestId('assistant-user')).toHaveCount(1);
  expect(bodies).toHaveLength(n + 1);
  expect(userMessages(bodies[n])).toHaveLength(1);
  expect(bodies[n].messages).toHaveLength(1);
});

test('assistant : un plan supprimé pendant la réponse, les ajouts sont rejoués sans erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const g = gate();
  await mockAssistant(page, async (n) => {
    if (n === 1) {
      await g.wait;
      return { tool: { name: 'add_shots', input: { sequence: 3, shots: [{ subject: 'Marc', value: 'Gros plan' }, { subject: 'Léa', value: 'Ensemble' }] } } };
    }
    return { text: 'Deux plans ajoutés.' };
  });
  await page.goto('/#/grid?seed=fiction');
  const rows = page.locator(ROWS);
  await expect(rows).toHaveCount(11);
  const panel = await openPanel(page);
  await panel.getByTestId('assistant-input').fill('Ajoute deux plans à la séquence 3');
  await panel.getByTestId('assistant-input').press('Enter');
  await expect(panel.getByLabel('Réponse en cours')).toBeVisible();
  await rows.first().hover();
  await rows.first().getByTestId('delete-shot').click();
  await expect(rows).toHaveCount(10);
  g.open();
  await expect(panel.getByTestId('assistant-assistant')).toContainText('Deux plans ajoutés.');
  await expect(rows).toHaveCount(12);
  await expect(panel.getByLabel('Réponse en cours')).toHaveCount(0);
  await expect(panel.getByText('2 plans ajoutés à la séquence 3')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __ds: { invariants: () => string[] } }).__ds.invariants())).toEqual([]);
  expect(errors).toEqual([]);
});

test('assistant : un autre projet ouvert, la conversation repart de zéro et rien n’y est versé', async ({ page }) => {
  const g = gate();
  const bodies = await mockAssistant(page, async (n) => {
    if (n === 1) {
      await g.wait;
      return { tool: { name: 'add_sequence', input: { label: 'Séquence de l’IA' } } };
    }
    return { text: 'Fait.' };
  });
  // Deux projets dans le navigateur : RAV3, puis la fiction.
  await page.goto('/#/grid?seed=rav3');
  await expect(page.locator(ROWS)).toHaveCount(53);
  await page.goto('/#/grid?seed=fiction');
  await page.reload();
  await expect(page.locator(ROWS)).toHaveCount(11);
  const panel = await openPanel(page);
  await panel.getByTestId('assistant-input').fill('Ajoute une séquence');
  await panel.getByTestId('assistant-input').press('Enter');
  await expect(panel.getByLabel('Réponse en cours')).toBeVisible();
  await go(page, '#/home');
  await page.getByTestId('project-list').getByRole('button', { name: /^\d+ .*RAV3/ }).click();
  await go(page, '#/grid');
  await expect(page.locator(ROWS)).toHaveCount(53);
  const seqCount = () => page.evaluate(() => (window as unknown as { __ds: { doc: () => { project: { title: string; sequenceIds: string[] } } } }).__ds.doc().project);
  const before = await seqCount();
  expect(before.title).toBe('RAV3');
  g.open();
  await expect.poll(() => bodies.length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  expect((await seqCount()).sequenceIds).toHaveLength(before.sequenceIds.length);
  if (!(await panel.isVisible())) await page.getByTestId('assistant-toggle').click();
  await expect(panel.getByTestId('assistant-user')).toHaveCount(0);
  await expect(panel.getByLabel('Réponse en cours')).toHaveCount(0);
  // La demande suivante ne porte que son propre message.
  const n = bodies.length;
  await panel.getByTestId('assistant-input').fill('Bonjour');
  await panel.getByTestId('assistant-input').press('Enter');
  await expect(panel.getByTestId('assistant-assistant')).toHaveText('Fait.');
  expect(bodies[n].messages).toHaveLength(1);
});
