import { BEAT_COLUMNS } from '../../domain/oneshot';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_DEFS, columnWidths, tcLast } from '../../domain/columns';
import { nudgeWidths, wordDeficit, type ColumnMeasure } from '../../domain/columnFit';
import { displaySpan, type MergeMap, type MergeRow } from '../../domain/merge';
import { cleanCuts, paginate, sliceMerges, type PageSlice } from '../../domain/pagination';
import { sequenceMerges } from '../../domain/rows';
import { computeTiming } from '../../domain/timing';
import type { ColumnKey, ExportTheme, ID, ProjectDoc } from '../../domain/types';
import { sequenceNumber } from '../../domain/numbering';
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
  /** Séquences sans plan gardées quand même (aperçu : celles qui portent un commentaire). */
  keepEmpty?: ReadonlySet<ID>;
}

const PAPER = { A4: [297, 210], A3: [420, 297] } as const;
const PAD_Y = 9; // marge haute et basse de chaque page, en mm
const PX_PER_MM = 96 / 25.4;

/** Rendu fusionné, identique à l'export (§8.2). Lecture seule. */
export function ExportTable({ doc, columns, theme, showTitle = true, paper, footer, orientation = 'landscape', safety = 12, keepEmpty }: Props) {
  const cols = useMemo(() => tcLast(columns ?? doc.project.settings.exportColumns), [columns, doc.project.settings.exportColumns]);
  // Un seul style d'export : blanc, noir, bleu. Le paramètre `theme` n'est plus utilisé.
  void theme;
  const th = 'sobre';
  const timing = useMemo(() => computeTiming(doc), [doc]);
  // Une séquence sans plan n'a rien à montrer : elle ne s'exporte pas (ses voisines gardent leur numéro).
  const sequences = useMemo(
    () =>
      doc.project.sequenceIds
        .filter((id) => doc.sequences[id]?.shotIds.length || keepEmpty?.has(id))
        .map((id) => ({ id, ...sequenceMerges(doc, timing, id, cols, !!doc.project.settings.exportNoMerge, true) })),
    [doc, timing, cols, keepEmpty],
  );
  const measure = useRef<HTMLDivElement>(null);
  const paged = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageSlice[][] | null>(null);
  // Resserrement (px) appliqué si une page déborde malgré tout : aucune ligne ne doit être cachée.
  const [tighten, setTighten] = useState(0);
  // Marge de sécurité de 12 mm : Safari ajoute ses en-têtes et pieds de page dans la page.
  const [paperW, paperH] = paper ? (orientation === 'portrait' ? [PAPER[paper][1], PAPER[paper][0]] : PAPER[paper]) : [0, 0];
  const pageH = paper ? paperH - (footer ? 10 : 0) - safety : 0;

  // Largeurs ajustées (léger emprunt entre colonnes), propres à ce jeu de colonnes et à ce contenu.
  const fitKey = `${cols.join(',')}|${paperW}`;
  const [fit, setFit] = useState<{ key: string; sequences: unknown; widths: Record<string, number> } | null>(null);
  const widths = fit && fit.key === fitKey && fit.sequences === sequences ? fit.widths : null;

  useLayoutEffect(() => {
    if (widths) return;
    let cancelled = false;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        const table = measure.current?.querySelector('table');
        if (cancelled || !table) return;
        setFit({ key: fitKey, sequences, widths: measureFit(table, cols) });
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [widths, fitKey, sequences, cols]);

  // Mesure le rendu continu, puis répartit les lignes en pages.
  useLayoutEffect(() => {
    if (!paper || !widths) return;
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
      const avail = (pageH - 2 * PAD_Y) * PX_PER_MM - head - 4 - tighten;
      const cuts = sequences.map((q) => cleanCuts(q.merges, cols, q.rows.length));
      // Hauteur du texte d'une cellule fusionnée, s'il fallait le répéter seul sur une ligne en haut de page.
      const startExtra = bodies.map((b, k) => {
        const extra = new Array<number>(rowHeights[k]?.length ?? 0).fill(0);
        const trs = [...b.querySelectorAll<HTMLElement>('tr:not([aria-hidden]):not([data-sub])')];
        trs.forEach((tr, r) => {
          for (const td of tr.querySelectorAll<HTMLTableCellElement>('td[rowspan]')) {
            const span = td.rowSpan;
            if (span < 2) continue;
            const range = document.createRange();
            range.selectNodeContents(td);
            const cs = getComputedStyle(td);
            const need = range.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2;
            for (let i = r + 1; i < r + span && i < extra.length; i++) extra[i] = Math.max(extra[i], need - (rowHeights[k][i] ?? 0));
          }
        });
        return extra;
      });
      setPages(paginate(rowHeights, avail, { gap, firstOffset: titleH, cuttable: cuts, startExtra }));
    };
    void document.fonts.ready.then(() => requestAnimationFrame(run));
    return () => {
      cancelled = true;
    };
  }, [paper, pageH, sequences, cols, showTitle, widths, tighten]);

  // Filet de sécurité : une page qui déborde quand même (polices, arrondis) relance la pagination, resserrée.
  useLayoutEffect(() => {
    if (!paper || !pages || !paged.current) return;
    let over = 0;
    for (const page of paged.current.querySelectorAll<HTMLElement>('[data-testid="print-page"]')) over = Math.max(over, page.scrollHeight - page.clientHeight);
    if (over > 1 && tighten < 600) setTighten((t) => t + over + 4);
  }, [pages, paper, tighten]);
  useLayoutEffect(() => setTighten(0), [paper, pageH, sequences, cols, widths]);

  const head = (cs: ColumnKey[], w: Record<string, number> = pickWidths(widths, cs)) => (
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
            <HeadCell key={c} className={s[`h_${c}`]} label={COLUMN_DEFS[c].label} col={c} />
          ))}
        </tr>
      </thead>
    </>
  );

  const body = (seqIdx: number, rows: MergeRow[], merges: MergeMap, last: boolean, key: string, cs: ColumnKey[] = cols) => {
    const seq = sequences[seqIdx];
    return (
      <tbody key={key} className={s.seq} data-seq={seq.id}>
        {rows.map((row, i) => {
          const lines = row.lines;
          const beatCell = (c: ColumnKey, k: number) => {
            const l = lines![k];
            const v = l.cells[c] ?? '';
            return (
              <td key={c} data-col={c} className={[s[`c_${c}`], s.beatCell, k > 0 ? s.beatNext : '', k < lines!.length - 1 ? s.beatMore : '', l.bridge ? s.bridge : ''].join(' ')}>
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
              <tr className={[lines ? s.oneShot : '', row.group ? s.itwRow : ''].join(' ') || undefined} data-shot={row.shotId}>
                {cs.map((c) => {
                  if (lines && BEAT_COLUMNS.includes(c)) return beatCell(c, 0);
                  const span = merges.get(c)?.find((m) => m.startRow === i);
                  if (!span) return null;
                  const h = displaySpan(rows, i, span.span);
                  return (
                    <td key={c} rowSpan={h > 1 ? h : undefined} className={s[`c_${c}`]} data-col={c}>
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
            <td className={s.c_sequence} data-col="sequence">{`${sequenceNumber(doc, seq.id)}, ${doc.sequences[seq.id]?.label.toUpperCase() ?? ''}`}</td>
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

  const sheetClass = [s.sheet, paper ? s.paged : ''].join(' ');
  const title = showTitle && <h1 className={s.title}>Découpage technique</h1>;

  if (paper && pages)
    return (
      <div ref={paged} className={sheetClass} data-theme-export={th}>
        {/* Aucun plan : une page, son titre et ses intitulés. */}
        {(pages.length ? pages : [[]]).map((page, p) => {
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
    // Mise en pages : le rendu continu ne sert qu'à mesurer ; caché, il ne s'affiche pas un instant à
    // pleine taille avant les pages (saut à l'ouverture de l'aperçu).
    <div
      ref={measure}
      className={sheetClass}
      data-theme-export={th}
      style={paper ? { padding: '0 12mm', width: `${paperW}mm`, boxSizing: 'border-box', position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } : undefined}
    >
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
function HeadCell({ className, label, col }: { className?: string; label: string; col: string }) {
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
    <th className={className} data-col={col}>
      <span ref={ref} className={s.headLabel}>
        {label}
      </span>
    </th>
  );
}

/** Largeurs en % pour un jeu de colonnes : ajustées si disponibles (renormalisées), sinon par défaut. */
function pickWidths(widths: Record<string, number> | null, cs: ColumnKey[]): Record<string, number> {
  if (!widths || cs.some((c) => widths[c] === undefined)) return columnWidths(cs);
  const total = cs.reduce((n, c) => n + widths[c], 0) || 1;
  return Object.fromEntries(cs.map((c) => [c, (widths[c] / total) * 100]));
}

let canvas: HTMLCanvasElement | null = null;
function textWidth(text: string, font: string): number {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Mesure, colonne par colonne, les mots coupés à une ou deux lettres et la place inoccupée. */
function measureFit(table: HTMLTableElement, cols: ColumnKey[]): Record<string, number> {
  const tableW = table.getBoundingClientRect().width || 1;
  const measures: ColumnMeasure[] = cols.map((c) => {
    const th = table.querySelector<HTMLElement>(`th[data-col="${c}"]`);
    const width = th?.getBoundingClientRect().width ?? 0;
    let deficit = 0;
    // Débordement (positif) ou marge (négatif) du plus long texte posé sur une seule ligne.
    let natural = -Infinity;
    if (th) {
      const cs = getComputedStyle(th);
      const room = th.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      // Le titre peut passer à la ligne entre ses mots : seul son mot le plus long compte.
      for (const word of (th.textContent ?? '').split(/\s+/)) if (word) natural = Math.max(natural, textWidth(word, font) - room);
    }
    for (const td of table.querySelectorAll<HTMLTableCellElement>(`td[data-col="${c}"]`)) {
      if (td.colSpan > 1) continue;
      const cs = getComputedStyle(td);
      const room = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      for (const line of (td.innerText || '').split('\n')) {
        if (!line.trim()) continue;
        natural = Math.max(natural, textWidth(line, font) - room);
        for (const word of line.split(/\s+/)) {
          if (!word) continue;
          const prefix = [...word].map((_, i) => textWidth(word.slice(0, i + 1), font));
          deficit = Math.max(deficit, wordDeficit(prefix, room));
        }
      }
    }
    // Place prêtable : ce que le plus long texte de la colonne, sur une seule ligne, laisse libre.
    const slack = natural === -Infinity ? width * 0.5 : natural < 0 ? -natural - 2 : 0;
    return { key: c, width, deficit: deficit ? Math.ceil(deficit) + 1 : 0, slack };
  });
  const px = nudgeWidths(measures);
  return Object.fromEntries(cols.map((c) => [c, (px[c] / tableW) * 100]));
}
