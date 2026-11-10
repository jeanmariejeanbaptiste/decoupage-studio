import { expect, test, type Browser, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

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

// --- Commentaires (auteur, sans partage) -------------------------------------------------------

test('commentaires : planche à dessin au-dessus de la bulle, Échap referme planche et fenêtre, cellule désignée', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByTestId('toggle-print').click();
  const cell = page.locator('tr[data-shot] td[data-col="value"]').first();
  await cell.click();
  const pop = page.getByTestId('comment-popover');
  await expect(pop).toBeVisible();
  // La cellule commentée reste désignée, une seule.
  await expect(page.locator('[data-comment-active]')).toHaveCount(1);
  expect(await cell.getAttribute('data-comment-active')).toBe('');
  await page.getByTestId('comment-text').fill('Un plan plus serré');
  await page.getByTestId('comment-sketch').click();
  const pad = page.getByTestId('sketch-pad');
  await expect(pad).toBeVisible();
  await expect(pop).toBeHidden();
  // Un clic sur le fond referme la planche : la bulle revient avec son brouillon.
  await page.mouse.click(5, 300);
  await expect(pad).toHaveCount(0);
  await expect(page.getByTestId('comment-text')).toHaveValue('Un plan plus serré');
  // Échap referme la planche seule.
  await page.getByTestId('comment-sketch').click();
  await expect(pad).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pad).toHaveCount(0);
  await expect(page.getByTestId('comment-text')).toHaveValue('Un plan plus serré');
  await page.getByTestId('comment-send').click();
  // Signé « Réalisation » quand le projet n'a pas de réalisateur, jamais « Moi ».
  await expect(pop.getByTestId('comment')).toContainText('Réalisation');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(page.locator('[data-comment-active]')).toHaveCount(0);
  await expect(page.locator('td[data-commented]')).toHaveCount(1);
  // La fenêtre des commentaires se ferme à Échap.
  await page.getByTestId('version-switcher').click();
  await page.getByTestId('version-comments').click();
  await expect(page.getByTestId('comments-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('comments-panel')).toHaveCount(0);
});

test('planche à dessin : un geste interrompu clôt le trait', async ({ page }) => {
  await page.goto('/#/grid?seed=rav3');
  await page.getByTestId('toggle-print').click();
  await page.locator('tr[data-shot] td[data-col="value"]').first().click();
  await page.getByTestId('comment-sketch').click();
  const canvas = page.getByTestId('sketch-pad').locator('canvas');
  await canvas.evaluate((c) => {
    // Pointeur simulé : la capture ne s'applique qu'aux vrais pointeurs actifs.
    c.setPointerCapture = () => undefined;
    const r = c.getBoundingClientRect();
    const ev = (type: string, x: number) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: r.left + x, clientY: r.top + 50 }));
    ev('pointerdown', 20);
    ev('pointermove', 60);
    ev('pointercancel', 60);
    ev('pointermove', 120);
    ev('pointerdown', 200);
    ev('pointermove', 260);
    ev('pointerup', 260);
  });
  // Deux traits distincts : deux annulations.
  const undo = page.getByRole('button', { name: 'Annuler le dernier trait' });
  await undo.click();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
});

// --- Partage en direct (serveur de mise en relation local) ------------------------------------

test.describe('partage', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  const PORT = 9189;
  let server: ReturnType<typeof PeerServer> | null = null;
  test.beforeAll(() => {
    server = PeerServer({ port: PORT, path: '/', host: '127.0.0.1' });
  });
  test.afterAll(() => {
    (server as unknown as { close?: () => void } | null)?.close?.();
  });

  async function participant(browser: Browser): Promise<Page> {
    const ctx = await browser.newContext();
    await ctx.addInitScript((port) => localStorage.setItem('ds-peer-server', `localhost:${port}`), PORT);
    return ctx.newPage();
  }

  async function host(browser: Browser, seed: string, mode?: string) {
    const page = await participant(browser);
    await page.goto(`/#/grid?seed=${seed}`);
    await page.getByTestId('share-button').click();
    if (mode) await page.getByTestId('share-panel').getByText(mode).click();
    await page.getByTestId('share-start').click();
    const link = (await page.getByTestId('share-link').textContent())!;
    const password = (await page.getByTestId('share-password').textContent())!;
    return { page, link, password };
  }

  async function join(page: Page, link: string, password: string, name: string) {
    await page.goto(link);
    await page.getByLabel('Votre nom').fill(name);
    await page.getByRole('textbox', { name: 'Mot de passe' }).fill(password);
    await page.getByTestId('join-go').click();
  }

  test('QR code : il reste ouvert quand un invité arrive, et porte le mot de passe', async ({ browser }) => {
    const h = await host(browser, 'rav3');
    expect(h.link).not.toContain('pw=');
    await h.page.getByTestId('share-qr').click();
    const screen = h.page.getByTestId('share-qr-screen');
    await expect(screen).toBeVisible();
    await expect(screen.locator('svg[role="img"]')).toHaveAttribute('aria-label', `QR code : ${h.link}&pw=${h.password}`);
    // Arrivée par le QR code : mot de passe rempli, puis retiré de l'adresse.
    const guest = await participant(browser);
    await guest.goto(`${h.link}&pw=${h.password}`);
    await expect(guest.getByLabel('Mot de passe')).toHaveValue(h.password);
    await expect.poll(() => guest.url()).not.toContain('pw=');
    await guest.getByLabel('Votre nom').fill('Nina');
    await guest.getByTestId('join-go').click();
    await expect(guest.getByTestId('guest-banner')).toBeVisible();
    await expect(h.page.getByTestId('share-button')).toContainText('· 1');
    await expect(screen).toBeVisible();
    await h.page.keyboard.press('Escape');
    await expect(screen).toHaveCount(0);
    await h.page.getByTestId('share-stop').click();
  });

  test('invités : homonymes distingués, exclusion durable, Échap referme le panneau, bandeau sans hôte anonyme', async ({ browser }) => {
    const h = await host(browser, 'rav3');
    const a = await participant(browser);
    await join(a, h.link, h.password, 'Nina');
    // RAV3 n'a pas de réalisateur : pas de « partagé par l'hôte ».
    await expect(a.getByTestId('guest-banner')).toContainText(/^Projet partagé · modification/);
    const b = await participant(browser);
    await join(b, h.link, h.password, 'Nina');
    await expect(b.getByTestId('guest-banner')).toBeVisible();
    const guests = h.page.getByTestId('share-guests');
    await expect(guests.locator('li')).toHaveText(['NNina', 'NNina 2']);
    // Le second est exclu : prévenu comme tel, et l'ancien mot de passe ne lui rouvre pas la porte.
    await h.page.getByRole('button', { name: 'Exclure Nina 2' }).click();
    await expect(b.getByTestId('home')).toBeVisible();
    await expect(b.getByText('Vous avez été retiré du partage.')).toBeVisible();
    const fresh = (await h.page.getByTestId('share-password').textContent())!;
    expect(fresh).not.toBe(h.password);
    await join(b, h.link, h.password, 'Nina');
    await expect(b.getByText('Mot de passe incorrect.')).toBeVisible();
    await b.getByRole('textbox', { name: 'Mot de passe' }).fill(fresh);
    await b.getByTestId('join-go').click();
    await expect(b.getByTestId('guest-banner')).toBeVisible();
    // La première Nina est restée connectée.
    await expect(a.getByTestId('guest-banner')).toBeVisible();
    await expect(guests.locator('li')).toHaveCount(2);
    // Échap referme le panneau et rend la main au bouton Partager.
    await h.page.getByRole('button', { name: 'Copier le lien' }).focus();
    await h.page.keyboard.press('Escape');
    await expect(h.page.getByTestId('share-panel')).toHaveCount(0);
    await expect(h.page.getByTestId('share-button')).toBeFocused();
    // Quitter la page avec des invités connectés : le navigateur demande confirmation.
    let asked = false;
    h.page.once('dialog', (d) => {
      asked = d.type() === 'beforeunload';
      void d.dismiss();
    });
    await h.page.evaluate(() => void window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
    const prevented = await h.page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented || asked).toBe(true);
    await h.page.getByTestId('share-button').click();
    await h.page.getByTestId('share-stop').click();
    const after = await h.page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(after).toBe(false);
  });

  test('l’hôte qui rejoint un autre partage ferme d’abord le sien', async ({ browser }) => {
    const a = await host(browser, 'rav3');
    const guestOfA = await participant(browser);
    await join(guestOfA, a.link, a.password, 'Paul');
    await expect(guestOfA.getByTestId('guest-banner')).toBeVisible();
    const c = await host(browser, 'fiction');
    await join(a.page, c.link, c.password, 'Alice');
    await expect(a.page.getByTestId('guest-banner')).toBeVisible();
    await expect(guestOfA.getByTestId('home')).toBeVisible();
    await expect(c.page.getByTestId('share-guests')).toContainText('Alice');
    await c.page.getByTestId('share-stop').click();
  });

  test('invité qui avait déjà ce projet : il le retrouve intact en quittant le partage', async ({ browser }) => {
    const guest = await participant(browser);
    // Le même projet (même identifiant), dans le navigateur de l'invité.
    await guest.goto('/#/grid?seed=fiction');
    await expect(guest.getByText('Enregistré dans le navigateur')).toBeVisible();
    const h = await host(browser, 'fiction');
    await join(guest, h.link, h.password, 'Nina');
    await expect(guest.getByTestId('guest-banner')).toBeVisible();
    await guest.getByTestId('guest-leave').click();
    await expect(guest.getByTestId('home')).toBeVisible();
    await expect(guest.getByTestId('project-list')).toContainText('La Consigne');
    await h.page.getByTestId('share-stop').click();
  });

  test('relecture : commentaires écrits en même temps par l’hôte et l’invité, aucun perdu', async ({ browser }) => {
    const h = await host(browser, 'fiction', 'Commenter');
    await h.page.getByTestId('share-button').click();
    const guest = await participant(browser);
    await join(guest, h.link, h.password, 'Nina');
    await expect(guest.getByTestId('guest-banner')).toContainText('relecture');
    await h.page.getByTestId('toggle-print').click();
    const write = async (p: Page, row: number, text: string) => {
      await p.locator('tr[data-shot] td[data-col="value"]').nth(row).click();
      await p.getByTestId('comment-text').fill(text);
    };
    await write(h.page, 0, 'De l’hôte');
    await write(guest, 3, 'De Nina');
    // Envoyés dans la même tranche de temps.
    await Promise.all([h.page.getByTestId('comment-send').click(), guest.getByTestId('comment-send').click()]);
    await h.page.keyboard.press('Escape');
    await guest.keyboard.press('Escape');
    await expect(h.page.locator('td[data-commented]')).toHaveCount(2);
    await expect(guest.locator('td[data-commented]')).toHaveCount(2);
    await h.page.getByTestId('share-button').click();
    await h.page.getByTestId('share-stop').click();
  });
});
