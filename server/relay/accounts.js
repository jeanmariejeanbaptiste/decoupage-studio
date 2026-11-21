/**
 * Comptes et sauvegarde en ligne de Découpage Studio, sans Google.
 *
 * - `Accounts` (une seule instance) : adresses, mots de passe (PBKDF2), sessions (jeton haché).
 * - `Vault` (une instance par compte) : fichiers du compte, rangés comme dans le Drive (nom,
 *   propriétés, contenu par morceaux d'un Mo). Le navigateur garde toute la logique de synchronisation.
 *
 * API (JSON, jeton en `Authorization: Bearer`) :
 *   POST /auth/signup {email,password} · POST /auth/login {email,password} → { token, email }
 *   POST /auth/logout · GET /auth/me
 *   GET /files · POST /files (en-tête x-meta, corps = contenu) · PATCH|GET|DELETE /files/<id>
 */
const ITER = 100000;
const SESSION_DAYS = 90;
const CHUNK = 1 << 20;
const QUOTA = 1 << 30;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const fail = (message, status) => json({ error: message }, status);

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITER }, key, 256));
}
const same = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export class Accounts {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, id TEXT, salt TEXT, hash TEXT, fails INT DEFAULT 0, locked INT DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (h TEXT PRIMARY KEY, uid TEXT, email TEXT, until INT)`);
  }

  async open(email, uid) {
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec('INSERT INTO sessions VALUES (?, ?, ?, ?)', await sha(token), uid, email, Date.now() + SESSION_DAYS * 864e5);
    this.sql.exec('DELETE FROM sessions WHERE until < ?', Date.now());
    return json({ token, email });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/check' || path === '/logout') {
      const h = await sha(request.headers.get('x-token') ?? '');
      const s = this.sql.exec('SELECT uid, email, until FROM sessions WHERE h = ?', h).toArray()[0];
      if (path === '/logout') {
        this.sql.exec('DELETE FROM sessions WHERE h = ?', h);
        return json({ ok: true });
      }
      if (!s || s.until < Date.now()) return fail('Session expirée : reconnectez-vous.', 401);
      return json({ uid: s.uid, email: s.email });
    }
    const { email: raw, password } = await request.json().catch(() => ({}));
    const email = String(raw ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail('Adresse e-mail invalide.', 400);
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return fail('Le mot de passe doit compter au moins 8 caractères.', 400);
    const user = this.sql.exec('SELECT * FROM users WHERE email = ?', email).toArray()[0];
    if (path === '/signup') {
      if (user) return fail('Un compte existe déjà pour cette adresse.', 409);
      const id = crypto.randomUUID();
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      this.sql.exec('INSERT INTO users (email, id, salt, hash) VALUES (?, ?, ?, ?)', email, id, salt, await hashPassword(password, salt));
      return this.open(email, id);
    }
    if (path === '/login') {
      if (!user) return fail('Adresse ou mot de passe incorrect.', 401);
      if (user.locked > Date.now()) return fail('Trop d’essais : réessayez dans quelques minutes.', 429);
      if (!same(await hashPassword(password, user.salt), user.hash)) {
        const fails = user.fails + 1;
        this.sql.exec('UPDATE users SET fails = ?, locked = ? WHERE email = ?', fails >= 5 ? 0 : fails, fails >= 5 ? Date.now() + 15 * 60e3 : 0, email);
        return fail('Adresse ou mot de passe incorrect.', 401);
      }
      this.sql.exec('UPDATE users SET fails = 0, locked = 0 WHERE email = ?', email);
      return this.open(email, user.id);
    }
    return fail('Introuvable', 404);
  }
}

export class Vault {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, ap TEXT, type TEXT, size INT);
      CREATE TABLE IF NOT EXISTS chunks (id TEXT, n INT, data BLOB, PRIMARY KEY (id, n))`);
  }

  async write(id, request) {
    const body = new Uint8Array(await request.arrayBuffer());
    const used = this.sql.exec('SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE id != ?', id).one().s;
    if (used + body.length > QUOTA) return fail('Espace en ligne plein (1 Go).', 413);
    this.sql.exec('DELETE FROM chunks WHERE id = ?', id);
    for (let n = 0; n * CHUNK < body.length || n === 0; n++) this.sql.exec('INSERT INTO chunks VALUES (?, ?, ?)', id, n, body.subarray(n * CHUNK, (n + 1) * CHUNK));
    return body.length;
  }

  async fetch(request) {
    const m = new URL(request.url).pathname.match(/^\/files(?:\/([\w-]{1,64}))?$/);
    if (!m) return fail('Introuvable', 404);
    const id = m[1];
    const meta = () => {
      try {
        return JSON.parse(decodeURIComponent(request.headers.get('x-meta') ?? '%7B%7D'));
      } catch {
        return {};
      }
    };
    if (!id && request.method === 'GET')
      return json({ files: this.sql.exec('SELECT id, name, ap FROM files').toArray().map((f) => ({ id: f.id, name: f.name, appProperties: JSON.parse(f.ap) })) });
    if (!id && request.method === 'POST') {
      const fid = crypto.randomUUID();
      const size = await this.write(fid, request);
      if (size instanceof Response) return size;
      const md = meta();
      this.sql.exec('INSERT INTO files VALUES (?, ?, ?, ?, ?)', fid, String(md.name ?? ''), JSON.stringify(md.appProperties ?? {}), request.headers.get('content-type') ?? '', size);
      return json({ id: fid });
    }
    const file = id && this.sql.exec('SELECT * FROM files WHERE id = ?', id).toArray()[0];
    if (!file) return fail('Fichier introuvable.', 404);
    if (request.method === 'GET') {
      const parts = this.sql.exec('SELECT data FROM chunks WHERE id = ? ORDER BY n', id).toArray().map((r) => new Uint8Array(r.data));
      return new Response(new Blob(parts), { headers: { 'content-type': file.type || 'application/octet-stream' } });
    }
    if (request.method === 'DELETE') {
      this.sql.exec('DELETE FROM chunks WHERE id = ?', id);
      this.sql.exec('DELETE FROM files WHERE id = ?', id);
      return json({ ok: true });
    }
    if (request.method === 'PATCH') {
      const size = await this.write(id, request);
      if (size instanceof Response) return size;
      const md = meta();
      const ap = { ...JSON.parse(file.ap), ...(md.appProperties ?? {}) };
      this.sql.exec('UPDATE files SET name = ?, ap = ?, type = ?, size = ? WHERE id = ?', String(md.name ?? file.name), JSON.stringify(ap), request.headers.get('content-type') ?? file.type, size, id);
      return json({ id });
    }
    return fail('Méthode non prise en charge.', 405);
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-meta',
  'access-control-max-age': '86400',
};
const cors = (res) => {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
};

/** Requêtes `/auth/…` et `/files…` ; `null` pour le reste (relais du partage). */
export async function accountsFetch(request, env) {
  const url = new URL(request.url);
  if (!/^\/(auth|files)(\/|$)/.test(url.pathname)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'));
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const inner = (path, init) => accounts.fetch(new Request(`https://a${path}`, init));
  const auth = url.pathname.match(/^\/auth\/(signup|login|logout|me)$/);
  if (auth) {
    const [, op] = auth;
    if (op === 'signup' || op === 'login') return cors(await inner(`/${op}`, { method: 'POST', body: await request.text() }));
    if (op === 'logout') return cors(await inner('/logout', { method: 'POST', headers: { 'x-token': token } }));
    const me = await inner('/check', { headers: { 'x-token': token } });
    return cors(me.ok ? json({ email: (await me.json()).email }) : me);
  }
  if (url.pathname.startsWith('/auth')) return cors(fail('Introuvable', 404));
  const who = await inner('/check', { headers: { 'x-token': token } });
  if (!who.ok) return cors(who);
  const { uid } = await who.json();
  const vault = env.VAULTS.get(env.VAULTS.idFromName(uid));
  return cors(await vault.fetch(new Request(`https://v${url.pathname}`, { method: request.method, headers: request.headers, body: ['GET', 'DELETE'].includes(request.method) ? null : request.body })));
}
