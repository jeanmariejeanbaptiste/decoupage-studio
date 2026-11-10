import { useState } from 'react';
import { ArrowDown, ArrowUp, Download, Eye, FileText, FolderArchive, FileSpreadsheet, Printer, Save, Table2 } from 'lucide-react';
import { navigate } from '../../app/router';
import { ALL_COLUMNS, columnMenuLabel, isMovableColumn, moveColumn, tcLast } from '../../domain/columns';
import { decodeText, toCsv } from '../../domain/csv';
import { exportBase } from '../../domain/serialize';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { downloadBlob, flushEditors, pickFile, saveToFile } from '../../store/persistence';
import { useCanCopy, useReadOnly } from '../../store/share';
import { recoverStaleChunk } from '../../ui/staleChunk';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { CsvImport } from './CsvImport';
import s from './ExportPage.module.css';

const ALL: ColumnKey[] = [...ALL_COLUMNS];

export function ExportPage({ doc }: { doc: ProjectDoc }) {
  const settings = doc.project.settings;
  const [csvText, setCsvText] = useState<string | null>(null);
  const base = exportBase(doc);
  const toast = useUi((u) => u.toast);
  const readOnly = useReadOnly();
  const canCopy = useCanCopy();

  // Saisie en attente appliquée d'abord ; un export à la fois ; une erreur s'affiche au lieu de disparaître.
  const [busy, setBusy] = useState<'zip' | 'xlsx' | null>(null);
  const current = () => useProjectStore.getState().doc ?? doc;
  const run = async (what: 'zip' | 'xlsx' | 'csv') => {
    flushEditors();
    if (what === 'csv') return downloadBlob(new Blob([toCsv(current())], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
    setBusy(what);
    try {
      if (what === 'zip') {
        const { buildProductionZip } = await import('./productionZip');
        downloadBlob(await buildProductionZip(current()), `${base}-dossier-de-production.zip`);
      } else {
        const { exportXlsx } = await import('./xlsx');
        downloadBlob(await exportXlsx(current()), `${base}.xlsx`);
      }
    } catch (err) {
      if (!recoverStaleChunk(err)) toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };

  const setCols = (cols: ColumnKey[]) =>
    mutateDoc((d) => {
      d.project.settings.exportColumns = tcLast(cols);
    });
  const cols = settings.exportColumns;
  // Même règle que dans la grille : SÉQUENCE et N° restent en tête, TC en fin.
  const move = (c: ColumnKey, delta: -1 | 1) => setCols(moveColumn(tcLast(cols), c, delta));

  const shown = ALL.filter((c) => cols.includes(c)).sort((a, b) => cols.indexOf(a) - cols.indexOf(b));
  const hidden = ALL.filter((c) => !cols.includes(c));
  // Une colonne figée (séquence, N° en tête, TC en fin) ne bouge pas et ne se laisse pas franchir.
  const canMove = (i: number, delta: -1 | 1) => isMovableColumn(shown[i]) && !!shown[i + delta] && isMovableColumn(shown[i + delta]);
  const setFlag = <K extends 'exportFooter' | 'exportInkSaver' | 'exportSmart' | 'exportNoMerge'>(k: K, v: boolean) =>
    mutateDoc((d) => {
      (d.project.settings as Record<K, boolean | undefined>)[k] = v || (k === 'exportFooter' ? false : undefined);
    });

  return (
    <div className={s.page}>
      <section className={s.zip} data-view>
        <FolderArchive size={22} strokeWidth={1.2} />
        <div>
          <h2>Dossier de production</h2>
        </div>
        <Button variant="primary" icon={<Download size={15} strokeWidth={1.4} />} disabled={busy !== null} aria-busy={busy === 'zip'} onClick={() => void run('zip')} data-testid="export-zip">
          {busy === 'zip' ? 'Préparation…' : 'Télécharger (.zip)'}
        </Button>
      </section>

      {!!doc.scenario?.trim() && (
        <section className={s.card}>
          <header className={s.cardHead}>
            <h2>Séquencier</h2>
            <div className={s.actions} data-view>
              <Button
                variant="outline"
                icon={<FileText size={15} strokeWidth={1.3} />}
                onClick={async () => (await import('../scenario/outlineExport')).exportOutlineDocx(doc)}
                data-testid="export-outline-docx"
              >
                Word
              </Button>
              <Button
                variant="primary"
                icon={<Printer size={15} strokeWidth={1.3} />}
                onClick={async () => (await import('../scenario/outlineExport')).exportOutlinePdf(doc)}
                data-testid="export-outline-pdf"
              >
                PDF
              </Button>
            </div>
          </header>
        </section>
      )}

      <section className={s.card}>
        <header className={s.cardHead}>
          <h2>Découpage technique</h2>
          <div className={s.actions} data-view>
            <Button variant="ghost" icon={<Eye size={15} strokeWidth={1.3} />} onClick={() => navigate('print')} data-testid="export-preview">
              Aperçu
            </Button>
            <Button variant="outline" icon={<Table2 size={15} strokeWidth={1.3} />} onClick={() => void run('csv')} data-testid="export-csv">
              CSV
            </Button>
            <Button variant="outline" icon={<FileSpreadsheet size={15} strokeWidth={1.3} />} disabled={busy !== null} onClick={() => void run('xlsx')} data-testid="export-xlsx">
              Excel
            </Button>
            <Button variant="primary" icon={<Printer size={15} strokeWidth={1.3} />} onClick={() => navigate('print', { auto: '1' })} data-testid="export-pdf">
              PDF
            </Button>
          </div>
        </header>

        <div className={s.split} data-edit>
          <div>
            <h3 className={s.h3}>Mise en page</h3>
            <div className={s.line}>
              <span>Format</span>
              <Seg
                name="paper"
                value={settings.exportPaper}
                options={[
                  ['A4', 'A4 paysage'],
                  ['A3', 'A3 paysage'],
                ]}
                onChange={(v) => mutateDoc((d) => void (d.project.settings.exportPaper = v as 'A4' | 'A3'))}
              />
            </div>
            <h3 className={s.h3}>Options</h3>
            <Check checked={settings.exportFooter} onChange={(v) => setFlag('exportFooter', v)} label="Pied de page" />
            <Check checked={!!settings.exportSmart} onChange={(v) => setFlag('exportSmart', v)} label="Masquer les colonnes vides" />
            <Check checked={!!settings.exportNoMerge} onChange={(v) => setFlag('exportNoMerge', v)} label="Sans fusion" />
          </div>

          <div>
            <h3 className={s.h3}>
              Colonnes <span className={s.count}>{shown.length}</span>
            </h3>
            <ul className={s.colList} aria-label="Colonnes exportées">
              {shown.map((c, i) => {
                const never = settings.neverMerge.includes(c);
                const fixed = c === 'sequence' || c === 'number';
                return (
                  <li key={c}>
                    <label>
                      <input type="checkbox" checked disabled={c === 'sequence'} onChange={() => setCols(cols.filter((x) => x !== c))} />
                      {label(c)}
                    </label>
                    <span className={s.colTools}>
                      {!fixed && !settings.exportNoMerge && (
                        <button
                          type="button"
                          className={[s.merge, never ? s.mergeOff : ''].join(' ')}
                          aria-pressed={never}
                          title={never ? 'Cette colonne n’est jamais fusionnée' : 'Les cellules identiques sont fusionnées'}
                          onClick={() =>
                            mutateDoc((d) => {
                              const n = d.project.settings.neverMerge;
                              d.project.settings.neverMerge = never ? n.filter((x) => x !== c) : [...n, c];
                            })
                          }
                        >
                          {never ? 'sans fusion' : 'fusion'}
                        </button>
                      )}
                      <Button variant="icon" size="sm" aria-label={`Monter ${label(c)}`} disabled={!canMove(i, -1)} onClick={() => move(c, -1)} icon={<ArrowUp size={13} />} />
                      <Button variant="icon" size="sm" aria-label={`Descendre ${label(c)}`} disabled={!canMove(i, 1)} onClick={() => move(c, 1)} icon={<ArrowDown size={13} />} />
                    </span>
                  </li>
                );
              })}
            </ul>
            {hidden.length > 0 && (
              <>
                <p className={s.sub}>Non exportées</p>
                <ul className={[s.colList, s.offList].join(' ')}>
                  {hidden.map((c) => (
                    <li key={c}>
                      <label>
                        <input type="checkbox" checked={false} onChange={() => setCols([...cols, c])} />
                        {label(c)}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      <section className={s.card}>
        <header className={s.cardHead}>
          <h2>{readOnly ? 'Fichier du projet' : 'Importer'}</h2>
        </header>
        {/* Enregistrer et ouvrir un fichier sont en haut de l'écran ; en lecture seule, l'icône Enregistrer n'y est pas. */}
        {readOnly && canCopy && (
          <div className={s.fileRow} data-view data-export>
            <div>
              <strong>Sauvegarde complète</strong>
              <span>Le projet entier, images comprises.</span>
            </div>
            <Button variant="outline" icon={<Save size={15} strokeWidth={1.3} />} onClick={() => void saveToFile()} data-testid="export-project">
              .decoupage
            </Button>
          </div>
        )}
        <div className={s.fileRow} data-edit>
          <div>
            <strong>Découpage</strong>
          </div>
          <Button
            variant="outline"
            icon={<Table2 size={15} strokeWidth={1.3} />}
            onClick={async () => {
              const f = await pickFile('.csv,.tsv,.txt,text/csv', false);
              if (f) setCsvText(decodeText(await f.arrayBuffer()));
            }}
            data-testid="import-csv"
          >
            CSV / TSV…
          </Button>
        </div>
        {csvText !== null && <CsvImport key={csvText} text={csvText} onDone={() => setCsvText(null)} />}
      </section>
    </div>
  );
}

const label = columnMenuLabel;

function Seg({ name, value, options, onChange }: { name: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div className={s.seg} role="radiogroup" aria-label={name}>
      {options.map(([v, l]) => (
        <label key={v} className={value === v ? s.on : ''}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          {l}
        </label>
      ))}
    </div>
  );
}

function Check({ checked, onChange, label: l }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{l}</span>
    </label>
  );
}
