/**
 * Module introuvable après une mise en ligne (page ouverte sur l'ancienne version) : recharge
 * l'application une fois et renvoie `true` ; sinon `false`, l'erreur reste à signaler.
 */
export function recoverStaleChunk(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(msg)) return false;
  try {
    if (sessionStorage.getItem('ds-reloaded') === '1') return false;
    sessionStorage.setItem('ds-reloaded', '1');
  } catch {
    /* stockage indisponible : on recharge quand même */
  }
  window.location.reload();
  return true;
}
