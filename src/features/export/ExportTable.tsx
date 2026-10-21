import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_DEFS, columnWidths, tcLast } from '../../domain/columns';
import type { MergeMap, MergeRow } from '../../domain/merge';
import { cleanCuts, paginate, sliceMerges, type PageSlice } from '../../domain/pagination';
import { sequenceMerges } from '../../domain/rows';
import { computeTiming } from '../../domain/timing';
import type { ColumnKey, ExportTheme, ProjectDoc } from '../../domain/types';
import s from './ExportTable.module.css';

interface Props {
  doc: ProjectDoc;
  columns?: ColumnKey[];
  theme?: ExportTheme;
  showTitle?: boolean;
  /** Impression : pages calculées (aucune ligne ni fusion coupée par le navigateur). */
  paper?: 'A4' | 'A3';
  footer?: boolean;
  orientation?: 'landscape' | 'portrait';
  /** Marge de sécurité en bas de page (mm) : utile à l'impression Safari, nulle pour les images. */
  safety?: number;
}

const PAPER = { A4: [297, 210], A3: [420, 297] } as const;
const PAD_Y = 9; // marge haute et basse de chaque page, en mm
const PX_PER_MM = 96 / 25.4;

/** Rendu fusionné, identique à l'export (§8.2). Lecture seule. */
export function ExportTable({ doc, columns, theme, showTitle = true, paper, footer, orientation = 'landscape', safety = 12 }: Props) {
  const cols = useMemo(() => tcLast(columns ?? doc.project.settings.exportColumns), [columns, doc.project.settings.exportColumns]);
  const th = theme ?? doc.project.settings.exportTheme;
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const widths = columnWidths(cols);
  const sequences = useMemo(
    () => doc.project.sequenceIds.map((id) => ({ id, ...sequenceMerges(doc, timing, id, cols) })),
    [doc, timing, cols],
  );
  const measure = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageSlice[][] | null>(null);
  // Marge de sécurité de 12 mm : Safari ajoute ses en-têtes et pieds de page dans la page.
  const [paperW, paperH] = paper ? (orientation === 'portrait' ? [PAPER[paper][1], PAPER[paper][0]] : PAPER[paper]) : [0, 0];
  const pageH = paper ? paperH - (footer ? 10 : 0) - safety : 0;

  // Mesure le rendu continu, puis répartit les lignes en pages.
  useLayoutEffect(() => {
    if (!paper) return;
    setPages(null);
    let cancelled = false;
    const run = () => {
      const root = measure.current;
      if (cancelled || !root) return;
      const bodies = [...root.querySelectorAll<HTMLElement>('tbody')];
      const rowHeights = bodies.map((b) => [...b.querySelectorAll<HTMLElement>('tr:not([aria-hidden])')].map((r) => r.getBoundingClientRect().height));
      const gap = root.querySelector<HTMLElement>('tbody tr[aria-hidden] td')?.getBoundingClientRect().height ?? 0;
      const head = root.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const title = root.querySelector('h1');
      const titleH = title ? title.getBoundingClientRect().height + parseFloat(getComputedStyle(title).marginBottom || '0') : 0;
      const avail = (pageH - 2 * PAD_Y) * PX_PER_MM - head - 4;
      const cuts = sequences.map((q) => cleanCuts(q.merges, cols, q.rows.length));
      setPages(paginate(rowHeights, avail, { gap, firstOffset: titleH, cuttable: cuts }));
    };
    void document.fonts.ready.then(() => requestAnimationFrame(run));
    return () => {
      cancelled = true;
    };
  }, [paper, pageH, sequences, cols, showTitle]);

  const head = (
    <>
      <colgroup>
        {cols.map((c) => (
          <col key={c} style={{ width: `${widths[c]}%` }} />
        ))}
      </colgroup>
      <thead>
        {!paper && (
          <tr className={s.printSpacer} aria-hidden="true">
            <td colSpan={cols.length} />
          </tr>
        )}
        <tr>
          {cols.map((c) => (
            <th key={c} className={s[`h_${c}`]}>
              {COLUMN_DEFS[c].label}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );

  const body = (seqIdx: number, rows: MergeRow[], merges: MergeMap, last: boolean, key: string) => {
    const seq = sequences[seqIdx];
    return (
      <tbody key={key} className={s.seq}>
        {rows.map((row, i) => (
          <tr key={row.shotId} className={doc.shots[row.shotId]?.oneShot ? s.oneShot : undefined}>
            {cols.map((c) => {
              const span = merges.get(c)?.find((m) => m.startRow === i);
              if (!span) return null;
              return (
                <td key={c} rowSpan={span.span > 1 ? span.span : undefined} className={s[`c_${c}`]}>
                  {span.value}
                </td>
              );
            })}
          </tr>
        ))}
        {seq.rows.length === 0 && (
          <tr>
            <td className={s.c_sequence}>{`${seqIdx + 1}, ${doc.sequences[seq.id]?.label.toUpperCase() ?? ''}`}</td>
            {cols.slice(1).map((c) => (
              <Fragment key={c}>
                <td />
              </Fragment>
            ))}
          </tr>
        )}
        {last && (
          <tr className={s.spacer} aria-hidden="true">
            <td colSpan={cols.length} />
          </tr>
        )}
      </tbody>
    );
  };

  const sheetClass = [s.sheet, s[`theme_${th}`], doc.project.settings.exportInkSaver ? s.inkSaver : '', paper ? s.paged : ''].join(' ');
  const title = showTitle && <h1 className={s.title}>Découpage technique</h1>;

  if (paper && pages)
    return (
      <div className={sheetClass} data-theme-export={th}>
        {pages.map((page, p) => (
          <div key={p} className={s.page} style={{ width: `${paperW}mm`, height: `${pageH}mm`, padding: `${PAD_Y}mm 12mm` }} data-testid="print-page">
            {p === 0 && title}
            <table className={s.table} data-testid={p === 0 ? 'export-table' : undefined}>
              {head}
              {page.map((sl) => {
                const q = sequences[sl.seq];
                return body(sl.seq, q.rows.slice(sl.from, sl.to), sliceMerges(q.merges, cols, sl.from, sl.to), sl.to === q.rows.length, `${q.id}-${sl.from}`);
              })}
            </table>
          </div>
        ))}
      </div>
    );

  return (
    <div ref={measure} className={sheetClass} data-theme-export={th} style={paper ? { padding: '0 12mm', width: `${paperW}mm`, boxSizing: 'border-box' } : undefined}>
      {title}
      <table className={s.table} data-testid={paper ? undefined : 'export-table'}>
        {head}
        {!paper && (
          <tfoot className={s.printFoot} aria-hidden="true">
            <tr className={s.printSpacer}>
              <td colSpan={cols.length} />
            </tr>
          </tfoot>
        )}
        {sequences.map((q, i) => body(i, q.rows, q.merges, true, q.id))}
      </table>
    </div>
  );
}
