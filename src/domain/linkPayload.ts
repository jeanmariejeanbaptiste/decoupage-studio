/**
 * Données portées par un lien : JSON compressé (deflate) puis encodé en base64url, sans serveur.
 * Sert au lien autonome du partage et aux liens d'action envoyés par une IA.
 */

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const reader = source.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function packJson(value: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  return toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
}

/** Lève une erreur si le texte n'est pas un contenu de lien valide. */
export async function unpackJson<T>(text: string): Promise<T> {
  const raw = await pipe(fromBase64Url(text.trim()), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(raw)) as T;
}
