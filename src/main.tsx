import { useUi } from './store/uiStore';
import { recoverStaleChunk } from './ui/staleChunk';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/tokens.css';
import './styles/paper.css';
import './styles/print.css';
import { App } from './app/App';
import { checkInvariants } from './domain/ops';
import { mutateDoc, useProjectStore } from './store/projectStore';
import { applyTemplate } from './domain/production';
import { todayIso } from './domain/calendar';

// Accès de diagnostic (tests de bout en bout, console).
(window as unknown as { __ds: unknown }).__ds = {
  doc: () => useProjectStore.getState().doc,
  /** Calendrier de production type (tests de bout en bout : il n'est plus proposé à l'écran). */
  productionTemplate: () => mutateDoc((d) => applyTemplate(d, todayIso())),
  invariants: () => {
    const d = useProjectStore.getState().doc;
    return d ? checkInvariants(d) : ['aucun projet'];
  },
};

// Après une mise en ligne, une page restée ouverte réclame d'anciens modules (export Excel, PDF…)
// qui n'existent plus : on recharge une fois l'application pour récupérer la nouvelle version.
window.addEventListener('vite:preloadError', (e) => {
  if (recoverStaleChunk((e as Event & { payload?: unknown }).payload ?? new Error('dynamically imported module'))) e.preventDefault();
});
window.addEventListener('unhandledrejection', (e) => {
  if (recoverStaleChunk(e.reason)) e.preventDefault();
});

// Projets gardés durablement par le navigateur (Safari efface sinon les données d'un site inactif).
void navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Nouvelle version publiée pendant que la page est ouverte : on le signale, rechargement en un clic.
if (import.meta.env.PROD) {
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src');
  let warned = false;
  const check = async () => {
    if (warned || !current) return;
    try {
      const html = await (await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' })).text();
      const latest = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html)?.[1];
      if (latest && latest !== current) {
        warned = true;
        useUi.getState().toast({ message: 'Nouvelle version disponible.', actionLabel: 'Recharger', action: () => window.location.reload(), duration: 600_000 });
      }
    } catch {
      /* hors ligne : on réessaiera */
    }
  };
  setInterval(() => void check(), 120_000);
  window.addEventListener('focus', () => void check());
}

if (import.meta.env.PROD && 'serviceWorker' in navigator && !navigator.webdriver) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
