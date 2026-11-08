import { useEffect, useState } from 'react';

const QUERY = '(max-width: 700px)';

/** Écran de téléphone ? (largeur) — suit les changements d'orientation et de taille de fenêtre. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setMobile(mq.matches);
    on();
    // Safari < 14 : addListener seulement.
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);
  return mobile;
}
