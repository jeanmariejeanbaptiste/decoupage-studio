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
