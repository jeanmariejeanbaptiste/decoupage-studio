import { shortQuote } from './scriptToShot';
import { fold } from './text';

/**
 * Le champ Son, lu et écrit par morceaux (feuille Son du téléphone). Il reste un texte libre : les
 * morceaux sont séparés par « · », comme les mentions de réplique posées depuis le scénario.
 * Ce qui n'est pas reconnu est gardé tel quel, en note : rien ne se perd à l'aller-retour.
 */
export const SOUND_KINDS = ['Son direct', 'Ambiance', 'Réplique', 'Musique', 'Effets'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

export interface SoundParts {
  kinds: SoundKind[];
  /** Ce qu'on entend en fond (« le hall, étouffé derrière la vitre »). */
  ambiance: string;
  /** Mentions de réplique, telles qu'écrites (« Rép. « … » », « Rép. NOM « … » »). */
  replies: string[];
  note: string;
}

const SEP = ' · ';
const AMB = /^ambiance\s*:\s*/i;

export function parseSound(text: string): SoundParts {
  const parts: SoundParts = { kinds: [], ambiance: '', replies: [], note: '' };
  const notes: string[] = [];
  const add = (k: SoundKind) => !parts.kinds.includes(k) && parts.kinds.push(k);
  for (const raw of text.split(/\s+·\s+/)) {
    const seg = raw.trim();
    if (!seg) continue;
    const kind = SOUND_KINDS.find((k) => fold(k) === fold(seg));
    if (kind) add(kind);
    else if (AMB.test(seg)) {
      add('Ambiance');
      parts.ambiance = seg.replace(AMB, '');
    } else if (/^Rép\.\s/.test(seg)) {
      add('Réplique');
      parts.replies.push(seg);
    } else notes.push(seg);
  }
  parts.note = notes.join(SEP);
  return parts;
}

/** Texte du champ, dans l'ordre des pastilles ; une pastille vide de détail s'écrit seule. */
export function composeSound(p: SoundParts): string {
  const out: string[] = [];
  for (const k of SOUND_KINDS) {
    if (!p.kinds.includes(k)) continue;
    if (k === 'Ambiance') out.push(p.ambiance.trim() ? `Ambiance : ${p.ambiance.trim()}` : 'Ambiance');
    else if (k === 'Réplique') out.push(...(p.replies.length ? p.replies : ['Réplique']));
    else out.push(k);
  }
  if (p.note.trim()) out.push(p.note.trim());
  return out.join(SEP);
}

/** Mention d'une réplique : sans le nom quand c'est le sujet du plan qui parle. */
export function replyMention(name: string, line: string, subject: string): string {
  const q = `« ${shortQuote(line)} »`;
  return fold(name) === fold(subject.trim()) ? `Rép. ${q}` : `Rép. ${name.toLocaleUpperCase('fr')} ${q}`;
}
