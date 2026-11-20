import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

test.describe.configure({ mode: 'serial' });

let srv: ChildProcess | null = null;
let buf = '';
const waiters = new Map<number, (m: { result: { content: { text: string }[]; isError?: boolean } }) => void>();
let n = 0;
const rpc = (method: string, params: unknown) =>
  new Promise<{ result: { content: { text: string }[]; isError?: boolean } }>((r) => {
    const id = ++n;
    waiters.set(id, r);
    srv!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

test.afterAll(() => srv?.kill());

test('Claude Desktop : l’extension se télécharge, lit le projet et n’écrit que si on l’autorise', async ({ page, request }) => {
  // L'extension servie par le site : une archive avec son manifeste et son serveur.
  const res = await request.get('decoupage-studio.mcpb');
  expect(res.ok()).toBe(true);
  const zip = await JSZip.loadAsync(await res.body());
  expect(JSON.parse(await zip.file('manifest.json')!.async('string'))).toMatchObject({ name: 'decoupage-studio', server: { type: 'node', entry_point: 'server/index.js' } });
  const dir = mkdtempSync(join(tmpdir(), 'mcpb-'));
  writeFileSync(join(dir, 'index.js'), await zip.file('server/index.js')!.async('nodebuffer'));
  srv = spawn('node', [join(dir, 'index.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
  srv.stdout!.on('data', (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiters.get(m.id)?.(m);
    }
  });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

  // Accès réglé dans Paramètres › Assistant IA.
  await page.goto('/#/settings?seed=fiction&section=assistant');
  const box = page.getByTestId('claude-desktop');
  await expect(box.getByTestId('mcpb-download')).toBeVisible();
  await box.getByText('Lecture', { exact: true }).click();
  await expect(box).toContainText('Connecté');
  const read = await rpc('tools/call', { name: 'get_project', arguments: {} });
  expect(read.result.isError).toBeFalsy();
  expect(read.result.content[0].text).toContain('La Consigne');
  const refused = await rpc('tools/call', { name: 'add_shots', arguments: { sequence: 1, shots: [{ subject: 'MCP' }] } });
  expect(refused.result.isError).toBe(true);

  await box.getByText('Écriture', { exact: true }).click();
  const wrote = await rpc('tools/call', { name: 'add_shots', arguments: { sequence: 1, shots: [{ subject: 'Depuis Claude' }] } });
  expect(wrote.result.isError).toBeFalsy();
  await page.evaluate(() => void (location.hash = '#/grid'));
  await expect(page.getByText('Depuis Claude')).toBeVisible();
  // Une modification de l'IA s'annule comme une autre.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByText('Depuis Claude')).toHaveCount(0);
  await page.evaluate(() => void (location.hash = '#/settings?section=assistant'));
  await page.getByTestId('claude-desktop').getByText('Aucun', { exact: true }).click();
});
