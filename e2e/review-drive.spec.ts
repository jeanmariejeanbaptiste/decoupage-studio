import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Relecture en ligne par Google Drive, avec un faux Google en mémoire : connexion (GIS), sélecteur
 * de fichiers (gapi / Picker) et API de Drive (fichiers, droits du lien, commentaires).
 */
test.describe.configure({ mode: 'serial' });

const CONFIG = JSON.stringify({ clientId: 'test-client.apps.googleusercontent.com', apiKey: 'test-api-key', appId: '123456789' });
const USERS: Record<string, string> = { 'tok-author': 'Réalisation', 'tok-nina': 'Nina Relectrice' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
const PREFLIGHT = { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' };

interface FakeFile {
  id: string;
  name: string;
  mime: string;
  body: Buffer;
  owner: string;
  rk?: string;
  perms: Array<{ id: string; type: string; role: string }>;
}
interface FakeComment {
  id: string;
  content: string;
  owner: string;
  createdTime: string;
  modifiedTime: string;
  deleted?: boolean;
}

/** Le faux Google : un état partagé par les deux navigateurs (auteur, relecteur). */
class FakeGoogle {
  files = new Map<string, FakeFile>();
  comments = new Map<string, FakeComment[]>();
  opened = new Set<string>();
  pickerShown = 0;
  seq = 0;
  next = (p: string) => `${p}${(++this.seq).toString().padStart(6, '0')}abc`;
  snapshotText(): string {
    const f = [...this.files.values()].find((x) => x.name.endsWith('.json') && x.name.startsWith('Découpage Studio — ') && x.mime === 'application/json' && !x.name.includes('tracés'));
    return f ? f.body.toString('utf8') : '';
  }
  snapshotId(): string {
    return [...this.files.values()].find((x) => x.name.startsWith('Découpage Studio — La Consigne'))?.id ?? '';
  }

  private canSee(f: FakeFile, token: string | undefined, key: string | null, rk: string | undefined): boolean {
    if (token && f.owner === token) return true;
    const anyone = f.perms.some((p) => p.type === 'anyone');
    if (!anyone) return false;
    if (key) return key === 'test-api-key' && (!f.rk || rk === `${f.id}/${f.rk}`);
    // Portée drive.file : un autre compte ne voit le fichier qu'après l'avoir ouvert avec le sélecteur.
    return !!token && this.opened.has(`${token}|${f.id}`);
  }

  async handle(route: Route): Promise<void> {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: PREFLIGHT });
    const url = new URL(req.url());
    const path = url.pathname;
    const token = req.headers().authorization?.replace(/^Bearer /, '');
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    const fail = (status: number, reason: string) => json(status, { error: { code: status, message: reason, errors: [{ reason }] } });
    if (token && !USERS[token]) return fail(401, 'authError');

    if (path === '/oauth2/v3/userinfo') return json(200, { email: `${token}@example.com`, name: USERS[token ?? ''] });
    if (path === '/__fake/pick') {
      const { fileId } = req.postDataJSON() as { fileId: string };
      this.pickerShown++;
      this.opened.add(`${token}|${fileId}`);
      return json(200, {});
    }
    // Création d'un fichier (multipart : métadonnées puis contenu).
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      if (!token) return fail(401, 'authError');
      const boundary = /boundary=([^;]+)/.exec(req.headers()['content-type'] ?? '')?.[1] ?? '';
      const raw = (req.postDataBuffer() ?? Buffer.alloc(0)).toString('latin1');
      const parts = raw.split(`--${boundary}`).slice(1, -1).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, -2));
      const meta = JSON.parse(Buffer.from(parts[0], 'latin1').toString('utf8')) as { name: string; mimeType: string };
      const id = this.next('file');
      const rk = meta.name.startsWith('Découpage Studio — La Consigne') ? `0-${this.next('rk')}` : undefined;
      this.files.set(id, { id, name: meta.name, mime: meta.mimeType, body: Buffer.from(parts[1], 'latin1'), owner: token, rk, perms: [] });
      return json(200, rk ? { id, resourceKey: rk } : { id });
    }
    let m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (m && method === 'PATCH') {
      const f = this.files.get(m[1]);
      if (!f) return fail(404, 'notFound');
      if (f.owner !== token) return fail(403, 'insufficientFilePermissions');
      f.body = req.postDataBuffer() ?? Buffer.alloc(0);
      return json(200, { id: f.id });
    }
    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (m && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const f = this.files.get(m[1]);
      if (!f || !this.canSee(f, token, token ? null : url.searchParams.get('key'), req.headers()['x-goog-drive-resource-keys'])) return fail(404, 'notFound');
      return route.fulfill({ status: 200, headers: CORS, contentType: f.mime, body: f.body });
    }
    m = /^\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/.exec(path);
    if (m) {
      const f = this.files.get(m[1]);
      if (!f || f.owner !== token) return fail(404, 'notFound');
      if (method === 'POST') {
        const p = req.postDataJSON() as { type: string; role: string };
        f.perms = f.perms.filter((x) => x.type !== p.type).concat({ id: 'anyoneWithLink', type: p.type, role: p.role });
        return json(200, { id: 'anyoneWithLink' });
      }
      if (method === 'GET') return json(200, { permissions: f.perms });
      if (method === 'DELETE') {
        f.perms = f.perms.filter((x) => x.id !== m![2]);
        return route.fulfill({ status: 204, headers: CORS });
      }
    }
    m = /^\/drive\/v3\/files\/([^/]+)\/comments(?:\/([^/]+))?$/.exec(path);
    if (m) {
      const f = this.files.get(m[1]);
      if (!f || !token || !this.canSee(f, token, null, undefined)) return fail(404, 'notFound');
      const list = this.comments.get(f.id) ?? [];
      this.comments.set(f.id, list);
      const out = (c: FakeComment) => ({ id: c.id, content: c.deleted ? '' : c.content, author: { displayName: USERS[c.owner], me: c.owner === token }, createdTime: c.createdTime, modifiedTime: c.modifiedTime, ...(c.deleted ? { deleted: true } : {}) });
      expect(url.searchParams.get('fields') ?? (method === 'DELETE' ? 'x' : ''), 'fields obligatoire').not.toBe('');
      if (!m[2] && method === 'POST') {
        if (f.owner !== token && !f.perms.some((p) => p.type === 'anyone' && p.role === 'commenter')) return fail(403, 'insufficientFilePermissions');
        const now = new Date(Date.now() + this.seq).toISOString();
        const c: FakeComment = { id: this.next('cmt'), content: (req.postDataJSON() as { content: string }).content, owner: token, createdTime: now, modifiedTime: now };
        list.push(c);
        return json(200, out(c));
      }
      if (!m[2] && method === 'GET') {
        expect(url.searchParams.get('includeDeleted')).toBe('true');
        // Pagination : deux commentaires par page, pour l'éprouver.
        const start = Number(url.searchParams.get('pageToken') ?? 0);
        const page = list.slice(start, start + 2);
        return json(200, { comments: page.map(out), ...(start + 2 < list.length ? { nextPageToken: String(start + 2) } : {}) });
      }
      const c = list.find((x) => x.id === m![2]);
      if (!c) return fail(404, 'notFound');
      if (c.owner !== token) return fail(403, 'insufficientFilePermissions');
      if (method === 'PATCH') {
        c.content = (req.postDataJSON() as { content: string }).content;
        c.modifiedTime = new Date().toISOString();
        return json(200, out(c));
      }
      if (method === 'DELETE') {
        c.deleted = true;
        return route.fulfill({ status: 204, headers: CORS });
      }
    }
    return fail(400, `route inconnue ${method} ${path}`);
  }
}

/** Google Identity Services : jeton accordé aussitôt, portées cumulées comme chez Google. */
const GIS = `(() => {
  const granted = () => (localStorage.getItem('fake-granted') || '').split(' ').filter(Boolean);
  window.google = window.google || {};
  window.google.accounts = { oauth2: {
    initTokenClient(c) { return { requestAccessToken(o) {
      const want = ((o && o.scope) || c.scope).split(' ');
      const all = [...new Set([...granted(), ...want])];
      localStorage.setItem('fake-granted', all.join(' '));
      window.__tokenRequests = (window.__tokenRequests || 0) + 1;
      setTimeout(() => c.callback({ access_token: window.__fakeToken, expires_in: 3600, scope: all.join(' ') }), 20);
    } }; },
    hasGrantedAllScopes(r, ...s) { return s.every((x) => (r.scope || '').split(' ').includes(x)); },
    revoke(t, d) { if (d) d(); },
  } };
})();`;

/** gapi + Picker : la sélection présélectionnée est validée d'office (le faux Drive ouvre le fichier à ce compte). */
const GAPI = `(() => {
  class DocsView { constructor(v) { this.v = v; } setFileIds(ids) { this.ids = ids; return this; } setMode() { return this; } }
  class PickerBuilder {
    setAppId(x) { this.app = x; return this; } setDeveloperKey(k) { this.key = k; return this; } setOAuthToken(t) { this.token = t; return this; }
    setLocale() { return this; } setTitle() { return this; } addView(v) { this.view = v; return this; } setCallback(cb) { this.cb = cb; return this; }
    build() { const b = this; return { setVisible(on) { if (!on) return;
      fetch('https://www.googleapis.com/__fake/pick', { method: 'POST', headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' }, body: JSON.stringify({ fileId: b.view.ids, appId: b.app, key: b.key }) })
        .then(() => b.cb({ action: 'picked', docs: [{ id: b.view.ids }] }));
    } }; }
  }
  window.gapi = { load(name, cb) {
    window.google = window.google || {};
    window.google.picker = { DocsView, PickerBuilder, ViewId: { DOCS: 'all' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' } };
    setTimeout(typeof cb === 'function' ? cb : cb.callback, 0);
  } };
})();`;

async function person(browser: Browser, fake: FakeGoogle, token: string, theme = 'papier'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([cfg, tok, th]) => {
      localStorage.setItem('ds-google-config', cfg);
      if (!localStorage.getItem('ds-theme')) localStorage.setItem('ds-theme', th);
      (window as unknown as { __fakeToken: string }).__fakeToken = tok;
    },
    [CONFIG, token, theme],
  );
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: GIS }));
  await ctx.route('https://apis.google.com/js/api.js', (r) => r.fulfill({ contentType: 'text/javascript', body: GAPI }));
  await ctx.route('https://www.googleapis.com/**', (r) => fake.handle(r));
  return { ctx, page: await ctx.newPage() };
}

const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

/** Projets enregistrés dans ce navigateur (le relecteur ne doit rien garder). */
const storedProjects = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((ok) => {
        const r = indexedDB.open('decoupage-studio');
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('projects')) return ok(0);
          const c = db.transaction('projects').objectStore('projects').count();
          c.onsuccess = () => ok(c.result);
        };
        r.onerror = () => ok(0);
      }),
  );

async function selectWord(page: Page, word: string) {
  await page.evaluate((w) => {
    const ed = document.querySelector('[data-testid="script-editor"]')!;
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      const sl = window.getSelection()!;
      sl.removeAllRanges();
      sl.addRange(r);
      return;
    }
  }, word);
}

/** L'auteur ouvre la démonstration, y met de quoi vérifier que rien de privé ne sort. */
async function authorWithSecrets(browser: Browser, fake: FakeGoogle, theme?: string) {
  const author = await person(browser, fake, 'tok-author', theme);
  const page = author.page;
  await page.goto('/#/scenario?seed=fiction');
  await page.getByTestId('scenario-tab-decors').click();
  await page.getByTestId('decor-row').first().click();
  await page.getByLabel('Adresse de tournage').fill('12 rue Secrète, Paris');
  await page.getByTestId('scenario-tab-characters').click();
  await page.getByTestId('character-row').filter({ hasText: 'LÉA' }).click();
  await page.getByLabel('Interprète').fill('Alice Martin');
  await page.getByLabel('Costume').click();
  // Plus de paramètre de démonstration dans l'adresse : un rechargement rouvre le projet enregistré.
  await page.evaluate(() => void (location.hash = '#/grid'));
  return author;
}

test('relecture en ligne : publier, lire sans compte, commenter (connexion, sélecteur), relever, répondre, republier en V2', async ({ browser }) => {
  test.setTimeout(150_000);
  const fake = new FakeGoogle();
  const { page: author } = await authorWithSecrets(browser, fake);

  // Publier V1 depuis le panneau Partager : connexion (drive.file) et fichier créé, ouvert par le lien.
  await author.getByTestId('share-button').click();
  const section = author.getByTestId('review-section');
  await expect(section).toContainText('Relecture en ligne');
  await expect(section.getByTestId('review-publish')).toHaveText('Publier V1');
  await section.getByTestId('review-publish').click();
  await expect(section.getByTestId('review-link')).toContainText('#/review/');
  await expect(section.getByTestId('review-state')).toContainText('V1 publiée le');
  await expect(section.getByTestId('review-publish')).toHaveText('Mettre à jour V1');
  const link = (await section.getByTestId('review-link').textContent())!;
  expect(link).toMatch(/#\/review\/file\w+~0-rk\w+$/);
  // Rien de privé dans le fichier publié.
  const published = fake.snapshotText();
  expect(published).toContain('decoupage-studio-review');
  expect(published).toContain('valise cabossée');
  for (const secret of ['12 rue Secrète', 'Alice Martin', 'Une gare, une valise, une décision', 'tok-author']) expect(published, secret).not.toContain(secret);
  expect(fake.files.get(fake.snapshotId())!.perms).toEqual([{ id: 'anyoneWithLink', type: 'anyone', role: 'commenter' }]);
  await author.keyboard.press('Escape');
  await author.getByTestId('share-button').click();

  // Le relecteur ouvre le lien, sans compte : le découpage en aperçu, seulement scénario et découpage.
  const { page: nina } = await person(browser, fake, 'tok-nina');
  await nina.goto(link);
  await expect(nina.getByTestId('guest-banner')).toContainText('relecture');
  await expect(nina.getByTestId('export-table').first()).toBeVisible();
  const nav = nina.getByRole('navigation');
  await expect(nav.getByRole('button', { name: /Scénario/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Plan de travail/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /Note d’intention|Note d'intention/ })).toHaveCount(0);
  await expect(nina.getByTestId('share-button')).toHaveCount(0);
  await expect(nina.getByTestId('account-signin')).toHaveCount(0);
  expect(await nina.evaluate(() => (window as unknown as { __tokenRequests?: number }).__tokenRequests ?? 0)).toBe(0);

  // Commenter une cellule : connexion Google au clic, sélecteur présélectionné (le fichier s'ouvre à ce compte), envoi.
  await nina.locator('tr[data-shot] td[data-col="value"]').first().click();
  await nina.getByTestId('comment-text').fill('Plutôt un plan large ici ?');
  await nina.getByTestId('comment-send').click();
  const pop = nina.getByTestId('comment-popover');
  await expect(pop.getByTestId('comment')).toContainText('Plutôt un plan large');
  await expect(pop.getByTestId('comment')).toContainText('Nina Relectrice');
  await expect(pop.getByText('Envoi…')).toHaveCount(0);
  await expect(pop.getByTestId('comment-unsent')).toHaveCount(0);
  expect(fake.pickerShown).toBe(1);
  const cmts = () => fake.comments.get(fake.snapshotId()) ?? [];
  expect(cmts()).toHaveLength(1);
  expect(cmts()[0].content).toMatch(/^Plutôt un plan large ici \?\n\nds:1 \{.*"kind":"shot".*"col":"value"/);
  await nina.keyboard.press('Escape');

  // Un passage du scénario.
  await nina.getByRole('navigation').getByRole('button', { name: /Scénario/ }).click();
  await expect(nina.getByTestId('script-editor')).toContainText('valise');
  await selectWord(nina, 'valise');
  await nina.getByTestId('comment-selection').click();
  await nina.getByTestId('comment-text').fill('Quelle valise ?');
  await nina.getByTestId('comment-send').click();
  await expect(nina.getByTestId('comment-popover').getByTestId('comment')).toContainText('Nina Relectrice');
  expect(cmts()).toHaveLength(2);
  expect(fake.pickerShown).toBe(1);
  // Corriger son commentaire : la correction part dans Drive.
  await nina.getByTestId('comment-popover').getByTestId('comment-edit').click();
  await nina.getByTestId('comment-edit-text').fill('Quelle valise ? On la voit avant ?');
  await nina.keyboard.press('Enter');
  await expect.poll(() => cmts()[1].content).toMatch(/^Quelle valise \? On la voit avant \?\n\nds:1 /);
  await nina.keyboard.press('Escape');

  // L'auteur relève les retours (retour sur la page) : le menu des versions les compte.
  await focus(author);
  await author.getByTestId('version-switcher').click();
  await expect(author.getByTestId('version-comments')).toContainText('2');
  await author.getByTestId('version-comments').click();
  const panel = author.getByTestId('comments-panel');
  await expect(panel.getByTestId('comment')).toHaveCount(2);
  await expect(panel).toContainText('Nina Relectrice');
  await expect(panel).toContainText('On la voit avant ?');
  // Idempotent : relever encore n'ajoute rien.
  await focus(author);
  await author.waitForTimeout(500);
  await expect(panel.getByTestId('comment')).toHaveCount(2);
  await panel.getByTestId('comment').filter({ hasText: 'plan large' }).getByTestId('comment-reply').fill('Oui, on change.');
  await author.keyboard.press('Enter');
  await expect(panel.getByTestId('comment-reply-item')).toContainText('Oui, on change.');
  await panel.getByRole('button', { name: 'Fermer' }).click();
  // La réponse part dans le fichier publié (au plus une fois toutes les 20 s), sans le texte en cours.
  await expect.poll(() => fake.snapshotText(), { timeout: 40_000 }).toContain('Oui, on change.');

  // Le relecteur recharge : la réponse est là.
  await nina.reload();
  await expect(nina.getByTestId('guest-banner')).toContainText('relecture');
  await nina.getByRole('navigation').getByRole('button', { name: /Découpage technique/ }).click();
  await nina.locator('td[data-commented]').first().click();
  await expect(nina.getByTestId('comment-popover')).toContainText('Oui, on change.');
  await nina.keyboard.press('Escape');

  // L'auteur crée V2 et la publie sur le même lien.
  await author.getByTestId('version-switcher').click();
  await author.getByTestId('version-new').click();
  await author.getByTestId('share-button').click();
  await expect(section.getByTestId('review-publish')).toHaveText('Publier V2');
  await section.getByTestId('review-publish').click();
  await expect(section.getByTestId('review-state')).toContainText('V2 publiée le');
  expect(await section.getByTestId('review-link').textContent()).toBe(link);
  await author.keyboard.press('Escape');

  // Le relecteur voit V2, et le commentaire de V1 repris à sa place.
  await focus(nina);
  await expect(nina.getByTestId('version-switcher')).toHaveText('V2');
  await nina.locator('td[data-commented]').first().click();
  const carried = nina.getByTestId('comment-popover').getByTestId('comment').filter({ hasText: 'plan large' });
  await expect(carried).toContainText('V1');
  await expect(carried).toContainText('Oui, on change.');

  // Jamais rien de privé, et rien d'enregistré chez le relecteur.
  const finalText = fake.snapshotText();
  for (const secret of ['12 rue Secrète', 'Alice Martin', 'Une gare, une valise, une décision']) expect(finalText, secret).not.toContain(secret);
  expect(await storedProjects(nina)).toBe(0);
  expect(await storedProjects(author)).toBe(1);
});

test('relecture en ligne : lien arrêté, puis repris', async ({ browser }) => {
  const fake = new FakeGoogle();
  const { page: author } = await authorWithSecrets(browser, fake);
  await author.getByTestId('share-button').click();
  const section = author.getByTestId('review-section');
  await section.getByTestId('review-publish').click();
  const link = (await section.getByTestId('review-link').textContent())!;
  await section.getByTestId('review-stop').click();
  await expect(section.getByTestId('review-state')).toContainText('lien arrêté');
  await expect(section.getByTestId('review-stop')).toHaveText('Reprendre');

  const { page: nina } = await person(browser, fake, 'tok-nina');
  await nina.goto(link);
  await expect(nina.getByTestId('review-landing')).toContainText('Cette relecture n’existe plus, ou son lien a été arrêté.');
  expect(await storedProjects(nina)).toBe(0);

  await section.getByTestId('review-stop').click();
  await expect(section.getByTestId('review-stop')).toHaveText('Arrêter');
  await nina.reload();
  await expect(nina.getByTestId('guest-banner')).toContainText('relecture');
});

test('sans réglage Google complet, la relecture en ligne n’apparaît pas', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ds-google-config', JSON.stringify({ clientId: 'x.apps.googleusercontent.com' })));
  await page.goto('/#/grid?seed=fiction');
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await expect(page.getByTestId('review-section')).toHaveCount(0);
  await page.goto('/#/review/abcdef123456');
  await expect(page.getByTestId('review-landing')).toContainText('La relecture en ligne n’est pas disponible ici.');
});

/** Captures des nouveaux écrans, dans les deux thèmes (REVIEW_SHOTS=<dossier>). */
test('captures de la relecture en ligne', async ({ browser }) => {
  const dir = process.env.REVIEW_SHOTS;
  test.skip(!dir, 'captures sur demande');
  test.setTimeout(120_000);
  mkdirSync(dir!, { recursive: true });
  for (const theme of ['papier', 'encre']) {
    const fake = new FakeGoogle();
    const { page: author } = await authorWithSecrets(browser, fake, theme);
    await author.getByTestId('share-button').click();
    await author.screenshot({ path: `${dir}/${theme}-1-partager-avant.png` });
    await author.getByTestId('review-section').getByTestId('review-publish').click();
    await expect(author.getByTestId('review-state')).toContainText('publiée');
    await author.screenshot({ path: `${dir}/${theme}-2-partager-publie.png` });
    const link = (await author.getByTestId('review-link').textContent())!;
    await author.keyboard.press('Escape');
    await author.getByTestId('share-button').click();

    const { page: nina } = await person(browser, fake, 'tok-nina', theme);
    await nina.route(`**/drive/v3/files/${fake.snapshotId()}?*`, async (r) => {
      // Arrivée ralentie, pour voir la page d'attente.
      await new Promise((ok) => setTimeout(ok, 1500));
      await fake.handle(r);
    });
    await nina.goto(link);
    await expect(nina.getByTestId('review-landing')).toBeVisible();
    await nina.screenshot({ path: `${dir}/${theme}-3-arrivee.png` });
    await expect(nina.getByTestId('export-table').first()).toBeVisible();
    await nina.locator('tr[data-shot] td[data-col="value"]').first().click();
    await nina.getByTestId('comment-text').fill('Plutôt un plan large ici ?');
    await nina.getByTestId('comment-send').click();
    await expect(nina.getByTestId('comment-popover').getByTestId('comment')).toContainText('Nina Relectrice');
    await nina.screenshot({ path: `${dir}/${theme}-4-relecteur-commentaire.png` });
    // Envoi manqué : Drive refuse.
    await nina.route('**/drive/v3/files/*/comments?*', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, headers: CORS, body: '{}' }) : fake.handle(r)));
    await nina.getByTestId('comment-popover').getByTestId('comment-reply').fill('Ou un ensemble.');
    await nina.keyboard.press('Enter');
    await expect(nina.getByTestId('comment-unsent')).toBeVisible();
    await nina.screenshot({ path: `${dir}/${theme}-5-relecteur-non-envoye.png` });
    await nina.keyboard.press('Escape');

    await focus(author);
    await author.getByTestId('version-switcher').click();
    await expect(author.getByTestId('version-comments')).toContainText('1');
    await author.getByTestId('version-comments').click();
    await expect(author.getByTestId('comments-panel')).toContainText('Nina Relectrice');
    await author.screenshot({ path: `${dir}/${theme}-6-auteur-retours.png` });

    const { page: lost } = await person(browser, fake, 'tok-nina', theme);
    await lost.goto('/#/review/inconnu123456');
    await expect(lost.getByTestId('review-landing')).toContainText('n’existe plus');
    await lost.screenshot({ path: `${dir}/${theme}-7-lien-mort.png` });
  }
});
