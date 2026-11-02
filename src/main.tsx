import { recoverStaleChunk } from './ui/staleChunk';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/tokens.css';
import './styles/paper.css';
import './styles/print.css';
import { App } from './app/App';
import { checkInvariants } from './domain/ops';
import { useProjectStore } from './store/projectStore';

// Accès de diagnostic (tests de bout en bout, console).
(window as unknown as { __ds: unknown }).__ds = {
  doc: () => useProjectStore.getState().doc,
  invariants: () => {
    const d = useProjectStore.getState().doc;
    return d ? checkInvariants(d) : ['aucun projet'];
  },
};

// Après une mise en ligne, une page restée ouverte réclame d'anciens modules (export Excel, PDF…)
// qui n'existent plus : on recharge une fois l'application pour récupérer la nouvelle version.
window.addEventListener('vite:preloadError', (e) => {
  if (sessionStorage.getItem('ds-reloaded') === '1') return;
  e.preventDefault();
  sessionStorage.setItem('ds-reloaded', '1');
  window.location.reload();
});
window.addEventListener('unhandledrejection', (e) => {
  if (recoverStaleChunk(e.reason)) e.preventDefault();
});
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('ds-reloaded'), 10_000));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator && !navigator.webdriver) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
