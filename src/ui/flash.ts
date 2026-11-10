/**
 * Met brièvement en évidence l'arrivée d'un lien interne (vérifications → découpage, durée estimée…). La
 * page cible peut ne pas être encore rendue : on attend qu'un des sélecteurs (dans l'ordre de
 * préférence) trouve un élément, puis on le fait venir dans la vue et on marque tous les éléments
 * de ce sélecteur (`data-flash`, lu par la feuille de style ; un attribut que React ne réécrit pas).
 */
const FLASH_MS = 1600;

function scrollable(el: HTMLElement): boolean {
  const { overflowY, overflowX } = getComputedStyle(el);
  return (/(auto|scroll)/.test(overflowY) && el.scrollHeight > el.clientHeight) || (/(auto|scroll)/.test(overflowX) && el.scrollWidth > el.clientWidth);
}

/**
 * Fait venir l'élément dans son conteneur défilant le plus proche, centré verticalement, sans
 * toucher aux conteneurs au-dessus : la grille défile, la page et sa barre d'outils restent en place.
 * Un en-tête collant (thead) est retranché de la zone visible.
 */
export function revealInScroller(el: HTMLElement): void {
  let sc = el.parentElement;
  while (sc && sc !== document.body && !scrollable(sc)) sc = sc.parentElement;
  if (!sc || sc === document.body || sc === document.documentElement) {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    return;
  }
  const box = sc.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const head = sc.querySelector<HTMLElement>(':scope > table > thead');
  const top = box.top + (head && getComputedStyle(head).position === 'sticky' ? head.offsetHeight : 0);
  const visible = box.bottom - top;
  if (r.top < top || r.bottom > box.bottom) sc.scrollTop += r.top - top - Math.max(0, (visible - r.height) / 2);
  // Horizontalement : au plus court, seulement si la cible dépasse.
  if (r.left < box.left) sc.scrollLeft += r.left - box.left - 16;
  else if (r.right > box.right) sc.scrollLeft += Math.min(r.right - box.right + 16, r.left - box.left);
}

export function flashWhenReady(selectors: readonly string[], onFound?: (el: HTMLElement) => void, timeoutMs = 2500): void {
  if (typeof document === 'undefined') return;
  const start = performance.now();
  const tick = () => {
    for (const sel of selectors) {
      const all = [...document.querySelectorAll<HTMLElement>(sel)];
      if (!all.length) continue;
      revealInScroller(all[0]);
      for (const el of all) {
        el.removeAttribute('data-flash');
        void el.offsetWidth; // relance l'animation si l'élément était déjà marqué
        el.setAttribute('data-flash', '');
        window.setTimeout(() => el.removeAttribute('data-flash'), FLASH_MS);
      }
      onFound?.(all[0]);
      return;
    }
    if (performance.now() - start < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
