import { useLayoutEffect, type RefObject } from 'react';

/** Écart visuel entre deux pages A4 à l'écran (px). */
const GAP = 24;
/** Éléments qui ne se coupent pas entre deux pages : une ligne de tableau, un titre, un paragraphe… */
const UNITS = 'header, h2, h3, p, tr, li, textarea, [data-a4-unit]';

/**
 * Pagination A4 à l'écran d'une feuille éditable : la feuille se découpe en pages de 297 mm (à la
 * largeur réelle de la feuille), et tout élément qui chevaucherait la fin d'une page est poussé au
 * haut de la suivante, marges comprises. Le contenu reste un seul bloc éditable.
 */
export function useA4Pages(ref: RefObject<HTMLElement>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const run = () => {
      // Remise à zéro des poussées précédentes.
      el.style.minHeight = '';
      el.querySelectorAll<HTMLElement>('[data-a4-push]').forEach((n) => {
        if (n.tagName === 'TD' || n.tagName === 'TH') n.style.paddingTop = n.dataset.a4Orig ?? '';
        else n.style.marginTop = n.dataset.a4Orig ?? '';
        delete n.dataset.a4Push;
        delete n.dataset.a4Orig;
      });
      const pageH = (el.offsetWidth * 297) / 210;
      const pitch = pageH + GAP;
      const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
      const units = [...el.querySelectorAll<HTMLElement>(UNITS)].filter((u) => !u.parentElement?.closest('tr, li, [data-a4-unit]'));
      for (let i = 0; i < units.length; i++) {
        let u = units[i];
        const top0 = el.getBoundingClientRect().top;
        const r = u.getBoundingClientRect();
        const top = r.top - top0;
        const bottom = r.bottom - top0;
        if (r.height >= pageH - 2 * pad) continue;
        const page = Math.floor(top / pitch);
        const limit = page * pitch + pageH - pad;
        if (bottom <= limit && top >= page * pitch + pad - 1) continue;
        const target = (bottom > limit ? page + 1 : page) * pitch + pad;
        let push = target - top;
        // Un titre ne reste pas seul en bas de page : il part avec ce qui le suit.
        const prev = units[i - 1];
        if (prev && /^H[23]$/.test(prev.tagName) && !prev.dataset.a4Push) {
          const pt = prev.getBoundingClientRect().top - top0;
          if (Math.floor(pt / pitch) === page) {
            u = prev;
            push = target - pt;
          }
        }
        if (push <= 0) continue;
        if (u.tagName === 'TR') {
          for (const td of u.children as HTMLCollectionOf<HTMLElement>) {
            td.dataset.a4Orig = td.style.paddingTop;
            td.dataset.a4Push = '1';
            td.style.paddingTop = `${parseFloat(getComputedStyle(td).paddingTop) + push}px`;
          }
        } else {
          u.dataset.a4Orig = u.style.marginTop;
          u.dataset.a4Push = '1';
          u.style.marginTop = `${parseFloat(getComputedStyle(u).marginTop) + push}px`;
        }
      }
      const pages = Math.max(1, Math.ceil(el.scrollHeight / pitch));
      el.style.setProperty('--a4-h', `${pageH}px`);
      el.style.setProperty('--a4-pitch', `${pitch}px`);
      el.style.minHeight = `${pages * pitch - GAP}px`;
      el.dataset.pages = String(pages);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };
    run();
    void document.fonts?.ready.then(schedule);
    window.addEventListener('resize', schedule);
    el.addEventListener('input', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      el.removeEventListener('input', schedule);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
