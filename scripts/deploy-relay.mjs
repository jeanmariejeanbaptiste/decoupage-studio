// Déploie le relais du partage sur Cloudflare (API directe, sans wrangler).
// Le jeton est ajouté par le réseau de la session (ou CLOUDFLARE_API_TOKEN ailleurs).
import { readFileSync } from 'node:fs';
const API = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_API_TOKEN;
const headers = token && token !== 'proxy-injected' ? { authorization: `Bearer ${token}` } : {};
const j = async (r) => {
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.errors));
  return d.result;
};
const account = (await j(await fetch(`${API}/accounts`, { headers })))[0].id;
const name = 'share';
const form = new FormData();
form.append(
  'metadata',
  new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-11-01', bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' }], migrations: { new_tag: 'v1', new_sqlite_classes: ['Room'] } })], { type: 'application/json' }),
);
form.append('worker.js', new Blob([readFileSync(new URL('../server/relay/worker.js', import.meta.url))], { type: 'application/javascript+module' }), 'worker.js');
await j(await fetch(`${API}/accounts/${account}/workers/scripts/${name}`, { method: 'PUT', headers, body: form }));
await j(await fetch(`${API}/accounts/${account}/workers/scripts/${name}/subdomain`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) }));
const sub = (await j(await fetch(`${API}/accounts/${account}/workers/subdomain`, { headers }))).subdomain;
console.log(`https://${name}.${sub}.workers.dev`);
