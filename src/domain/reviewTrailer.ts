/**
 * Relecture en ligne : chaque remarque d'un relecteur est un commentaire Google Drive natif sur le
 * fichier publié. Son contenu est du texte brut : une phrase lisible (ce qu'on voit dans Drive), puis
 * une dernière ligne, la « traîne », qui dit à l'application où porte la remarque :
 *
 *   Plutôt un plan large ?
 *
 *   ds:1 {"i":"x1","v":"V1id","a":{"kind":"shot","shotId":"s1","col":"value"}}
 *
 * La traîne reste courte ; des tracés trop lourds partent dans un fichier joint (`x`).
 */
import type { CommentAnchor, CommentMarks } from './comments';
import type { ID } from './types';

export const TRAILER_TAG = 'ds:1';
/** Au-delà, la charge (tracés) est rangée dans un fichier à part. */
export const MAX_CONTENT = 16_000;

/** Fichier du Drive d'un relecteur, lisible par tous ceux qui ont le lien. */
export interface DriveRef {
  id: string;
  /** Clé de ressource du fichier (liens d'anciens fichiers). */
  rk?: string;
}

export interface TrailerPayload {
  /** Identifiant du commentaire chez son auteur (le même partout ensuite). */
  i?: ID;
  /** Version du film visée. */
  v?: ID;
  /** Endroit commenté. */
  a?: CommentAnchor;
  /** Réponse : au commentaire de ce fil (identifiant local), ou à ce commentaire Drive. */
  r?: ID;
  rr?: string;
  /** Texte vide : la phrase lisible n'est qu'un repère. */
  e?: 1;
  m?: CommentMarks;
  /** Images jointes, dans le Drive du relecteur. */
  f?: DriveRef[];
  /** Charge rangée dans un fichier joint (tracés trop longs pour un commentaire). */
  x?: DriveRef;
}

/** Phrase lisible d'un commentaire sans texte. */
function placeholder(p: TrailerPayload): string {
  if (p.m?.paths.length || p.x) return 'Tracés sur la page.';
  if (p.f?.length) return 'Image jointe.';
  return 'Commentaire.';
}

/** Contenu d'un commentaire Drive : la phrase, une ligne vide, la traîne. */
export function encodeComment(text: string, payload: TrailerPayload): string {
  const t = text.trim();
  const p: TrailerPayload = { ...payload };
  if (!t) p.e = 1;
  else delete p.e;
  return `${t || placeholder(p)}\n\n${TRAILER_TAG} ${JSON.stringify(p)}`;
}

/** Texte et traîne d'un commentaire Drive ; sans traîne valide (commentaire écrit dans Drive), le texte seul. */
export function decodeComment(content: string): { text: string; payload: TrailerPayload | null } {
  const raw = content ?? '';
  const tag = `${TRAILER_TAG} `;
  const at = raw.startsWith(tag) ? 0 : raw.lastIndexOf(`\n${tag}`) + 1;
  if (at <= 0 && !raw.startsWith(tag)) return { text: raw.trim(), payload: null };
  const line = raw.slice(at + tag.length).trim();
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return { text: raw.trim(), payload: null };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { text: raw.trim(), payload: null };
  const p = payload as TrailerPayload;
  return { text: p.e === 1 ? '' : raw.slice(0, at).trim(), payload: p };
}

const DRIVE_ID = /^[\w-]{6,200}$/;

/** Clé locale d'une image jointe depuis Drive (la même chez l'auteur et chez les relecteurs). */
export const driveKey = (f: DriveRef): string => `drive:${f.id}${f.rk ? `~${f.rk}` : ''}`;

/** Fichier Drive désigné par une clé locale (`drive:<id>[~<clé>]`), ou rien. */
export function driveRefOf(key: string): DriveRef | null {
  if (!key.startsWith('drive:')) return null;
  const [id, rk] = key.slice(6).split('~');
  if (!DRIVE_ID.test(id) || (rk !== undefined && !DRIVE_ID.test(rk))) return null;
  return rk ? { id, rk } : { id };
}

/** Référence de fichier valide (identifiants Drive : lettres, chiffres, tirets). */
export function cleanRef(x: unknown): DriveRef | null {
  if (!x || typeof x !== 'object') return null;
  const { id, rk } = x as Record<string, unknown>;
  if (typeof id !== 'string' || !DRIVE_ID.test(id)) return null;
  if (rk !== undefined && (typeof rk !== 'string' || !DRIVE_ID.test(rk))) return { id };
  return rk ? { id, rk: rk as string } : { id };
}
