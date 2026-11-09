export const APP_NAME = 'Découpage Studio';

/**
 * Réglages Google, fixés au déploiement (variables du dépôt lues par deploy.yml) :
 * - VITE_GOOGLE_CLIENT_ID : identifiant OAuth (type « Application Web ») ; vide = pas de connexion ;
 * - VITE_GOOGLE_API_KEY : clé d'API (lecture des relectures publiées, sélecteur de fichiers) ;
 * - VITE_GOOGLE_APP_ID : numéro du projet Google Cloud (le même que l'identifiant OAuth).
 * Sans les trois, la relecture en ligne n'est pas proposée.
 *
 * Build sans réglage Google (tests, copie locale) : `localStorage['ds-google-config']` peut les
 * fournir ({ clientId, apiKey, appId }). Jamais lu quand le déploiement fixe un identifiant.
 */
function localConfig(): { clientId?: string; apiKey?: string; appId?: string } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ds-google-config') : null;
    const c = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (!c || typeof c !== 'object') return {};
    const str = (x: unknown) => (typeof x === 'string' ? x.trim() : undefined);
    return { clientId: str(c.clientId), apiKey: str(c.apiKey), appId: str(c.appId) };
  } catch {
    return {};
  }
}

const env = import.meta.env as Record<string, string | undefined>;
const built = !!(env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
const local = built ? {} : localConfig();

export const GOOGLE_CLIENT_ID: string = (built ? env.VITE_GOOGLE_CLIENT_ID!.trim() : local.clientId) ?? '';
export const GOOGLE_API_KEY: string = (built ? (env.VITE_GOOGLE_API_KEY ?? '').trim() : local.apiKey) ?? '';
export const GOOGLE_APP_ID: string = (built ? (env.VITE_GOOGLE_APP_ID ?? '').trim() : local.appId) ?? '';

/** Relecture en ligne (Google Drive) : seulement si les trois réglages sont là. */
export const REVIEW_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_API_KEY && GOOGLE_APP_ID);
