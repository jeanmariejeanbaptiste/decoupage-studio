export const APP_NAME = 'Découpage Studio';

/**
 * Identifiant d'application Google (OAuth, type « Application Web ») pour la synchronisation Drive.
 * Vide : la connexion n'est pas proposée. Se règle au déploiement (variable VITE_GOOGLE_CLIENT_ID).
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
