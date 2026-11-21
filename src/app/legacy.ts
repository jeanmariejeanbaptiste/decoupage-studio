/**
 * Anciennes adresses encore en circulation (favoris, liens) : le Registre, retiré, mène au
 * découpage. Les paramètres utiles (projet de démonstration…) sont gardés, l'onglet ne l'est pas.
 */
export function legacyHash(hash: string): string | null {
  if (!/^#\/?registry(?:[/?].*)?$/.test(hash)) return null;
  const params = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  params.delete('tab');
  const q = params.toString();
  return `#/grid${q ? `?${q}` : ''}`;
}

/** Remplace l'adresse (sans entrée d'historique : Précédent ne ramène pas à l'ancienne). */
export function redirectLegacyHash(): void {
  const to = legacyHash(window.location.hash);
  if (to) window.location.replace(to);
}
