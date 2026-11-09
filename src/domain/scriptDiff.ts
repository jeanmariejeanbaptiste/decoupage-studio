/**
 * Comparaison de deux versions d'un scénario (à la manière de « Comparer les versions de script » de
 * KIT Scenarist) : le texte entier d'une version, avec ce qui a changé par rapport à une autre.
 *
 * Trois niveaux, du plus large au plus fin :
 * 1. séquences : rapprochées par `alignScenes` (lieu, texte, personnages, ordre), y compris déplacées ;
 *    une séquence est déplacée quand elle sort de la plus longue suite qui garde l'ordre ;
 * 2. blocs d'une séquence (action, personnage, réplique…) : plus longue suite commune de blocs
 *    identiques (même type, même texte imprimé), puis, entre deux blocs communs, appariement des blocs
 *    retirés et ajoutés de même type qui se ressemblent (bloc modifié) ;
 * 3. mots d'un bloc modifié : plus longue suite commune de mots, puis les petits îlots inchangés pris
 *    entre deux changements y sont fondus, pour lire « ancienne phrase → nouvelle phrase » et non une
 *    mosaïque de fragments.
 *
 * Seul le texte imprimé compte : page de titre, notes, parties, résumés et marques d'emphase ou de
 * surlignage ne s'impriment pas et ne sont pas comparés. « Avant » est la version de référence,
 * « après » la version lue (ses numéros de séquence, dérivés de l'ordre, sont ceux affichés).
 */
import { chronoOf, chronoTimeline, stripMarks, type ScriptChrono } from './chronometry';
import { alignScenes } from './sceneAlign';
import { blocksFromSource, isEmptyBlock, type BlockType, type SBlock } from './screenplay';
import { NOT_PRINTED, SCRIPT_COLUMNS, printable, scriptOutline } from './scriptLayout';
import { fold } from './text';
import { equalRuns } from './textDiff';

export type SegOp = 'eq' | 'add' | 'del';
/** Morceau de texte d'un bloc : inchangé, ajouté ou retiré. */
export interface Seg {
  op: SegOp;
  text: string;
}

export type BlockOp = 'eq' | 'add' | 'del' | 'mod';
export interface BlockDiff {
  op: BlockOp;
  type: BlockType;
  /** Texte en morceaux : un seul pour un bloc identique, ajouté ou retiré ; mot à mot pour un bloc modifié. */
  segs: Seg[];
}

export type SceneStatus = 'same' | 'changed' | 'added' | 'removed' | 'moved';
export interface SceneDiff {
  status: SceneStatus;
  /** Numéro dans la version lue (absent pour une séquence retirée). */
  after?: number;
  /** Numéro dans la version de référence (absent pour une séquence ajoutée). */
  before?: number;
  /** Déplacée : sa place dans l'ordre a changé (son texte a pu changer aussi). */
  moved: boolean;
  /** Texte modifié (au moins un bloc). */
  changed: boolean;
  /** Blocs, l'en-tête d'abord (sauf pour le texte qui précède la première séquence). */
  blocks: BlockDiff[];
  /** Texte placé avant la première séquence. */
  prelude?: boolean;
}

export interface VersionMeasure {
  scenes: number;
  pages: number;
  /** Durée estimée (secondes), minutage du projet : celui de la barre du scénario. */
  seconds: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  /** Séquences communes dont le texte a changé (déplacées comprises). */
  changed: number;
  moved: number;
  wordsAdded: number;
  wordsRemoved: number;
  before: VersionMeasure;
  after: VersionMeasure;
}

/** Point de passage pour aller d'un changement à l'autre : séquence et premier bloc du changement. */
export interface ChangeStop {
  scene: number;
  block: number;
}

export interface ScriptDiff {
  scenes: SceneDiff[];
  stats: DiffStats;
  changes: ChangeStop[];
}

// --- Mots ---------------------------------------------------------------------------------------

interface Token {
  /** Ce qui se compare : un mot (apostrophes et traits d'union compris) ou un signe. */
  core: string;
  /** Le mot et l'espace qui le suit, tels qu'ils s'affichent. */
  text: string;
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
const isWord = (core: string) => /[\p{L}\p{N}]/u.test(core);

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let lead = '';
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (out.length) out[out.length - 1].text += text.slice(last, at);
    else lead = text.slice(0, at);
    out.push({ core: m[0], text: m[0] });
    last = at + m[0].length;
  }
  if (out.length) {
    out[out.length - 1].text += text.slice(last);
    out[0].text = lead + out[0].text;
  }
  return out;
}

/** Mots (au sens de l'auteur : pas les signes) d'un texte. */
export const countWordsOf = (text: string) => tokenize(text).filter((t) => isWord(t.core)).length;

/** Morceaux contigus de même nature réunis. Un ajout ou un retrait garde l'espace qui le suit (à l'affichage, il n'est pas marqué). */
function tidy(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.op === s.op) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** Un morceau en trois : espaces de tête, texte marqué, espaces de queue (les espaces ne se soulignent ni ne se barrent). */
export function edges(text: string): [string, string, string] {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return [m[1], m[2], m[3]];
}

interface Piece {
  op: SegOp;
  toks: Token[];
}

const coreLen = (toks: readonly Token[]) => toks.reduce((n, t) => n + t.core.length, 0);
const wordsIn = (toks: readonly Token[]) => toks.filter((t) => isWord(t.core)).length;

/**
 * Différence mot à mot de deux textes. Les îlots inchangés d'au plus deux mots, pris entre deux
 * changements et plus courts qu'eux, rejoignent le changement (lu en entier : barré, puis souligné).
 */
export function wordDiff(before: string, after: string): Seg[] {
  const A = tokenize(before);
  const B = tokenize(after);
  const runs = A.length * B.length > 4_000_000 ? null : equalRuns(A.map((t) => t.core), B.map((t) => t.core), 2000);
  if (!runs) return tidy([{ op: 'del', text: before }, { op: 'add', text: after }]);
  // Suite de zones : changement (retraits, ajouts) / commun.
  const zones: Array<{ eq?: Token[]; del: Token[]; add: Token[] }> = [];
  let i = 0;
  let j = 0;
  const change = (di: number, dj: number) => {
    if (di === i && dj === j) return;
    zones.push({ del: A.slice(i, di), add: B.slice(j, dj) });
  };
  for (const r of runs) {
    change(r.a, r.b);
    zones.push({ eq: B.slice(r.b, r.b + r.n), del: [], add: [] });
    i = r.a + r.n;
    j = r.b + r.n;
  }
  change(A.length, B.length);
  // Îlots inchangés fondus dans les changements qui les entourent, jusqu'à stabilité.
  let merged = true;
  while (merged) {
    merged = false;
    for (let k = 1; k + 1 < zones.length; k++) {
      const z = zones[k];
      const p = zones[k - 1];
      const n = zones[k + 1];
      if (!z.eq || p.eq || n.eq) continue;
      const island = coreLen(z.eq);
      const around = Math.max(coreLen(p.del) + coreLen(p.add), coreLen(n.del) + coreLen(n.add));
      if (wordsIn(z.eq) <= 2 && island <= around) {
        zones.splice(k - 1, 3, { del: [...p.del, ...z.eq, ...n.del], add: [...p.add, ...z.eq, ...n.add] });
        merged = true;
        break;
      }
    }
  }
  const pieces: Piece[] = [];
  for (const z of zones) {
    if (z.eq) pieces.push({ op: 'eq', toks: z.eq });
    else {
      if (z.del.length) pieces.push({ op: 'del', toks: z.del });
      if (z.add.length) pieces.push({ op: 'add', toks: z.add });
    }
  }
  return tidy(pieces.map((p) => ({ op: p.op, text: p.toks.map((t) => t.text).join('') })));
}

// --- Blocs --------------------------------------------------------------------------------------

/** Types imprimés en capitales : la casse saisie n'y change rien. */
const UPPER = (t: BlockType) => !!SCRIPT_COLUMNS[t].upper;

interface CBlock {
  type: BlockType;
  /** Texte imprimé (sans marques). */
  text: string;
  key: string;
  bag: Map<string, number>;
}

/** En-tête sans son numéro écrit (« 12. INT. GARE - JOUR 12 », « #12A# ») : le numéro affiché est dérivé de l'ordre. */
const bareHeading = (h: string) => h.replace(/^\s*\d+[A-Z]?[.)-]?\s+/, '').replace(/\s+#[^#\s]+#\s*$/, '').replace(/\s+\d+[A-Z]?\.?\s*$/, '');

const printedOf = (b: SBlock) => {
  const t = printable(stripMarks(b.text)).replace(/[^\S\n]+$/gm, '').replace(/^\n+|\n+$/g, '');
  return b.type === 'heading' ? bareHeading(t) : t;
};

function cblock(b: SBlock): CBlock {
  const text = printedOf(b);
  const norm = (UPPER(b.type) ? text.toLocaleUpperCase('fr') : text).replace(/\s+/g, ' ').trim();
  const bag = new Map<string, number>();
  for (const t of tokenize(fold(text))) if (isWord(t.core)) bag.set(t.core, (bag.get(t.core) ?? 0) + 1);
  return { type: b.type, text, key: `${b.type}\u0001${norm}`, bag };
}

/** Ressemblance de deux blocs (Dice sur les mots, 0 à 1). */
function likeness(a: CBlock, b: CBlock): number {
  if (a.type !== b.type) return 0;
  let n = 0;
  let total = 0;
  for (const [w, c] of a.bag) {
    n += Math.min(c, b.bag.get(w) ?? 0);
    total += c;
  }
  for (const c of b.bag.values()) total += c;
  return total ? (2 * n) / total : 1;
}

const LIKE = 0.3;

const whole = (op: 'eq' | 'add' | 'del', b: CBlock): BlockDiff => ({ op, type: b.type, segs: [{ op, text: b.text }] });

function modified(a: CBlock, b: CBlock): BlockDiff {
  const segs = wordDiff(a.text, b.text);
  return segs.every((s) => s.op === 'eq') ? { op: 'eq', type: b.type, segs: [{ op: 'eq', text: b.text }] } : { op: 'mod', type: b.type, segs };
}

/** Retraits et ajouts entre deux blocs communs : les paires qui se ressemblent deviennent des blocs modifiés (ordre gardé). */
function pairGap(D: CBlock[], I: CBlock[]): BlockDiff[] {
  const n = D.length;
  const m = I.length;
  const pairs: Array<[number, number]> = [];
  if (n && m) {
    if (n * m <= 40_000) {
      const sim = D.map((d) => I.map((x) => likeness(d, x)));
      const best: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
      for (let a = n - 1; a >= 0; a--)
        for (let b = m - 1; b >= 0; b--) best[a][b] = Math.max(sim[a][b] >= LIKE ? sim[a][b] + best[a + 1][b + 1] : -1, best[a + 1][b], best[a][b + 1]);
      let a = 0;
      let b = 0;
      while (a < n && b < m) {
        if (sim[a][b] >= LIKE && best[a][b] === sim[a][b] + best[a + 1][b + 1]) {
          pairs.push([a, b]);
          a++;
          b++;
        } else if (best[a][b] === best[a + 1][b]) a++;
        else b++;
      }
    } else {
      // Très grand écart (texte réécrit d'un bloc) : appariement glouton dans l'ordre.
      let b = 0;
      for (let a = 0; a < n && b < m; a++)
        for (let k = b; k < Math.min(m, b + 50); k++)
          if (likeness(D[a], I[k]) >= LIKE) {
            pairs.push([a, k]);
            b = k + 1;
            break;
          }
    }
  }
  const out: BlockDiff[] = [];
  let a = 0;
  let b = 0;
  for (const [pa, pb] of pairs) {
    while (a < pa) out.push(whole('del', D[a++]));
    while (b < pb) out.push(whole('add', I[b++]));
    out.push(modified(D[a++], I[b++]));
  }
  while (a < n) out.push(whole('del', D[a++]));
  while (b < m) out.push(whole('add', I[b++]));
  return out;
}

/** Différence de deux suites de blocs (corps d'une séquence). */
export function diffBlocks(before: readonly SBlock[], after: readonly SBlock[]): BlockDiff[] {
  const A = before.map(cblock);
  const B = after.map(cblock);
  const runs = equalRuns(A.map((x) => x.key), B.map((x) => x.key), 3000) ?? [];
  const out: BlockDiff[] = [];
  let i = 0;
  let j = 0;
  for (const r of runs) {
    out.push(...pairGap(A.slice(i, r.a), B.slice(j, r.b)));
    for (let k = 0; k < r.n; k++) out.push(whole('eq', B[r.b + k]));
    i = r.a + r.n;
    j = r.b + r.n;
  }
  out.push(...pairGap(A.slice(i), B.slice(j)));
  return out;
}

// --- Séquences ----------------------------------------------------------------------------------

const compared = (b: SBlock) => b.type !== 'title' && b.type !== 'pagebreak' && !NOT_PRINTED.has(b.type) && !isEmptyBlock(b);

/** Blocs comparés : le texte avant la première séquence, puis chaque séquence (en-tête d'abord). */
function scenesFromBlocks(blocks: readonly SBlock[]): { prelude: SBlock[]; scenes: SBlock[][] } {
  const prelude: SBlock[] = [];
  const scenes: SBlock[][] = [];
  for (const b of blocks) {
    if (b.type === 'heading') scenes.push([b]);
    else if (compared(b)) (scenes.length ? scenes[scenes.length - 1] : prelude).push(b);
  }
  return { prelude, scenes };
}

/** Séquences rapprochées hors de l'ordre : celles qui sortent de la plus longue suite croissante. */
function movedSet(matches: ReadonlyArray<{ from: number; to: number }>): Set<number> {
  const seq = [...matches].sort((x, y) => x.to - y.to);
  const tails: number[] = [];
  const prev: number[] = new Array<number>(seq.length).fill(-1);
  for (let k = 0; k < seq.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]].from < seq[k].from) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const keep = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(seq[k].to);
  return new Set(seq.filter((x) => !keep.has(x.to)).map((x) => x.to));
}

function measure(blocks: readonly SBlock[], scenes: number, c: ScriptChrono): VersionMeasure {
  return { scenes, pages: scriptOutline(blocks).pages, seconds: Math.round(chronoTimeline(blocks, c).total) };
}

const changedBlocks = (bs: readonly BlockDiff[]) => bs.some((b) => b.op !== 'eq');

/**
 * Compare deux textes Fountain : `before` (la version de référence) et `after` (la version lue).
 * `chrono` : réglage du minutage du projet (durées avant / après).
 */
export function diffScripts(before: string, after: string, chrono?: Partial<ScriptChrono>): ScriptDiff {
  const c = chronoOf(chrono);
  const bb = blocksFromSource(before).blocks;
  const ab = blocksFromSource(after).blocks;
  const B = scenesFromBlocks(bb);
  const A = scenesFromBlocks(ab);
  const al = alignScenes(before, after);
  const moved = movedSet(al.matches);
  const byTo = new Map(al.matches.map((x) => [x.to, x.from]));
  const removed = new Set(al.removed);

  const scenes: SceneDiff[] = [];
  const preludeBlocks = diffBlocks(B.prelude, A.prelude);
  if (preludeBlocks.length) scenes.push({ status: changedBlocks(preludeBlocks) ? 'changed' : 'same', moved: false, changed: changedBlocks(preludeBlocks), blocks: preludeBlocks, prelude: true });

  const emitRemoved = (k: number) => {
    removed.delete(k);
    const bl = (B.scenes[k] ?? []).map((x) => whole('del', cblock(x)));
    scenes.push({ status: 'removed', before: k + 1, moved: false, changed: true, blocks: bl });
  };
  const sceneCount = Math.max(A.scenes.length, al.newScenes.length);
  for (let t = 0; t < sceneCount; t++) {
    const from = byTo.get(t);
    const own = A.scenes[t] ?? [];
    if (from === undefined) {
      scenes.push({ status: 'added', after: t + 1, moved: false, changed: true, blocks: own.map((x) => whole('add', cblock(x))) });
      continue;
    }
    const isMoved = moved.has(t);
    // Séquences retirées qui venaient avant celle-ci : à leur place, juste avant.
    if (!isMoved) for (const k of [...removed].sort((x, y) => x - y)) if (k < from) emitRemoved(k);
    const old = B.scenes[from] ?? [];
    const head: BlockDiff[] = own[0] && old[0] ? [modified(cblock(old[0]), cblock(own[0]))] : [];
    const body = diffBlocks(old.slice(1), own.slice(1));
    const blocks = [...head, ...body];
    const changed = changedBlocks(blocks);
    scenes.push({ status: isMoved ? 'moved' : changed ? 'changed' : 'same', after: t + 1, before: from + 1, moved: isMoved, changed, blocks });
  }
  for (const k of [...removed].sort((x, y) => x - y)) emitRemoved(k);

  // Statistiques et points de passage.
  let wordsAdded = 0;
  let wordsRemoved = 0;
  const changes: ChangeStop[] = [];
  scenes.forEach((sc, si) => {
    let inChange = false;
    sc.blocks.forEach((b, bi) => {
      for (const s of b.segs) {
        if (s.op === 'add') wordsAdded += countWordsOf(s.text);
        if (s.op === 'del') wordsRemoved += countWordsOf(s.text);
      }
      const ch = sc.status === 'added' || sc.status === 'removed' ? bi === 0 : b.op !== 'eq';
      if (ch && !inChange) changes.push({ scene: si, block: bi });
      inChange = sc.status === 'added' || sc.status === 'removed' ? true : ch;
    });
    // Séquence déplacée sans autre changement : son en-tête marque le passage.
    if (sc.moved && !changes.some((x) => x.scene === si)) changes.push({ scene: si, block: 0 });
  });
  changes.sort((x, y) => x.scene - y.scene || x.block - y.block);

  const real = scenes.filter((x) => !x.prelude);
  return {
    scenes,
    changes,
    stats: {
      added: real.filter((x) => x.status === 'added').length,
      removed: real.filter((x) => x.status === 'removed').length,
      changed: real.filter((x) => x.before && x.after && x.changed).length,
      moved: real.filter((x) => x.moved).length,
      wordsAdded,
      wordsRemoved,
      before: measure(bb, B.scenes.length, c),
      after: measure(ab, A.scenes.length, c),
    },
  };
}

// --- Lecture : séquences identiques repliées ------------------------------------------------------

export type DiffItem = { kind: 'scene'; index: number } | { kind: 'fold'; scenes: number[]; from: number; to: number };

/**
 * Ce qui s'affiche : toutes les séquences, ou seulement celles qui ont changé (les identiques qui se
 * suivent repliées en une ligne, avec leurs numéros dans la version lue).
 */
export function diffItems(diff: ScriptDiff, onlyChanges: boolean): DiffItem[] {
  if (!onlyChanges) return diff.scenes.map((_, index) => ({ kind: 'scene', index }));
  const out: DiffItem[] = [];
  diff.scenes.forEach((sc, index) => {
    if (sc.status !== 'same') {
      out.push({ kind: 'scene', index });
      return;
    }
    const last = out[out.length - 1];
    const n = sc.after ?? 0;
    if (last?.kind === 'fold') {
      last.scenes.push(index);
      last.to = n || last.to;
    } else out.push({ kind: 'fold', scenes: [index], from: n, to: n });
  });
  return out;
}
