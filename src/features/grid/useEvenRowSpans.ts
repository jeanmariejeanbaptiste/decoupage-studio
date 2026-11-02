import { useEffect, type RefObject } from 'react';

/**
 * Une cellule fusionnée sur plusieurs lignes (séquence, TC, action liée) dont le texte dépasse la
 * hauteur cumulée de ses lignes : le navigateur donne tout l'excédent à une seule ligne, qui
 * grandit sans raison. On répartit plutôt la hauteur nécessaire à parts égales entre ces lignes.
 */
export function useEvenRowSpans(tableRef: RefObject<HTMLTableElement | null>) {
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    let frame = 0;
    const range = document.createRange();

    const apply = () => {
      frame = 0;
      const need = new Map<HTMLTableRowElement, number>();
      for (const td of table.querySelectorAll<HTMLTableCellElement>('td[rowspan]')) {
        const n = td.rowSpan;
        if (n < 2 || !td.firstChild) continue;
        range.selectNodeContents(td);
        const cs = getComputedStyle(td);
        const h = range.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 1;
        const share = Math.ceil(h / n);
        let tr = td.parentElement as HTMLTableRowElement | null;
        for (let k = 0; k < n && tr; k++, tr = tr.nextElementSibling as HTMLTableRowElement | null) {
          need.set(tr, Math.max(need.get(tr) ?? 0, share));
        }
      }
      for (const tr of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
        const v = need.get(tr);
        const next = v ? `${v}px` : '';
        if (tr.style.height !== next) tr.style.height = next;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(table);
    const mo = new MutationObserver(schedule);
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [tableRef]);
}
