/**
 * Relais du partage de Découpage Studio (Cloudflare Workers + Durable Objects).
 *
 * Une salle par lien de partage : l'hôte et ses invités s'y relient en WebSocket, et le relais
 * transmet les messages, sans rien garder ni lire. Remplace la connexion directe entre navigateurs,
 * que les wifi publics bloquent souvent.
 *
 * Protocole (JSON) :
 * - hôte  : /room/<salle>?role=host            ; invité : /room/<salle>?role=guest
 * - hôte reçoit { t: 'join', from } à l'arrivée d'un invité, { t: 'data', from, d }, { t: 'leave', from }
 * - hôte envoie { t: 'data', to, d } ou { t: 'close', to }
 * - invité reçoit { t: 'ready' } (hôte présent), { t: 'nohost' }, { t: 'data', d }, { t: 'closed' }
 * - invité envoie { t: 'data', d }
 */
export class Room {
  constructor(state) {
    this.state = state;
  }

  host() {
    return this.state.getWebSockets('host')[0];
  }

  guest(id) {
    return this.state.getWebSockets(`g:${id}`)[0];
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket attendu', { status: 426 });
    const role = new URL(request.url).searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role === 'host') {
      // Un seul hôte : un hôte revenu (rechargement, réseau) remplace l'ancien.
      for (const old of this.state.getWebSockets('host')) old.close(4000, 'remplacé');
      this.state.acceptWebSocket(server, ['host']);
      for (const g of this.state.getWebSockets()) {
        const tag = this.state.getTags(g).find((x) => x.startsWith('g:'));
        if (!tag) continue;
        server.send(JSON.stringify({ t: 'join', from: tag.slice(2) }));
        g.send(JSON.stringify({ t: 'ready' }));
      }
    } else {
      const id = crypto.randomUUID();
      this.state.acceptWebSocket(server, [`g:${id}`]);
      const h = this.host();
      if (h) {
        h.send(JSON.stringify({ t: 'join', from: id }));
        server.send(JSON.stringify({ t: 'ready' }));
      } else server.send(JSON.stringify({ t: 'nohost' }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let m;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const tags = this.state.getTags(ws);
    if (tags.includes('host')) {
      const g = m.to && this.guest(m.to);
      if (!g) return;
      if (m.t === 'data') g.send(JSON.stringify({ t: 'data', d: m.d }));
      else if (m.t === 'close') g.close(1000, 'fermé par l’hôte');
      return;
    }
    const tag = tags.find((x) => x.startsWith('g:'));
    const h = this.host();
    if (tag && h && m.t === 'data') h.send(JSON.stringify({ t: 'data', from: tag.slice(2), d: m.d }));
  }

  webSocketClose(ws) {
    const tags = this.state.getTags(ws);
    const tag = tags.find((x) => x.startsWith('g:'));
    if (tag) this.host()?.send(JSON.stringify({ t: 'leave', from: tag.slice(2) }));
    else if (tags.includes('host')) for (const g of this.state.getWebSockets()) if (g !== ws && !this.state.getTags(g).includes('host')) g.send(JSON.stringify({ t: 'hostgone' }));
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{4,80})$/);
    if (url.pathname === '/') return new Response('Découpage Studio — relais du partage', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (!m) return new Response('Introuvable', { status: 404 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return room.fetch(request);
  },
};
