/**
 * Rapprochement des scènes de deux états d'un scénario (version suivante, réécriture, réimport) :
 * quelle scène nouvelle est la suite de quelle scène ancienne, lesquelles sont neuves, lesquelles ont
 * disparu. Un numéro qui change, un en-tête retouché, une réplique réécrite ou une scène déplacée ne
 * font pas perdre la correspondance.
 *
 * Similarité de deux scènes (0 à 1), indices pondérés :
 * - lieu (0,30) : mots du lieu en commun (Jaccard), identique = 1 ;
 * - INT/EXT (0,05) et moment (0,05) ;
 * - personnages qui parlent (0,15) : Jaccard ;
 * - texte (0,45) : coefficient de Dice sur les suites de trois mots (mots isolés si la scène est courte).
 * Alignement dans l'ordre par programmation dynamique (somme des similarités maximale, seuil 0,35),
 * puis seconde passe pour les scènes déplacées (similarité forte, 0,6).
 */
import { scenesOf, type Scene } from './fountain';
import { fold } from './text';

interface Features {
  loc: Set<string>;
  intExt?: string;
  effect?: string;
  speakers: Set<string>;
  grams: Set<string>;
  body: string;
}

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** En-tête sans ses numéros de scène (« 12. INT. GARE - JOUR 12 ») ni variations d'espaces : une renumérotation n'est pas une révision. */
const bareHeading = (h: string) => words(h.replace(/^\s*\d+[A-Z]?[.)-]?\s+/, '').replace(/\s+\d+[A-Z]?\.?\s*$/, '')).join(' ');

function featuresOf(source: string, sc: Scene): Features {
  const body = source.slice(sc.start, sc.end).split('\n').slice(1).join('\n');
  const w = words(body);
  const grams = new Set<string>();
  if (w.length < 6) w.forEach((x) => grams.add(x));
  else for (let i = 0; i + 2 < w.length; i++) grams.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return { loc: new Set(words(sc.location)), intExt: sc.intExt, effect: sc.effect, speakers: new Set(sc.speakers.map(fold)), grams, body: w.join(' ') };
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 1;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

const dice = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 1;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
};

export function sceneSimilarity(a: Features, b: Features): number {
  return 0.3 * jaccard(a.loc, b.loc) + 0.05 * (a.intExt === b.intExt ? 1 : 0) + 0.05 * (a.effect === b.effect ? 1 : 0) + 0.15 * jaccard(a.speakers, b.speakers) + 0.45 * dice(a.grams, b.grams);
}

export interface SceneMatch {
  /** Indice de la scène dans l'ancien texte, dans le nouveau. */
  from: number;
  to: number;
  similarity: number;
  /** Texte identique (en-tête et corps). */
  same: boolean;
}

export interface SceneAlignment {
  oldScenes: Scene[];
  newScenes: Scene[];
  matches: SceneMatch[];
  /** Scènes nouvelles sans correspondance. */
  added: number[];
  /** Scènes anciennes disparues. */
  removed: number[];
}

const THRESHOLD = 0.35;
const MOVED = 0.6;

export function alignScenes(before: string, after: string): SceneAlignment {
  const oldScenes = scenesOf(before);
  const newScenes = scenesOf(after);
  const A = oldScenes.map((s) => featuresOf(before, s));
  const B = newScenes.map((s) => featuresOf(after, s));
  const sim = A.map((a) => B.map((b) => sceneSimilarity(a, b)));
  // Programmation dynamique : meilleur appariement dans l'ordre.
  const n = A.length;
  const m = B.length;
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const pair = sim[i][j] >= THRESHOLD ? sim[i][j] + score[i + 1][j + 1] : -Infinity;
      score[i][j] = Math.max(pair, score[i + 1][j], score[i][j + 1]);
    }
  const matches: SceneMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sim[i][j] >= THRESHOLD && score[i][j] === sim[i][j] + score[i + 1][j + 1]) {
      matches.push({ from: i, to: j, similarity: sim[i][j], same: false });
      i++;
      j++;
    } else if (score[i][j] === score[i + 1][j]) i++;
    else j++;
  }
  // Scènes déplacées : appariement fort hors de l'ordre, la meilleure paire d'abord.
  const usedA = new Set(matches.map((x) => x.from));
  const usedB = new Set(matches.map((x) => x.to));
  const loose: Array<[number, number, number]> = [];
  for (let a = 0; a < n; a++) if (!usedA.has(a)) for (let b = 0; b < m; b++) if (!usedB.has(b) && sim[a][b] >= MOVED) loose.push([sim[a][b], a, b]);
  loose.sort((x, y) => y[0] - x[0]);
  for (const [s, a, b] of loose) {
    if (usedA.has(a) || usedB.has(b)) continue;
    usedA.add(a);
    usedB.add(b);
    matches.push({ from: a, to: b, similarity: s, same: false });
  }
  for (const x of matches) x.same = bareHeading(oldScenes[x.from].heading) === bareHeading(newScenes[x.to].heading) && A[x.from].body === B[x.to].body;
  matches.sort((x, y) => x.to - y.to);
  return {
    oldScenes,
    newScenes,
    matches,
    added: newScenes.map((_, k) => k).filter((k) => !usedB.has(k)),
    removed: oldScenes.map((_, k) => k).filter((k) => !usedA.has(k)),
  };
}
