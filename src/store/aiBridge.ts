import { create } from 'zustand';
import { AI_TOOLS, runAiTool, type ToolOutcome } from '../domain/aiTools';
import type { ProjectDoc } from '../domain/types';
import { mutateDoc, useProjectStore } from './projectStore';

/**
 * Pont vers une IA locale (Claude Desktop, extension « Découpage Studio ») : l'onglet ouvert se
 * connecte au petit serveur MCP de l'ordinateur (127.0.0.1, jamais Internet) et exécute les outils
 * qu'il reçoit, dans la limite de l'accès choisi ici. Chaque modification est annulable (⌘Z).
 */

export type BridgeAccess = 'off' | 'read' | 'write';
export const BRIDGE_PORT = 47613;
const KEY = 'ds-ai-bridge';

function stored(): BridgeAccess {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'read' || v === 'write' ? v : 'off';
  } catch {
    return 'off';
  }
}

export const useBridge = create<{ access: BridgeAccess; connected: boolean }>(() => ({ access: stored(), connected: false }));

let socket: WebSocket | null = null;
let retry: number | undefined;

interface Call {
  id: number | string;
  tool: string;
  args?: unknown;
}

function execute(c: Call): ToolOutcome {
  const access = useBridge.getState().access;
  const def = AI_TOOLS.find((t) => t.name === c.tool);
  if (!def) return { result: `Outil inconnu : ${c.tool}`, isError: true };
  if (def.writes && access !== 'write') return { result: 'Découpage Studio n’autorise que la lecture (Paramètres › Assistant IA › Claude Desktop).', isError: true };
  const doc = useProjectStore.getState().doc;
  if (!doc) return { result: 'Aucun projet ouvert dans Découpage Studio.', isError: true };
  if (!def.writes) return runAiTool(doc, c.tool, c.args);
  let out: ToolOutcome = { result: '' };
  mutateDoc((d) => void (out = runAiTool(d as ProjectDoc, c.tool, c.args)));
  return out;
}

function connect() {
  window.clearTimeout(retry);
  if (useBridge.getState().access === 'off' || socket) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);
  } catch {
    retry = window.setTimeout(connect, 5000);
    return;
  }
  socket = ws;
  ws.onopen = () => {
    useBridge.setState({ connected: true });
    ws.send(JSON.stringify({ type: 'hello', app: 'decoupage-studio', access: useBridge.getState().access }));
  };
  ws.onmessage = (e) => {
    let c: Call;
    try {
      c = JSON.parse(String(e.data)) as Call;
    } catch {
      return;
    }
    if (c.id === undefined || !c.tool) return;
    const out = execute(c);
    ws.send(JSON.stringify({ id: c.id, result: out.result, isError: !!out.isError }));
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    useBridge.setState({ connected: false });
    if (useBridge.getState().access !== 'off') retry = window.setTimeout(connect, 4000);
  };
  ws.onerror = () => ws.close();
}

/** Au démarrage : se connecte si l'accès est ouvert dans ce navigateur. */
export function startBridge() {
  connect();
}

export function setBridgeAccess(access: BridgeAccess) {
  try {
    localStorage.setItem(KEY, access);
  } catch {
    /* stockage indisponible : réglage valable pour la session */
  }
  useBridge.setState({ access });
  if (access === 'off') {
    window.clearTimeout(retry);
    socket?.close();
    socket = null;
  } else if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'hello', app: 'decoupage-studio', access }));
  } else connect();
}
