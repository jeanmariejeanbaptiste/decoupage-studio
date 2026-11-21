/**
 * Pair « relais » : la même interface que PeerJS (ce que le partage en utilise), mais les messages
 * passent par le relais Cloudflare de Découpage Studio, en WebSocket. Aucune connexion directe entre
 * navigateurs : le partage tient sur les wifi publics et les réseaux d'entreprise.
 */
export const RELAY_URL = 'wss://share.decoupage-studio.workers.dev';

type Handler = (...a: unknown[]) => void;
class Emitter {
  private h = new Map<string, Handler[]>();
  on(ev: string, fn: Handler) {
    this.h.set(ev, [...(this.h.get(ev) ?? []), fn]);
    return this;
  }
  off(ev: string, fn: Handler) {
    this.h.set(ev, (this.h.get(ev) ?? []).filter((x) => x !== fn));
    return this;
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of this.h.get(ev) ?? []) fn(...a);
  }
}

/** Les images voyagent en binaire : encodées en base64 dans le JSON du relais. */
function encode(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (x instanceof ArrayBuffer) {
      let s = '';
      const b = new Uint8Array(x);
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { __ab: btoa(s) };
    }
    return x;
  });
}
function decode(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v), (_k, x) => {
    if (x && typeof x === 'object' && typeof (x as { __ab?: unknown }).__ab === 'string') {
      const s = atob((x as { __ab: string }).__ab);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out.buffer;
    }
    return x;
  });
}

class RelayConn extends Emitter {
  open = false;
  constructor(
    public peer: string,
    private out: (d: string) => void,
    private onClose: () => void,
  ) {
    super();
  }
  send(msg: unknown) {
    if (this.open) this.out(encode(msg));
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.onClose();
    this.emit('close');
  }
  /** Fermée par l'autre côté ou par le réseau. */
  ended() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
}

export class RelayPeer extends Emitter {
  open = false;
  destroyed = false;
  disconnected = false;
  private ws: WebSocket | null = null;
  private conns = new Map<string, RelayConn>();
  constructor(public id?: string) {
    super();
    if (id) this.hostSocket();
    else
      setTimeout(() => {
        this.open = true;
        this.emit('open', '');
      }, 0);
  }

  /** Hôte : une salle au nom du lien de partage. */
  private hostSocket() {
    const ws = new WebSocket(`${RELAY_URL}/room/${encodeURIComponent(this.id!)}?role=host`);
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.disconnected = false;
      this.emit('open', this.id);
    };
    ws.onerror = () => !this.open && this.emit('error', Object.assign(new Error('Le relais du partage ne répond pas.'), { type: 'network' }));
    ws.onclose = () => {
      if (this.ws !== ws || this.destroyed) return;
      for (const c of this.conns.values()) c.ended();
      this.conns.clear();
      this.open = false;
      this.disconnected = true;
      this.emit('disconnected');
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { t: string; from: string; d?: unknown };
      if (m.t === 'join') {
        this.conns.get(m.from)?.ended();
        const c = new RelayConn(
          m.from,
          (d) => ws.readyState === WebSocket.OPEN && ws.send(`{"t":"data","to":${JSON.stringify(m.from)},"d":${d}}`),
          () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'close', to: m.from })),
        );
        this.conns.set(m.from, c);
        this.emit('connection', c);
        setTimeout(() => {
          c.open = true;
          c.emit('open');
        }, 0);
      } else if (m.t === 'data') this.conns.get(m.from)?.emit('data', decode(m.d));
      else if (m.t === 'leave') {
        this.conns.get(m.from)?.ended();
        this.conns.delete(m.from);
      }
    };
  }

  /** Invité : rejoint la salle de l'hôte. */
  connect(room: string): RelayConn {
    const ws = new WebSocket(`${RELAY_URL}/room/${encodeURIComponent(room)}?role=guest`);
    const c = new RelayConn(room, (d) => ws.readyState === WebSocket.OPEN && ws.send(`{"t":"data","d":${d}}`), () => ws.close());
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { t: string; d?: unknown };
      if (m.t === 'ready' && !c.open) {
        c.open = true;
        c.emit('open');
      } else if (m.t === 'nohost') {
        this.emit('error', Object.assign(new Error('Ce partage n’est pas ouvert pour l’instant.'), { type: 'peer-unavailable' }));
        ws.close();
      } else if (m.t === 'data') c.emit('data', decode(m.d));
      else if (m.t === 'hostgone') c.ended();
    };
    ws.onerror = () => this.emit('error', Object.assign(new Error('Le relais du partage ne répond pas.'), { type: 'network' }));
    ws.onclose = () => c.ended();
    return c;
  }

  reconnect() {
    if (this.destroyed || !this.id) return;
    this.hostSocket();
  }

  destroy() {
    this.destroyed = true;
    this.open = false;
    for (const c of this.conns.values()) c.ended();
    this.conns.clear();
    this.ws?.close();
  }
}
