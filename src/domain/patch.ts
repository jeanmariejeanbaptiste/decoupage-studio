/**
 * Différences entre deux versions du projet, pour le travail à plusieurs : seules les valeurs
 * modifiées circulent (chemin → nouvelle valeur), champ par champ. Les versions successives
 * partagent leur structure (immer) : on ne descend que là où une référence a changé.
 */

export type Path = Array<string | number>;
export type Op = { p: Path; v: unknown } | { p: Path; del: true };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Opérations qui transforment `a` en `b`. Les tableaux modifiés sont remplacés d'un bloc. */
export function diff(a: unknown, b: unknown, path: Path = [], out: Op[] = []): Op[] {
  if (a === b) return out;
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push({ p: [...path, k], v: b[k] });
      else diff(a[k], b[k], [...path, k], out);
    }
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ p: [...path, k], del: true });
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && b.every((x) => typeof x !== 'object' || x === null) === false) {
    // Tableau d'objets de même longueur : on descend élément par élément.
    b.forEach((x, i) => diff(a[i], x, [...path, i], out));
    return out;
  }
  out.push({ p: path, v: b });
  return out;
}

/** Applique des opérations sur un objet (à appeler dans une recette immer). */
export function apply(target: Record<string, unknown>, ops: readonly Op[]): void {
  for (const op of ops) {
    if (!op.p.length) continue;
    let node: unknown = target;
    let missing = false;
    for (let i = 0; i < op.p.length - 1; i++) {
      const k = op.p[i];
      const o = node as Record<string | number, unknown>;
      // Élément disparu de ce côté (plan supprimé pendant qu'un autre le modifiait) : on ne le
      // recrée pas à moitié, la modification est ignorée.
      if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') {
        missing = true;
        break;
      }
      node = o[k];
    }
    if (missing) continue;
    const last = op.p[op.p.length - 1];
    const o = node as Record<string | number, unknown>;
    if ('del' in op) delete o[last];
    else o[last] = structuredClone(op.v);
  }
}
