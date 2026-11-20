import { sortedCharacters } from '../../domain/characters';
import { fold } from '../../domain/text';
import type { ReactNode } from 'react';
import { canon } from '../../domain/text';
import type { ColumnKey, CustomVocabulary, ProjectDoc, VocabEntry } from '../../domain/types';
import { AXES, COMMON_FOCALS, matchVocab, suggest, vocabularyFor } from '../../domain/vocabulary';
import type { Suggestion } from '../../ui/Suggestion';

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
      return (q) => suggest(q, vocabularyFor('value', custom), q.trim() ? 8 : 40).map((e) => ({ label: e.short, hint: e.abbr ?? e.long }));
    case 'angle':
      return (q) => suggest(q, vocabularyFor('angle', custom), q.trim() ? 8 : 40).map((e) => ({ label: e.short, hint: e.long !== e.short ? e.long : e.abbr }));
    case 'movement':
      return (q) => suggest(q, vocabularyFor('movement', custom), q.trim() ? 8 : 40).map((e) => ({ label: e.short, hint: e.long !== e.short ? e.long : undefined }));
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
    case 'status':
      return (q) => matchList(q, STATUS);
    default:
      return undefined;
  }
}

// Tour du sujet, dans l'ordre d'un travelling circulaire : face, côté gauche, dos, côté droit.
const AXIS_ORDER = ['face', 'trois_quarts_face_gauche', 'profil_gauche', 'trois_quarts_dos_gauche', 'dos', 'trois_quarts_dos_droit', 'profil_droit', 'trois_quarts_face_droit'];
const HEIGHT_ORDER = ['hauteur_regard', 'plongee', 'contre_plongee', 'top_shot', 'low_angle'];
/** Retirés de la liste (côté non précisé : leurs versions gauche / droite le disent) ; toujours reconnus. */
const HIDDEN_ANGLES = ['profil', 'trois_quarts_face', 'trois_quarts_dos'];

/**
 * Menu des angles, rangé : l'axe (autour du sujet), puis la hauteur, puis le point de vue. Les angles
 * déjà choisis n'y figurent plus. Travelling circulaire : l'axe choisi peut aller vers un autre
 * (« Face → Dos »), comme une focale va vers une autre pendant un zoom.
 */
export function angleSuggestions(q: string, tokens: readonly string[], circular: boolean, custom: CustomVocabulary | undefined, icon: (key: string) => ReactNode): Suggestion[] {
  const all = vocabularyFor('angle', custom).filter((e) => !HIDDEN_ANGLES.includes(e.key));
  const taken = new Set(tokens.map((t) => matchVocab(t, all)?.key ?? canon(t)));
  const query = q.trim();
  const hits = query ? new Set(suggest(query, all, 40).map((e) => e.key)) : null;
  const keep = (e: VocabEntry) => !taken.has(e.key) && (!hits || hits.has(e.key));
  const byKey = new Map(all.map((e) => [e.key, e]));
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((e): e is VocabEntry => !!e);
  const last = tokens.at(-1);
  const lastAxis = last && !last.includes('→') ? AXES.find((a) => a === matchVocab(last, AXES)) : undefined;
  const out: Suggestion[] = [];
  for (const e of pick(AXIS_ORDER)) {
    if (circular && lastAxis) {
      if (e.key === lastAxis.key || (hits && !hits.has(e.key))) continue;
      out.push({ label: `${lastAxis.short} → ${e.short}`, value: `${lastAxis.short} → ${e.short}`, replaceLast: true, group: 'Axe', icon: icon(e.key) });
    } else if (keep(e)) out.push({ label: e.short, group: 'Axe', icon: icon(e.key) });
  }
  for (const e of pick(HEIGHT_ORDER)) if (keep(e)) out.push({ label: e.short, group: 'Hauteur', icon: icon(e.key) });
  for (const e of pick(['subjectif'])) if (keep(e)) out.push({ label: e.short, group: 'Point de vue', icon: icon(e.key) });
  for (const e of all.filter((x) => !AXIS_ORDER.includes(x.key) && !HEIGHT_ORDER.includes(x.key) && x.key !== 'subjectif')) if (keep(e)) out.push({ label: e.short, group: 'Personnalisés' });
  return out;
}
