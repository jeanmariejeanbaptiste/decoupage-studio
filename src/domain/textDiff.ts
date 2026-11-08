/**
 * Correspondance des positions entre deux versions d'un texte : comparaison ligne à ligne
 * (algorithme de Myers), puis caractère à caractère dans chaque zone modifiée. Plusieurs
 * modifications éloignées (scénario révisé, deux corrections) ne déplacent pas les passages intacts.
 */

interface Run {
  /** Première ligne commune dans chaque version, et nombre de lignes communes. */
  a: number;
  b: number;
  n: number;
}

/** Suites de lignes identiques (diff de Myers, borné en nombre de modifications). */
export function equalRuns(A: readonly string[], B: readonly string[], maxD = 4000): Run[] | null {
  const N = A.length;
  const M = B.length;
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      next[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
    v = next;
    if (found >= 0) {
      trace.push(v.slice());
      break;
    }
  }
  if (found < 0) return null;
  // Remontée : on relève les diagonales (lignes égales).
  const runs: Run[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const px = vv[off + prevK];
    const py = px - prevK;
    const sx = prevK === k + 1 ? px : px + 1;
    const sy = sx - k;
    if (x > sx) runs.push({ a: sx, b: sy, n: x - sx });
    x = px;
    y = py;
  }
  if (x > 0) runs.push({ a: 0, b: 0, n: x });
  return runs.reverse();
}

function lineStarts(s: string): number[] {
  const out = [0];
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') out.push(i + 1);
  return out;
}

const lineAt = (starts: readonly number[], pos: number) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Zone modifiée entre deux textes (préfixe et suffixe communs). */
export function diffRange(a: string, b: string): { at: number; removed: number; inserted: number } {
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { at: p, removed: a.length - p - s, inserted: b.length - p - s };
}

/**
 * Position après une modification [at, at + removed) → inserted caractères. Pour un ajout pur à la
 * position d'un début de passage, le passage se décale (le texte ajouté le précède) ; pour une fin,
 * il reste en place (le texte ajouté le suit).
 */
export function shiftOffset(pos: number, at: number, removed: number, inserted: number, edge: 'start' | 'end' = 'end'): number {
  if (removed === 0) return (edge === 'start' ? pos >= at : pos > at) ? pos + inserted : pos;
  if (pos <= at) return pos;
  if (pos >= at + removed) return pos + inserted - removed;
  return edge === 'start' ? at + inserted : at + inserted;
}

/** Fonction de correspondance des positions de `before` vers `after`. */
export function offsetMapper(before: string, after: string): (pos: number, edge?: 'start' | 'end') => number {
  if (before === after) return (p) => p;
  const A = before.split('\n');
  const B = after.split('\n');
  const runs = equalRuns(A, B);
  if (!runs) {
    const r = diffRange(before, after);
    return (p, edge = 'end') => shiftOffset(p, r.at, r.removed, r.inserted, edge);
  }
  const sa = lineStarts(before);
  const sb = lineStarts(after);
  const lineStartA = (i: number) => (i < sa.length ? sa[i] : before.length + 1);
  const lineStartB = (j: number) => (j < sb.length ? sb[j] : after.length + 1);
  return (pos, edge = 'end') => {
    const p = Math.max(0, Math.min(pos, before.length));
    const i = lineAt(sa, p);
    const col = p - sa[i];
    // Ligne intacte : même colonne dans la ligne correspondante.
    let prev: Run | undefined;
    for (const r of runs) {
      if (i >= r.a && i < r.a + r.n) return Math.min(after.length, sb[r.b + (i - r.a)] + col);
      if (r.a > i) break;
      prev = r;
    }
    // Ligne modifiée : comparaison caractère à caractère dans la zone entre deux suites intactes.
    const next = runs.find((r) => r.a > i);
    const a0 = prev ? prev.a + prev.n : 0;
    const b0 = prev ? prev.b + prev.n : 0;
    const a1 = next ? next.a : A.length;
    const b1 = next ? next.b : B.length;
    const hs = lineStartA(a0);
    const he = Math.min(before.length, lineStartA(a1));
    const ks = lineStartB(b0);
    const ke = Math.min(after.length, lineStartB(b1));
    const r = diffRange(before.slice(hs, he), after.slice(ks, ke));
    return Math.min(after.length, ks + shiftOffset(p - hs, r.at, r.removed, r.inserted, edge));
  };
}
