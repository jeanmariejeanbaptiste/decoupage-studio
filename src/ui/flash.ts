/**
 * Met brièvement en évidence l'élément d'arrivée d'un lien interne (vérifications → découpage,
 * registre…). La page cible peut ne pas être encore rendue : on attend qu'un des sélecteurs (dans
 * l'ordre de préférence) trouve un élément, puis on le centre et on le marque (`data-flash`, lu par
 * la feuille de style ; un attribut que React ne réécrit pas).
 */
const FLASH_MS = 1600;

export function flashWhenReady(selectors: readonly string[], onFound?: (el: HTMLElement) => void, timeoutMs = 2500): void {
  if (typeof document === 'undefined') return;
  const start = performance.now();
  const tick = () => {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      el.removeAttribute('data-flash');
      void el.offsetWidth; // relance l'animation si l'élément était déjà marqué
      el.setAttribute('data-flash', '');
      window.setTimeout(() => el.removeAttribute('data-flash'), FLASH_MS);
      onFound?.(el);
      return;
    }
    if (performance.now() - start < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
