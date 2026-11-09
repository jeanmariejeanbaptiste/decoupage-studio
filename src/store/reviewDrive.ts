/**
 * Relecture en ligne : appels à Google Drive (fichier publié, droits du lien, commentaires) et au
 * sélecteur de fichiers de Google (Picker). Aucune logique ici : de simples requêtes.
 */
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from '../app/config';
import type { DriveComment } from '../domain/reviewMerge';
import type { DriveRef } from '../domain/reviewTrailer';
import { DRIVE_API, DRIVE_UPLOAD, GAPI_SCRIPT } from './googleUrls';

export class DriveError extends Error {
  constructor(
    readonly status: number,
    readonly reason = '',
  ) {
    super(`Google Drive a répondu ${status}${reason ? ` (${reason})` : ''}.`);
  }
}

/** Ce jeton ne voit pas ce fichier (pas encore ouvert avec l'application) : 403 ou 404. */
export const unseen = (e: unknown) => e instanceof DriveError && (e.status === 404 || e.status === 403) && !/rateLimit|quota|userRateLimit/i.test(e.reason);

const keyHeader = (ref: DriveRef): Record<string, string> => (ref.rk ? { 'X-Goog-Drive-Resource-Keys': `${ref.id}/${ref.rk}` } : {});

async function call(url: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...rest, headers });
  if (!res.ok) {
    let reason = '';
    try {
      const j = (await res.json()) as { error?: { errors?: Array<{ reason?: string }>; status?: string } };
      reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? '';
    } catch {
      /* corps illisible */
    }
    throw new DriveError(res.status, reason);
  }
  return res;
}

const COMMENT_FIELDS = 'id,content,author(displayName,me),createdTime,modifiedTime,deleted';

/** Nouveau fichier dans « Mon Drive » de l'utilisateur. */
export async function createFile(token: string, name: string, body: Blob): Promise<DriveRef> {
  const b = `ds${Math.random().toString(36).slice(2)}`;
  const meta = { name, mimeType: body.type || 'application/octet-stream' };
  const multipart = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`, body, `\r\n--${b}--`]);
  const res = await call(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,resourceKey`, { method: 'POST', token, headers: { 'content-type': `multipart/related; boundary=${b}` }, body: multipart });
  const j = (await res.json()) as { id: string; resourceKey?: string };
  return j.resourceKey ? { id: j.id, rk: j.resourceKey } : { id: j.id };
}

/** Remplace le contenu d'un fichier (même identifiant : le lien reste valable). */
export async function updateFile(token: string, id: string, body: Blob): Promise<void> {
  await call(`${DRIVE_UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, { method: 'PATCH', token, headers: { 'content-type': body.type || 'application/octet-stream' }, body });
}

/** Lit un fichier avec le jeton de l'utilisateur. */
export async function readFile(token: string, ref: DriveRef): Promise<string> {
  return (await call(`${DRIVE_API}/files/${encodeURIComponent(ref.id)}?alt=media`, { token, headers: keyHeader(ref) })).text();
}

/** Fichier plus lourd que permis (pièce jointe, tracés rangés à part). */
export class TooLargeError extends Error {
  constructor() {
    super('Fichier trop lourd.');
  }
}

/** Corps de la réponse, coupé au-delà de `max` octets (sans tout télécharger). */
export async function boundedBlob(res: Response, max: number): Promise<Blob> {
  const type = res.headers.get('content-type') ?? '';
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    void res.body?.cancel().catch(() => undefined);
    throw new TooLargeError();
  }
  if (!res.body) {
    const b = await res.blob();
    if (b.size > max) throw new TooLargeError();
    return b;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => undefined);
      throw new TooLargeError();
    }
    parts.push(value);
  }
  return new Blob(parts as BlobPart[], { type });
}

/**
 * Lit un fichier ouvert à tous ceux qui ont le lien, sans compte (clé d'API). `max` : taille au-delà
 * de laquelle la lecture s'arrête (fichiers nommés par un relecteur).
 */
export async function readPublic(ref: DriveRef, max?: number): Promise<Blob> {
  const res = await call(`${DRIVE_API}/files/${encodeURIComponent(ref.id)}?alt=media&key=${encodeURIComponent(GOOGLE_API_KEY)}`, { headers: keyHeader(ref) });
  return max ? boundedBlob(res, max) : res.blob();
}

/** Le lien mène-t-il encore au fichier (lecture sans compte des seules métadonnées) ? */
export async function linkOpen(ref: DriveRef): Promise<boolean> {
  try {
    await call(`${DRIVE_API}/files/${encodeURIComponent(ref.id)}?fields=id&key=${encodeURIComponent(GOOGLE_API_KEY)}`, { headers: keyHeader(ref) });
    return true;
  } catch (e) {
    if (e instanceof DriveError && (e.status === 404 || e.status === 403)) return false;
    throw e;
  }
}

/** Numéro de version du fichier (il change à chaque écriture, d'où qu'elle vienne). */
export async function fileVersion(token: string, id: string): Promise<string> {
  const j = (await (await call(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=version`, { token })).json()) as { version?: string | number };
  return String(j.version ?? '');
}

/** Ouvre le fichier à tous ceux qui ont le lien (commentateurs, ou lecteurs pour une image jointe). */
export async function shareWithLink(token: string, id: string, role: 'commenter' | 'reader'): Promise<void> {
  await call(`${DRIVE_API}/files/${encodeURIComponent(id)}/permissions?fields=id`, {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role, allowFileDiscovery: false }),
  });
}

/** Retire l'accès par le lien (le fichier reste). */
export async function unshare(token: string, id: string): Promise<void> {
  const res = await call(`${DRIVE_API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type)`, { token });
  const { permissions = [] } = (await res.json()) as { permissions?: Array<{ id: string; type: string }> };
  for (const p of permissions) if (p.type === 'anyone') await call(`${DRIVE_API}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(p.id)}`, { method: 'DELETE', token });
}

export async function listComments(token: string, id: string): Promise<DriveComment[]> {
  const out: DriveComment[] = [];
  let page = '';
  do {
    const q = `fields=nextPageToken,comments(${COMMENT_FIELDS})&pageSize=100&includeDeleted=true${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const j = (await (await call(`${DRIVE_API}/files/${encodeURIComponent(id)}/comments?${q}`, { token })).json()) as { comments?: DriveComment[]; nextPageToken?: string };
    out.push(...(j.comments ?? []));
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

export async function createComment(token: string, fileId: string, content: string): Promise<DriveComment> {
  const res = await call(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/comments?fields=${COMMENT_FIELDS}`, { method: 'POST', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
  return (await res.json()) as DriveComment;
}

export async function updateComment(token: string, fileId: string, commentId: string, content: string): Promise<DriveComment> {
  const res = await call(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}?fields=${COMMENT_FIELDS}`, { method: 'PATCH', token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
  return (await res.json()) as DriveComment;
}

export async function removeComment(token: string, fileId: string, commentId: string): Promise<void> {
  await call(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', token });
}

// --- Sélecteur de fichiers de Google -------------------------------------------------------------

interface PickerChain {
  [k: string]: (...a: unknown[]) => PickerChain;
}
interface PickerNs {
  DocsView: new (viewId?: unknown) => PickerChain;
  PickerBuilder: new () => PickerChain;
  ViewId: { DOCS: unknown };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string };
}
interface Gapi {
  load(name: string, cb: { callback: () => void; onerror?: () => void } | (() => void)): void;
}

let pickerPromise: Promise<void> | null = null;
const pickerNs = () => (window as unknown as { google?: { picker?: PickerNs } }).google?.picker;

/** Charge le sélecteur à l'avance (le relecteur s'en sert à son premier commentaire). */
export function loadPicker(): Promise<void> {
  if (pickerNs()) return Promise.resolve();
  pickerPromise ??= new Promise<void>((ok, ko) => {
    const done = () => {
      const g = (window as unknown as { gapi?: Gapi }).gapi;
      if (!g) return ko(new Error('Sélecteur Google indisponible.'));
      g.load('picker', { callback: () => ok(), onerror: () => ko(new Error('Sélecteur Google indisponible.')) });
    };
    if ((window as unknown as { gapi?: Gapi }).gapi) return done();
    const sc = document.createElement('script');
    sc.src = GAPI_SCRIPT;
    sc.async = true;
    sc.onload = done;
    sc.onerror = () => {
      pickerPromise = null;
      ko(new Error('Sélecteur Google injoignable.'));
    };
    document.head.appendChild(sc);
  }).catch((e: Error) => {
    pickerPromise = null;
    throw e;
  });
  return pickerPromise;
}

/**
 * Fait ouvrir à l'utilisateur le fichier publié (sélecteur présélectionné sur lui) : la portée
 * drive.file ne laisse voir à l'application que les fichiers ouverts ainsi. `true` s'il est choisi.
 */
export async function openWithPicker(token: string, fileId: string): Promise<boolean> {
  await loadPicker();
  const pk = pickerNs();
  if (!pk) throw new Error('Sélecteur Google indisponible.');
  return new Promise<boolean>((resolve) => {
    const view = new pk.DocsView(pk.ViewId.DOCS).setFileIds(fileId);
    const picker = new pk.PickerBuilder()
      .setAppId(GOOGLE_APP_ID)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setOAuthToken(token)
      .setLocale('fr')
      .addView(view)
      .setCallback((data: unknown) => {
        const action = (data as Record<string, unknown>)?.[pk.Response.ACTION];
        if (action === pk.Action.PICKED) resolve(true);
        else if (action === pk.Action.CANCEL) resolve(false);
      })
      .build();
    picker.setVisible(true);
  });
}
