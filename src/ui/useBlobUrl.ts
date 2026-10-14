import { useEffect, useState } from 'react';
import { getBlob } from '../store/db';

/** URL d'objet d'un blob stocké en IndexedDB (révoquée au démontage). */
export function useBlobUrl(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    setUrl(null);
    if (key)
      void getBlob(key).then((b) => {
        if (b && alive) {
          u = URL.createObjectURL(b);
          setUrl(u);
        }
      });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [key]);
  return url;
}
