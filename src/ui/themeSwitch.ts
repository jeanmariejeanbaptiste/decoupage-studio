import { flushSync } from 'react-dom';
import { useUi } from '../store/uiStore';

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> };
};

/**
 * Passe du jour à la nuit (et inversement) par une ouverture à l'iris : le nouveau thème se dévoile
 * en cercle depuis le point cliqué. Sans prise en charge du navigateur, ou si l'utilisateur limite
 * les animations, le changement est immédiat.
 */
export function switchTheme(from?: { clientX: number; clientY: number }) {
  const next = useUi.getState().theme === 'papier' ? 'encre' : 'papier';
  const apply = () => {
    useUi.getState().set({ theme: next });
    document.documentElement.dataset.theme = next;
  };
  const doc = document as ViewTransitionDoc;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduced) return apply();
  const x = from?.clientX ?? window.innerWidth - 60;
  const y = from?.clientY ?? 40;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = doc.startViewTransition(() => flushSync(apply));
  void t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 1100, easing: 'cubic-bezier(0.65, 0, 0.25, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}
