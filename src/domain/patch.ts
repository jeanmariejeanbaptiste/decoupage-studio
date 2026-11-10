/**
 * Différences entre deux versions du projet, pour le travail à plusieurs : seules les valeurs
 * modifiées circulent (chemin → nouvelle valeur), champ par champ. Les versions successives
 * partagent leur structure (immer) : on ne descend que là où une référence a changé.
 */

export type Path = Array<string | number>;
export type Op =
  | { p: Path; v: unknown }
  | { p: Path; del: true }
  /** Liste d'identifiants : `ins` placé après `after` (null : en tête). */
  | { p: Path; ins: string; after: string | null }
  /** Liste d'identifiants : `rm` retiré. */
  | { p: Path; rm: string };

export interface DiffOptions {
  /**
   * Listes d'identifiants (`shotIds`, `sequenceIds`…) décrites par insertions et retraits plutôt que
   * remplacées : deux plans ajoutés en même temps par deux participants ne s'écrasent pas.
   */
  idLists?: boolean;
}

/** Liste d'identifiants : clé en « Ids », chaînes toutes distinctes. */
const isIdList = (path: Path, x: unknown[]) => {
  const k = path[path.length - 1];
  return typeof k === 'string' && k.endsWith('Ids') && x.every((v) => typeof v === 'string') && new Set(x).size === x.length;
};

/** Insertions et retraits qui mènent de `a` à `b`, si l'ordre des éléments communs n'a pas changé. */
function listOps(path: Path, a: string[], b: string[]): Op[] | null {
  const inB = new Set(b);
  const inA = new Set(a);
  const keptA = a.filter((x) => inB.has(x));
  const keptB = b.filter((x) => inA.has(x));
  if (keptA.some((x, i) => x !== keptB[i])) return null;
  const out: Op[] = a.filter((x) => !inB.has(x)).map((rm) => ({ p: path, rm }));
  b.forEach((x, i) => {
    if (!inA.has(x)) out.push({ p: path, ins: x, after: i > 0 ? b[i - 1] : null });
  });
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Opérations qui transforment `a` en `b`. Les tableaux modifiés sont remplacés d'un bloc. */
export function diff(a: unknown, b: unknown, path: Path = [], out: Op[] = [], opts: DiffOptions = {}): Op[] {
  if (a === b) return out;
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push({ p: [...path, k], v: b[k] });
      else diff(a[k], b[k], [...path, k], out, opts);
    }
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ p: [...path, k], del: true });
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && b.every((x) => typeof x !== 'object' || x === null) === false) {
    // Tableau d'objets de même longueur : on descend élément par élément.
    b.forEach((x, i) => diff(a[i], x, [...path, i], out, opts));
    return out;
  }
  if (opts.idLists && Array.isArray(a) && Array.isArray(b) && isIdList(path, a) && isIdList(path, b)) {
    const ops = listOps(path, a as string[], b as string[]);
    if (ops) {
      out.push(...ops);
      return out;
    }
  }
  out.push({ p: path, v: b });
  return out;
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Applique des opérations sur un objet (à appeler dans une recette immer). */
export function apply(target: Record<string, unknown>, ops: readonly Op[]): void {
  for (const op of ops) {
    // Chemin reçu d'un autre ordinateur : jamais vers les prototypes (pollution de tout l'onglet).
    if (!op.p.length || op.p.some((k) => (typeof k !== 'string' && typeof k !== 'number') || FORBIDDEN.has(k as string))) continue;
    let node: unknown = target;
    let missing = false;
    for (let i = 0; i < op.p.length - 1; i++) {
      const k = op.p[i];
      const o = node as Record<string | number, unknown>;
      // Élément disparu de ce côté (plan supprimé pendant qu'un autre le modifiait) : on ne le
      // recrée pas à moitié, la modification est ignorée.
      if (!Object.hasOwn(o, k) || o[k] === undefined || o[k] === null || typeof o[k] !== 'object') {
        missing = true;
        break;
      }
      node = o[k];
    }
    if (missing) continue;
    const last = op.p[op.p.length - 1];
    const o = node as Record<string | number, unknown>;
    if ('ins' in op || 'rm' in op) {
      const list = Object.hasOwn(o, last) ? o[last] : undefined;
      if (!Array.isArray(list)) continue;
      if ('rm' in op) {
        const i = list.indexOf(op.rm);
        if (i >= 0) list.splice(i, 1);
        continue;
      }
      if (typeof op.ins !== 'string' || list.includes(op.ins)) continue;
      // Ancre disparue de ce côté : en fin de liste, rien ne se perd.
      const at = op.after === null ? 0 : list.indexOf(op.after) + 1 || list.length;
      list.splice(at, 0, op.ins);
    } else if ('del' in op) delete o[last];
    else o[last] = structuredClone(op.v);
  }
}
