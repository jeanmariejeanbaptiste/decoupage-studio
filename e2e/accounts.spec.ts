import { expect, test, type BrowserContext } from '@playwright/test';

/** Faux serveur des comptes : mêmes routes que server/relay/accounts.js, en mémoire. */
function fakeServer() {
  const users = new Map<string, string>();
  const tokens = new Map<string, string>();
  const files = new Map<string, { name: string; appProperties: Record<string, string>; body: Buffer; type: string }>();
  let n = 0;
  const attach = (ctx: BrowserContext) =>
    ctx.route('https://share.decoupage-studio.workers.dev/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const send = (d: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(d), headers: { 'access-control-allow-origin': '*' } });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (path === '/auth/signup' || path === '/auth/login') {
        const { email, password } = req.postDataJSON() as { email: string; password: string };
        if (path === '/auth/signup') {
          if (users.has(email)) return send({ error: 'Un compte existe déjà pour cette adresse.' }, 409);
          users.set(email, password);
        } else if (users.get(email) !== password) return send({ error: 'Adresse ou mot de passe incorrect.' }, 401);
        const token = `t${++n}`;
        tokens.set(token, email);
        return send({ token, email });
      }
      if (!tokens.has((req.headers().authorization ?? '').replace('Bearer ', ''))) return send({ error: 'Session expirée : reconnectez-vous.' }, 401);
      const id = path.split('/')[2];
      const meta = () => JSON.parse(decodeURIComponent(req.headers()['x-meta'] ?? '%7B%7D')) as { name?: string; appProperties?: Record<string, string> };
      if (!id && req.method() === 'GET') return send({ files: [...files].map(([fid, f]) => ({ id: fid, name: f.name, appProperties: f.appProperties })) });
      if (!id && req.method() === 'POST') {
        const fid = `f${++n}`;
        files.set(fid, { name: meta().name ?? '', appProperties: meta().appProperties ?? {}, body: req.postDataBuffer() ?? Buffer.alloc(0), type: req.headers()['content-type'] ?? '' });
        return send({ id: fid });
      }
      const f = files.get(id);
      if (!f) return send({ error: 'Fichier introuvable.' }, 404);
      if (req.method() === 'GET') return route.fulfill({ body: f.body, contentType: f.type, headers: { 'access-control-allow-origin': '*' } });
      if (req.method() === 'DELETE') return files.delete(id), send({ ok: true });
      Object.assign(f, { body: req.postDataBuffer() ?? Buffer.alloc(0), appProperties: { ...f.appProperties, ...(meta().appProperties ?? {}) } });
      return send({ id });
    });
  return { attach, files };
}

test('compte propre à l’outil : création, synchronisation, autre appareil', async ({ browser }) => {
  const fake = fakeServer();
  const a = await browser.newContext();
  await fake.attach(a);
  const page = await a.newPage();
  await page.goto('/#/grid?seed=rav3');
  await expect(page.locator('[data-testid="shot-row"]').first()).toBeVisible();
  await page.goto('/#/');
  await page.getByTestId('account-signin').click();
  await page.getByTestId('account-mode').click();
  await page.getByTestId('account-email').fill('lea@exemple.fr');
  await page.getByTestId('account-password').fill('court');
  await page.getByTestId('account-submit').click();
  await expect(page.getByTestId('account-password')).toBeFocused();
  await page.getByTestId('account-password').fill('motdepasse1');
  await page.getByTestId('account-submit').click();
  await expect(page.getByTestId('account')).toBeVisible();
  await expect.poll(() => [...fake.files.values()].some((f) => f.appProperties.kind === 'project')).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await page.getByText('Nuit', { exact: true }).click();
    await page.getByTestId('account').click();
    await expect(page.getByRole('dialog', { name: 'Compte' })).toContainText('lea@exemple.fr');
    await page.screenshot({ path: `test-results/compte-${theme}.png` });
    await page.keyboard.press('Escape');
  }

  // Autre appareil : mauvais mot de passe refusé, puis le projet arrive.
  const b = await browser.newContext();
  await fake.attach(b);
  const other = await b.newPage();
  await other.goto('/#/');
  await other.getByTestId('account-signin').click();
  await other.getByTestId('account-email').fill('lea@exemple.fr');
  await other.getByTestId('account-password').fill('mauvais123');
  await other.getByTestId('account-submit').click();
  await expect(other.getByRole('alert')).toContainText('incorrect');
  await other.screenshot({ path: 'test-results/connexion-erreur.png' });
  await other.getByTestId('account-password').fill('motdepasse1');
  await other.getByTestId('account-submit').click();
  await expect(other.getByText(/Rav/i).first()).toBeVisible();
  await a.close();
  await b.close();
});
