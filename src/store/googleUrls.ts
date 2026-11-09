/** Adresses et portées Google : une seule source pour la synchronisation privée et la relecture en ligne. */
export const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
export const GAPI_SCRIPT = 'https://apis.google.com/js/api.js';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Dossier privé de l'application (synchronisation des projets). */
export const SCOPE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';
/** Fichiers créés ou ouverts par l'application (relecture en ligne) : portée non sensible. */
export const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
export const SCOPE_IDENTITY = 'openid email profile';
