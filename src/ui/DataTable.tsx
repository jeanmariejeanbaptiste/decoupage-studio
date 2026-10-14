import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { fold } from '../domain/text';
import s from './DataTable.module.css';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Valeur de tri (par défaut : le texte de recherche). */
  sort?: (row: T) => string | number;
  /** Texte indexé par la recherche. */
  text?: (row: T) => string;
  /** Édition en ligne. */
  edit?: {
    get: (row: T) => string;
    set: (row: T, value: string) => void;
    options?: ReadonlyArray<{ value: string; label: string }>;
    type?: 'text' | 'color';
  };
  align?: 'left' | 'right' | 'center';
  width?: string;
}

interface Props<T> {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  rowKey: (row: T) => string;
  search?: string;
  empty?: ReactNode;
  rowProps?: (row: T) => Record<string, unknown>;
  label: string;
  wrapRow?: (row: T, tr: ReactNode) => ReactNode;
}

/** Table triable, filtrable et éditable en ligne (Registre, §7). */
export function DataTable<T>({ rows, columns, rowKey, search = '', empty, rowProps, label, wrapRow }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [editing, setEditing] = useState<{ row: string; col: string } | null>(null);

  const visible = useMemo(() => {
    const q = fold(search);
    let list = rows.filter((r) => !q || columns.some((c) => fold(c.text?.(r) ?? '').includes(q)));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r: T) => col?.sort?.(r) ?? col?.text?.(r) ?? '';
      list = [...list].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true });
        return cmp * sort.dir;
      });
    }
    return list;
  }, [rows, columns, search, sort]);

  return (
    <div className={s.wrap}>
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} style={{ width: c.width, textAlign: c.align }} aria-sort={active ? (sort?.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className={s.sortBtn}
                    onClick={() => setSort(active ? (sort?.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}
                  >
                    {c.label}
                    {active && (sort?.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={s.empty}>
                {empty ?? 'Aucun élément.'}
              </td>
            </tr>
          )}
          {visible.map((r) => {
            const id = rowKey(r);
            const tr = (
              <tr key={id} {...(rowProps?.(r) ?? {})}>
                {columns.map((c) => {
                  const isEditing = editing?.row === id && editing.col === c.key;
                  return (
                    <td
                      key={c.key}
                      style={{ textAlign: c.align }}
                      className={c.edit ? s.editable : undefined}
                      onClick={() => c.edit && !isEditing && c.edit.type !== 'color' && setEditing({ row: id, col: c.key })}
                    >
                      {isEditing && c.edit ? (
                        <InlineEditor
                          value={c.edit.get(r)}
                          options={c.edit.options}
                          onDone={(v) => {
                            setEditing(null);
                            if (v !== null && v !== c.edit!.get(r)) c.edit!.set(r, v);
                          }}
                        />
                      ) : c.edit?.type === 'color' ? (
                        <input
                          type="color"
                          className={s.color}
                          value={c.edit.get(r) || '#9c3d2b'}
                          aria-label={`${c.label}`}
                          onChange={(e) => c.edit!.set(r, e.target.value)}
                        />
                      ) : (
                        c.render(r)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
            return wrapRow ? wrapRow(r, tr) : tr;
          })}
        </tbody>
      </table>
    </div>
  );
}

function InlineEditor({ value, options, onDone }: { value: string; options?: ReadonlyArray<{ value: string; label: string }>; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  if (options) {
    return (
      <select
        autoFocus
        className={s.input}
        value={v}
        onChange={(e) => onDone(e.target.value)}
        onBlur={() => onDone(null)}
        onKeyDown={(e) => e.key === 'Escape' && onDone(null)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      autoFocus
      className={s.input}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}
