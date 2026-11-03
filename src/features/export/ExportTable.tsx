import { BEAT_COLUMNS } from '../../domain/oneshot';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_DEFS, columnWidths, tcLast } from '../../domain/columns';
import { displaySpan, type MergeMap, type MergeRow } from '../../domain/merge';
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
  const sequences = useMemo(
    () => doc.project.sequenceIds.map((id) => ({ id, ...sequenceMerges(doc, timing, id, cols, !!doc.project.settings.exportNoMerge, true) })),
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
      // Les sous-lignes d'un plan-séquence comptent dans la hauteur de leur plan.
      const rowHeights = bodies.map((b) =>
        [...b.querySelectorAll<HTMLElement>('tr:not([aria-hidden])')].reduce<number[]>((acc, r) => {
          const h = r.getBoundingClientRect().height;
          if (r.dataset.sub !== undefined && acc.length) acc[acc.length - 1] += h;
          else acc.push(h);
          return acc;
        }, []),
      );
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

  const head = (cs: ColumnKey[], w: Record<string, number> = columnWidths(cs)) => (
    <>
      <colgroup>
        {cs.map((c) => (
          <col key={c} style={{ width: `${w[c]}%` }} />
        ))}
      </colgroup>
      <thead>
        {!paper && (
          <tr className={s.printSpacer} aria-hidden="true">
            <td colSpan={cs.length} />
          </tr>
        )}
        <tr>
          {cs.map((c) => (
            <HeadCell key={c} className={s[`h_${c}`]} label={COLUMN_DEFS[c].label} />
          ))}
        </tr>
      </thead>
    </>
  );

  const body = (seqIdx: number, rows: MergeRow[], merges: MergeMap, last: boolean, key: string, cs: ColumnKey[] = cols) => {
    const seq = sequences[seqIdx];
    return (
      <tbody key={key} className={s.seq}>
        {rows.map((row, i) => {
          const lines = row.lines;
          const beatCell = (c: ColumnKey, k: number) => {
            const l = lines![k];
            const v = l.cells[c] ?? '';
            return (
              <td key={c} className={[s[`c_${c}`], s.beatCell, k > 0 ? s.beatNext : '', k < lines!.length - 1 ? s.beatMore : '', l.bridge ? s.bridge : ''].join(' ')}>
                {l.bridge ? (v ? <i>↳ {v}</i> : null) : (
                  <>
                    {c === BEAT_COLUMNS.find((x) => cs.includes(x)) && <b className={s.beatTag}>{l.tag}</b>}
                    {v}
                  </>
                )}
              </td>
            );
          };
          return (
            <Fragment key={row.shotId}>
              <tr className={lines ? s.oneShot : undefined}>
                {cs.map((c) => {
                  if (lines && BEAT_COLUMNS.includes(c)) return beatCell(c, 0);
                  const span = merges.get(c)?.find((m) => m.startRow === i);
                  if (!span) return null;
                  const h = displaySpan(rows, i, span.span);
                  return (
                    <td key={c} rowSpan={h > 1 ? h : undefined} className={s[`c_${c}`]}>
                      {span.value}
                    </td>
                  );
                })}
              </tr>
              {lines?.slice(1).map((_, k) => (
                <tr key={k} data-sub="" className={s.oneShot}>
                  {cs.filter((c) => BEAT_COLUMNS.includes(c)).map((c) => beatCell(c, k + 1))}
                </tr>
              ))}
            </Fragment>
          );
        })}
        {seq.rows.length === 0 && (
          <tr>
            <td className={s.c_sequence}>{`${seqIdx + 1}, ${doc.sequences[seq.id]?.label.toUpperCase() ?? ''}`}</td>
            {cs.slice(1).map((c) => (
              <Fragment key={c}>
                <td />
              </Fragment>
            ))}
          </tr>
        )}
        {last && (
          <tr className={s.spacer} aria-hidden="true">
            <td colSpan={cs.length} />
          </tr>
        )}
      </tbody>
    );
  };

  // Export intelligent : sur chaque page, les colonnes facultatives vides y sont masquées.
  const smart = !!doc.project.settings.exportSmart;
  const pageColumns = (page: PageSlice[]): ColumnKey[] =>
    cols.filter((c) => {
      if (!COLUMN_DEFS[c].optional) return true;
      return page.some((sl) =>
        sequences[sl.seq].rows.slice(sl.from, sl.to).some((r) => (r.cells[c] ?? '').trim() || r.lines?.some((l) => (l.cells[c] ?? '').trim())),
      );
    });

  const sheetClass = [s.sheet, s[`theme_${th}`], doc.project.settings.exportInkSaver ? s.inkSaver : '', paper ? s.paged : ''].join(' ');
  const title = showTitle && <h1 className={s.title}>Découpage technique</h1>;

  if (paper && pages)
    return (
      <div className={sheetClass} data-theme-export={th}>
        {pages.map((page, p) => {
          const cs = smart ? pageColumns(page) : cols;
          return (
            <div key={p} className={s.page} style={{ width: `${paperW}mm`, height: `${pageH}mm`, padding: `${PAD_Y}mm 12mm` }} data-testid="print-page" data-columns={cs.join(',')}>
              {p === 0 && title}
              <table className={s.table} data-testid={p === 0 ? 'export-table' : undefined}>
                {head(cs)}
                {page.map((sl) => {
                  const q = sequences[sl.seq];
                  return body(sl.seq, q.rows.slice(sl.from, sl.to), sliceMerges(q.merges, cols, sl.from, sl.to), sl.to === q.rows.length, `${q.id}-${sl.from}`, cs);
                })}
              </table>
            </div>
          );
        })}
      </div>
    );

  return (
    <div ref={measure} className={sheetClass} data-theme-export={th} style={paper ? { padding: '0 12mm', width: `${paperW}mm`, boxSizing: 'border-box' } : undefined}>
      {title}
      <table className={s.table} data-testid={paper ? undefined : 'export-table'}>
        {head(cols)}
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

/**
 * Titre de colonne jamais coupé en plein mot : il passe à la ligne entre deux mots seulement, et si un
 * mot ne tient pas dans la largeur de la colonne (portrait, colonnes nombreuses), le titre rétrécit.
 */
function HeadCell({ className, label }: { className?: string; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const span = ref.current;
    const th = span?.parentElement;
    if (!span || !th) return;
    span.style.fontSize = '';
    const cs = getComputedStyle(th);
    const room = th.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let size = parseFloat(getComputedStyle(span).fontSize);
    for (let k = 0; k < 12 && span.scrollWidth > room + 0.5 && size > 5; k++) {
      size *= 0.92;
      span.style.fontSize = `${size}px`;
    }
  });
  return (
    <th className={className}>
      <span ref={ref} className={s.headLabel}>
        {label}
      </span>
    </th>
  );
}
