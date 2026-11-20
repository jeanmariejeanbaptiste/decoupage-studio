/**
 * Serveur MCP local de Découpage Studio (extension Claude Desktop).
 *
 * Claude Desktop le lance et lui parle en JSON-RPC sur stdin / stdout. Il ouvre en retour un petit
 * serveur WebSocket sur 127.0.0.1 : l'onglet Découpage Studio ouvert dans le navigateur s'y connecte
 * (Paramètres › Assistant IA › Claude Desktop) et exécute les outils, dans la limite de l'accès choisi.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { AI_SYSTEM, AI_TOOLS } from '../src/domain/aiTools';

const PORT = 47613;
const log = (...a: unknown[]) => process.stderr.write(`[decoupage-studio] ${a.join(' ')}\n`);

let tab: WebSocket | null = null;
let access = 'off';
let seq = 0;
const pending = new Map<number, (r: { result: string; isError: boolean }) => void>();

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('error', (e) => log('WebSocket :', (e as Error).message));
wss.on('connection', (ws, req) => {
  // Seule une page de Découpage Studio (GitHub Pages ou serveur local) peut se brancher.
  const origin = String(req.headers.origin ?? '');
  if (origin && !/^https:\/\/[a-z0-9-]+\.github\.io$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    ws.close();
    return;
  }
  tab?.close();
  tab = ws;
  ws.on('message', (raw) => {
    let m: { type?: string; access?: string; id?: number; result?: string; isError?: boolean };
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === 'hello') access = m.access ?? 'off';
    else if (typeof m.id === 'number') {
      pending.get(m.id)?.({ result: m.result ?? '', isError: !!m.isError });
      pending.delete(m.id);
    }
  });
  ws.on('close', () => {
    if (tab === ws) {
      tab = null;
      access = 'off';
    }
  });
});

function call(tool: string, args: unknown): Promise<{ result: string; isError: boolean }> {
  if (!tab || tab.readyState !== tab.OPEN)
    return Promise.resolve({ result: 'Découpage Studio n’est pas connecté : ouvrez l’outil dans le navigateur et, dans Paramètres › Assistant IA › Claude Desktop, choisissez Lecture ou Écriture.', isError: true });
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    tab!.send(JSON.stringify({ id, tool, args }));
    setTimeout(() => {
      if (pending.delete(id)) resolve({ result: 'Découpage Studio n’a pas répondu à temps.', isError: true });
    }, 30000);
  });
}

const TOOLS = AI_TOOLS.map((t) => ({
  name: t.name,
  description: `${t.description}${t.writes ? ' (modifie le projet)' : ''}`,
  inputSchema: t.schema,
}));

function reply(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function fail(id: unknown, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'decoupage-studio', version: '1.0.0' },
        instructions: `${AI_SYSTEM}\n\nTu agis sur le projet ouvert dans l’onglet Découpage Studio de l’utilisateur. Accès actuel : ${access}.`,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(params?.name ?? '');
      const r = await call(name, params?.arguments ?? {});
      return reply(id, { content: [{ type: 'text', text: r.result }], isError: r.isError });
    }
    default:
      return fail(id, -32601, `Méthode inconnue : ${method}`);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line));
    } catch (e) {
      log('message illisible :', (e as Error).message);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
log(`prêt, en attente de l’onglet sur 127.0.0.1:${PORT}`);
