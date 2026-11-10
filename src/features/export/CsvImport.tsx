import { useMemo, useState } from 'react';
import { navigate } from '../../app/router';
import { columnMenuLabel } from '../../domain/columns';
import { CSV_COLUMNS, guessMapping, importRows, parseDelimited, tcModeOfColumn } from '../../domain/csv';
import { createProjectDoc } from '../../domain/factory';
import type { ColumnKey } from '../../domain/types';
import { openDoc } from '../../store/persistence';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import s from './ExportPage.module.css';

/** Assistant de correspondance des colonnes pour l'import CSV/TSV (§8.3). */
export function CsvImport({ text, onDone }: { text: string; onDone: () => void }) {
  const rows = useMemo(() => parseDelimited(text), [text]);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const [header, setHeader] = useState(true);
  const [mapping, setMapping] = useState<Array<ColumnKey | null>>(() => {
    const g = guessMapping(rows[0] ?? []);
    return Array.from({ length: width }, (_, i) => g[i] ?? null);
  });
  const body = header ? rows.slice(1) : rows;
  const toast = useUi((u) => u.toast);

  const run = async (target: 'current' | 'new') => {
    if (target === 'new') {
      const doc = createProjectDoc({ title: 'Import CSV', format: 'fiction' });
      // Plages « 0:00 - 0:35 » (découpage calé sur une piste) : le nouveau projet adopte ce minutage.
      const tcCol = mapping.indexOf('tc');
      if (tcCol >= 0 && tcModeOfColumn(body.map((r) => r[tcCol] ?? '')) === 'piste') {
        doc.project.settings.tcMode = 'piste';
        doc.project.settings.tcModeChosen = true;
      }
      const n = importRows(doc, body, mapping);
      await openDoc(doc);
      toast({ message: `${n} plans importés dans un nouveau projet.` });
    } else {
      const n = mutateDoc((d) => importRows(d, body, mapping)) ?? 0;
      toast({ message: `${n} plans ajoutés au projet.` });
    }
    onDone();
    navigate('grid');
  };

  if (rows.length === 0) return <p className={s.note}>Fichier vide.</p>;
  return (
    <div className={s.csv} data-testid="csv-import">
      <label className={s.check}>
        <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> La première ligne contient les en-têtes
      </label>
      <div className={s.csvScroll}>
        <table className={s.csvTable}>
          <thead>
            <tr>
              {mapping.map((m, i) => (
                <th key={i}>
                  <select
                    aria-label={`Colonne ${i + 1}`}
                    value={m ?? ''}
                    onChange={(e) => setMapping(mapping.map((x, j) => (j === i ? ((e.target.value || null) as ColumnKey | null) : x)))}
                  >
                    <option value="">— ignorer —</option>
                    {CSV_COLUMNS.filter((c) => c !== 'number').map((c) => (
                      <option key={c} value={c}>
                        {columnMenuLabel(c)}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 4).map((r, i) => (
              <tr key={i} className={header && i === 0 ? s.headerRow : ''}>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j}>{r[j]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.note}>
        {body.length} ligne{body.length > 1 ? 's' : ''}
      </p>
      <div className={s.importRow}>
        <Button onClick={onDone}>Annuler</Button>
        <Button variant="outline" disabled={!useProjectStore.getState().doc} onClick={() => run('current')} data-testid="csv-current">
          Ajouter au projet courant
        </Button>
        <Button variant="primary" onClick={() => run('new')} data-testid="csv-new">
          Créer un nouveau projet
        </Button>
      </div>
    </div>
  );
}
