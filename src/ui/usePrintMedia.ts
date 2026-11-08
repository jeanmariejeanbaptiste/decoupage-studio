import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Vrai pendant une impression (⌘P) ou un aperçu « print » : les contenus réservés à l'impression ne
 * sont montés qu'à ce moment (pas d'images chargées deux fois à l'écran).
 */
export function usePrintMedia(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('print').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('print');
    const sync = () => setOn(!!mq?.matches);
    // Avant l'impression, le rendu doit être fait tout de suite (avant la mise en page du navigateur).
    const before = () => flushSync(() => setOn(true));
    const after = () => setOn(!!mq?.matches);
    if (mq?.addEventListener) mq.addEventListener('change', sync);
    else mq?.addListener(sync);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      if (mq?.removeEventListener) mq.removeEventListener('change', sync);
      else mq?.removeListener(sync);
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return on;
}
