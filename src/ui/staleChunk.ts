import { flushSave } from '../store/persistence';

/**
 * Module introuvable après une mise en ligne (page ouverte sur l'ancienne version) : recharge
 * l'application une fois et renvoie `true` ; sinon `false`, l'erreur reste à signaler.
 */
export function recoverStaleChunk(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(msg)) return false;
  try {
    // Une fois par minute au plus : pas de boucle si le module manque vraiment.
    const last = Number(sessionStorage.getItem('ds-reloaded-at')) || 0;
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem('ds-reloaded-at', String(Date.now()));
  } catch {
    /* stockage indisponible : on recharge quand même */
  }
  // Le travail en cours est enregistré avant de recharger.
  void flushSave().finally(() => window.location.reload());
  return true;
}
