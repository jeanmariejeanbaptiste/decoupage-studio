import { useEffect, useState } from 'react';
import { RASTER_TYPES } from '../domain/reviewSnapshot';
import { getBlob } from '../store/db';

/**
 * Type sous lequel une image se montre : une image garde le sien (un SVG reste lisible dans une balise
 * image, sans script) ; tout le reste n'est plus que des octets, jamais une page.
 */
const safeType = (t: string) => (t.startsWith('image/') ? t : 'application/octet-stream');

/** Peut s'ouvrir seule dans un onglet sans rien exécuter. */
export const openable = (t: string) => RASTER_TYPES.has(t);

/** URL d'objet d'un blob stocké en IndexedDB (révoquée au démontage), et son type. */
export function useBlob(key: string | undefined): { url: string | null; type: string } {
  const [state, setState] = useState<{ url: string | null; type: string }>({ url: null, type: '' });
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    setState({ url: null, type: '' });
    if (key)
      void getBlob(key).then((b) => {
        if (b && alive) {
          const type = safeType(b.type);
          u = URL.createObjectURL(type === b.type ? b : new Blob([b], { type }));
          setState({ url: u, type });
        }
      });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [key]);
  return state;
}

/** URL d'objet d'un blob stocké en IndexedDB (révoquée au démontage). */
export function useBlobUrl(key: string | undefined): string | null {
  return useBlob(key).url;
}
