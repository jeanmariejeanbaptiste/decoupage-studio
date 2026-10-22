import { sortedCharacters } from '../../domain/characters';
import { fold } from '../../domain/text';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { COMMON_FOCALS, suggest, vocabularyFor } from '../../domain/vocabulary';
import type { Suggestion } from '../../ui/Suggestion';

const SOUND = ['IN', 'OFF', 'V.O.', 'Musique diégétique', 'Musique extradiégétique', 'Playback'];
const STATUS = ['à tourner', 'tourné', 'abandonné'];

function matchList(q: string, list: readonly string[], limit = 8): Suggestion[] {
  const f = fold(q);
  const pre = list.filter((x) => fold(x).startsWith(f));
  const sub = list.filter((x) => !fold(x).startsWith(f) && fold(x).includes(f));
  return [...pre, ...sub].slice(0, limit).map((label) => ({ label }));
}

/** Source de suggestions pour une colonne (null si aucune). */
export function suggestionSource(doc: ProjectDoc, col: ColumnKey): ((q: string) => Suggestion[]) | undefined {
  const custom = doc.customVocabulary;
  switch (col) {
    case 'value':
      return (q) => suggest(q, vocabularyFor('value', custom)).map((e) => ({ label: e.short, hint: e.abbr ?? e.long }));
    case 'angle':
      return (q) => suggest(q, vocabularyFor('angle', custom)).map((e) => ({ label: e.short, hint: e.long !== e.short ? e.long : e.abbr }));
    case 'movement':
      return (q) => suggest(q, vocabularyFor('movement', custom)).map((e) => ({ label: e.short, hint: e.long !== e.short ? e.long : undefined }));
    case 'subject': {
      const names = sortedCharacters(doc).map((c) => c.name);
      const used = [...new Set(Object.values(doc.shots).map((s) => s.subject.trim()).filter(Boolean))];
      const all = [...names, ...used.filter((u) => !names.some((n) => fold(n) === fold(u)))];
      return (q) => matchList(q, all).map((x) => ({ ...x, hint: names.includes(x.label) ? 'personnage' : undefined }));
    }
    case 'sequence': {
      const decors = Object.values(doc.decors).map((d) => d.name.toUpperCase());
      return (q) => matchList(q, [...new Set(decors)]);
    }
    case 'focal':
      return (q) => COMMON_FOCALS.filter((f) => String(f).startsWith(q.trim())).map((f) => ({ label: `${f} mm`, value: String(f) }));
    case 'dialogue': {
      // Orateur de la réplique : « NOM : réplique ». On propose les personnages au début d'une réplique.
      const names = sortedCharacters(doc).map((c) => c.name);
      return (q) => {
        const m = /(^|[.!?…]\s+)([^\s:.!?…]*)$/.exec(q);
        if (!m) return [];
        const head = q.slice(0, q.length - m[2].length);
        return matchList(m[2], names, 6).map((x) => ({ label: `${x.label.toUpperCase()} :`, value: `${head}${x.label.toUpperCase()} : `, hint: 'qui parle' }));
      };
    }
    case 'sound':
      return (q) => matchList(q, SOUND);
    case 'status':
      return (q) => matchList(q, STATUS);
    default:
      return undefined;
  }
}
