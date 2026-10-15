import { Fragment, useMemo } from 'react';
import { COLUMN_DEFS, columnWidths } from '../../domain/columns';
import { sequenceMerges } from '../../domain/rows';
import { computeTiming } from '../../domain/timing';
import type { ColumnKey, ExportTheme, ProjectDoc } from '../../domain/types';
import s from './ExportTable.module.css';

interface Props {
  doc: ProjectDoc;
  columns?: ColumnKey[];
  theme?: ExportTheme;
  showTitle?: boolean;
}

/** Rendu fusionné, identique à l'export (§8.2). Lecture seule. */
export function ExportTable({ doc, columns, theme, showTitle = true }: Props) {
  const cols = columns ?? doc.project.settings.exportColumns;
  const th = theme ?? doc.project.settings.exportTheme;
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const widths = columnWidths(cols);
  const sequences = useMemo(
    () => doc.project.sequenceIds.map((id) => ({ id, ...sequenceMerges(doc, timing, id, cols) })),
    [doc, timing, cols],
  );

  return (
    <div className={[s.sheet, s[`theme_${th}`], doc.project.settings.exportInkSaver ? s.inkSaver : ''].join(' ')} data-theme-export={th}>
      {showTitle && <h1 className={s.title}>Découpage technique</h1>}
      <table className={s.table} data-testid="export-table">
        <colgroup>
          {cols.map((c) => (
            <col key={c} style={{ width: `${widths[c]}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className={s.printSpacer} aria-hidden="true">
            <td colSpan={cols.length} />
          </tr>
          <tr>
            {cols.map((c) => (
              <th key={c} className={s[`h_${c}`]}>
                {COLUMN_DEFS[c].label}
              </th>
            ))}
          </tr>
        </thead>
        <tfoot className={s.printFoot} aria-hidden="true">
          <tr className={s.printSpacer}>
            <td colSpan={cols.length} />
          </tr>
        </tfoot>
        {sequences.map((seq) => (
          <tbody key={seq.id} className={s.seq}>
            {seq.rows.map((row, i) => (
              <tr key={row.shotId}>
                {cols.map((c) => {
                  const span = seq.merges.get(c)?.find((m) => m.startRow === i);
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
                <td className={s.c_sequence}>{`${doc.project.sequenceIds.indexOf(seq.id) + 1}, ${doc.sequences[seq.id]?.label.toUpperCase() ?? ''}`}</td>
                {cols.slice(1).map((c) => (
                  <Fragment key={c}>
                    <td />
                  </Fragment>
                ))}
              </tr>
            )}
            <tr className={s.spacer} aria-hidden="true">
              <td colSpan={cols.length} />
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}
