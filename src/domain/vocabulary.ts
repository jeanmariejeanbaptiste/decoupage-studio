import { canon, fold } from './text';
import type { CustomVocabulary, VocabEntry } from './types';

const e = (key: string, short: string, long: string, abbr: string | undefined, aliases: string[] = []): VocabEntry => ({
  key,
  short,
  long,
  abbr,
  aliases,
});

/** Valeurs de cadre, du plus large au plus serré (§5.1). L'ordre sert aux contrôles et au tri. */
export const SHOT_VALUES: readonly VocabEntry[] = [
  e('general', 'Général', 'Plan général', 'PG', ['large', 'grand ensemble']),
  e('ensemble', 'Ensemble', "Plan d'ensemble", 'PE'),
  e('moyen', 'Moyen', 'Plan moyen (en pied)', 'PM', ['pied', 'plein pied']),
  e('italien', 'Italien', 'Plan italien', 'PI', ['genoux']),
  e('americain', 'Américain', 'Plan américain', 'PA', ['mi-cuisse']),
  e('taille', 'Taille', 'Plan taille', 'PT', ['mi-corps']),
  e('rapproche', 'Rapproché', 'Plan rapproché poitrine', 'PRP', ['poitrine', 'épaules']),
  e('gros_plan', 'Gros plan', 'Gros plan', 'GP', ['visage']),
  e('tres_gros_plan', 'Très GP', 'Très gros plan', 'TGP', ['détail visage', 'yeux']),
  e('insert', 'Insert', 'Insert', 'INS', ['détail', 'objet']),
];

export const WIDE_VALUE_KEYS: readonly string[] = ['general', 'ensemble', 'moyen'];

/** Axes (§5.2). */
export const AXES: readonly VocabEntry[] = [
  e('face', 'Face', 'Face', undefined, ['de face']),
  e('trois_quarts_face', '3/4 Face', 'Trois-quarts face', '3/4F', ['trois quarts face', '3/4']),
  e('profil', 'Profil', 'Profil (côté à préciser)', undefined),
  e('profil_gauche', 'Profil gauche', 'Profil gauche', undefined),
  e('profil_droit', 'Profil droit', 'Profil droit', undefined),
  e('trois_quarts_dos', '3/4 Dos', 'Trois-quarts dos', '3/4D', ['trois quarts dos']),
  e('dos', 'Dos', 'Dos', undefined, ['de dos']),
];

/** Hauteurs et angles (§5.2). */
export const HEIGHTS: readonly VocabEntry[] = [
  e('hauteur_regard', 'Hauteur regard', 'Hauteur regard', 'HR', ['hauteur yeux', 'neutre']),
  e('plongee', 'Plongée', 'Plongée', undefined, ['plonge', 'plongé']),
  e('contre_plongee', 'Contre-plongée', 'Contre-plongée', 'CP', ['contre plongee', 'contre plongé']),
  e('top_shot', 'Top shot', 'Top shot (plongée totale)', undefined, ['plongee totale', 'vue du dessus', 'zenithal']),
  e('low_angle', 'Low angle', 'Low angle (caméra au sol)', undefined, ['camera au sol', 'ras du sol']),
  e('subjectif', 'Subjectif', 'Plan subjectif', 'POV', ['pov', 'subjective']),
];

export const ANGLES: readonly VocabEntry[] = [...AXES, ...HEIGHTS];

/** Mouvements de caméra (§5.3). */
export const MOVEMENTS: readonly VocabEntry[] = [
  e('fixe', 'Fixe', 'Plan fixe', undefined, ['pied fixe', 'statique']),
  e('trav_avant', 'Trav avant', 'Travelling avant', undefined, ['traveling avant', 'travelling avant', 'push in', 'dolly in']),
  e('trav_arriere', 'Trav arrière', 'Travelling arrière', undefined, ['traveling arriere', 'pull out', 'dolly out']),
  e('trav_lateral', 'Trav latéral', 'Travelling latéral', undefined, ['traveling lateral']),
  e('trav_lateral_gauche', 'Trav latéral gauche', 'Travelling latéral gauche', undefined, ['traveling lateral gauche']),
  e('trav_lateral_droit', 'Trav latéral droit', 'Travelling latéral droit', undefined, ['traveling lateral droit']),
  e('trav_circulaire', 'Trav circulaire', 'Travelling circulaire', undefined, ['traveling circulaire', 'circulaire']),
  e('trav_vertical', 'Trav vertical', 'Travelling vertical', undefined, ['boom', 'traveling vertical']),
  e('boom_up', 'Boom up', 'Travelling vertical montant', undefined, ['boom haut']),
  e('boom_down', 'Boom down', 'Travelling vertical descendant', undefined, ['boom bas']),
  e('trav_courbe', 'Trav courbe', 'Travelling courbe', undefined, ['traveling courbe']),
  e('pano', 'Pano', 'Panoramique (sens à préciser)', undefined, ['panoramique']),
  e('pano_droite', 'Pano droite', 'Panoramique droite', undefined, ['panoramique droite']),
  e('pano_gauche', 'Pano gauche', 'Panoramique gauche', undefined, ['panoramique gauche']),
  e('tilt_up', 'Tilt up', 'Panoramique vertical haut', undefined, ['tilt haut']),
  e('tilt_down', 'Tilt down', 'Panoramique vertical bas', undefined, ['tilt bas']),
  e('roll', 'Roll', 'Roulis', undefined, ['roulis', 'dutch']),
  e('zoom_avant', 'Zoom avant', 'Zoom avant', undefined, ['zoom in']),
  e('zoom_arriere', 'Zoom arrière', 'Zoom arrière', undefined, ['zoom out']),
  e('suivi', 'Suivi', 'Plan suivi', undefined, ['suivre', 'follow']),
  e('epaule', 'Épaule', 'Caméra épaule', undefined, ['camera epaule', 'handheld']),
  e('steadicam', 'Steadicam', 'Steadicam', undefined, ['stab']),
  e('gimbal', 'Gimbal', 'Gimbal', undefined, ['ronin', 'stabilisateur']),
  e('drone', 'Drone', 'Drone', undefined, ['aerien']),
  e('grue', 'Grue', 'Grue', undefined, ['jib', 'crane']),
];

export const COMMON_FOCALS: readonly number[] = [14, 16, 18, 24, 28, 35, 50, 70, 85, 100, 135, 200];

export const EMPTY_CUSTOM_VOCABULARY: CustomVocabulary = { value: [], angle: [], movement: [] };

export type VocabKind = keyof CustomVocabulary;

export function vocabularyFor(kind: VocabKind, custom: CustomVocabulary = EMPTY_CUSTOM_VOCABULARY): VocabEntry[] {
  const base = kind === 'value' ? SHOT_VALUES : kind === 'angle' ? ANGLES : MOVEMENTS;
  return [...base, ...custom[kind]];
}

function terms(entry: VocabEntry): string[] {
  return [entry.short, entry.long, entry.abbr ?? '', ...entry.aliases].filter(Boolean);
}

/**
 * Suggestions : correspondance par préfixe puis par sous-chaîne, insensible aux accents et à la casse,
 * aliases et abréviations inclus.
 */
export function suggest(query: string, entries: readonly VocabEntry[], limit = 8): VocabEntry[] {
  const q = canon(query);
  if (!q) return entries.slice(0, limit);
  const scored: Array<{ entry: VocabEntry; score: number; i: number }> = [];
  entries.forEach((entry, i) => {
    const ts = terms(entry).map(canon);
    let score = -1;
    if (ts.some((t) => t.startsWith(q))) score = 0;
    else if (ts.some((t) => t.split(' ').some((w) => w.startsWith(q)))) score = 1;
    else if (ts.some((t) => t.includes(q))) score = 2;
    if (score >= 0) scored.push({ entry, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.entry)
    .slice(0, limit);
}

/** Rattache un jeton libre à une entrée du vocabulaire (égalité canonique), sinon `undefined`. */
export function matchVocab(token: string, entries: readonly VocabEntry[]): VocabEntry | undefined {
  const t = canon(token);
  if (!t) return undefined;
  return entries.find((entry) => terms(entry).some((x) => canon(x) === t));
}

/** Rang d'une valeur de cadre dans l'échelle (0 = plus large), -1 si inconnue. */
export function valueRank(value: string): number {
  const m = matchVocab(value, SHOT_VALUES);
  return m ? SHOT_VALUES.indexOf(m) : -1;
}

export function valueLabel(value: string, style: 'court' | 'long'): string {
  if (style === 'court') return value;
  const m = matchVocab(value, SHOT_VALUES);
  return m ? m.long : value;
}

export function angleKind(token: string): 'axis' | 'height' | 'pov' | undefined {
  const m = matchVocab(token, ANGLES);
  if (!m) return undefined;
  if (m.key === 'subjectif') return 'pov';
  return AXES.includes(m) ? 'axis' : 'height';
}

/** Avertissement doux : deux axes, ou deux hauteurs, dans la même saisie (§5.2). */
export function hasAngleConflict(tokens: readonly string[]): boolean {
  const kinds = tokens.map(angleKind);
  return kinds.filter((k) => k === 'axis').length > 1 || kinds.filter((k) => k === 'height').length > 1;
}

export function isZoom(movement: readonly string[]): boolean {
  return movement.some((m) => fold(m).includes('zoom'));
}
