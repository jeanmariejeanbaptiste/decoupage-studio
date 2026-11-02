import { useState } from 'react';
import { ArrowDown, ArrowUp, Braces, Download, Eye, FolderArchive, FileSpreadsheet, FileUp, Printer, Table2 } from 'lucide-react';
import { navigate } from '../../app/router';
import { ALL_COLUMNS, COLUMN_DEFS, tcLast } from '../../domain/columns';
import { toCsv } from '../../domain/csv';
import { fileNameFor, serializeDoc } from '../../domain/serialize';
import type { ColumnKey, ExportTheme, ProjectDoc } from '../../domain/types';
import { downloadBlob, openFromFile, pickFile } from '../../store/persistence';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { CsvImport } from './CsvImport';
import s from './ExportPage.module.css';

const ALL: ColumnKey[] = [...ALL_COLUMNS];

export function ExportPage({ doc }: { doc: ProjectDoc }) {
  const settings = doc.project.settings;
  const [csvText, setCsvText] = useState<string | null>(null);
  const base = fileNameFor(doc).replace(/\.decoupage$/, '');
  const toast = useUi((u) => u.toast);

  const xlsx = async () => {
    const { exportXlsx } = await import('./xlsx');
    downloadBlob(await exportXlsx(doc), `${base}.xlsx`);
  };

  const setCols = (cols: ColumnKey[]) =>
    mutateDoc((d) => {
      d.project.settings.exportColumns = tcLast(cols);
    });
  const cols = settings.exportColumns;
  const move = (c: ColumnKey, delta: -1 | 1) => {
    const i = cols.indexOf(c);
    const j = i + delta;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    setCols(next);
  };

  const shown = ALL.filter((c) => cols.includes(c)).sort((a, b) => cols.indexOf(a) - cols.indexOf(b));
  const hidden = ALL.filter((c) => !cols.includes(c));
  const setFlag = <K extends 'exportFooter' | 'exportInkSaver' | 'exportSmart' | 'exportNoMerge'>(k: K, v: boolean) =>
    mutateDoc((d) => {
      (d.project.settings as Record<K, boolean | undefined>)[k] = v || (k === 'exportFooter' ? false : undefined);
    });

  return (
    <div className={s.page}>
      <section className={s.zip}>
        <FolderArchive size={22} strokeWidth={1.2} />
        <div>
          <h2>Dossier de production</h2>
          <p>Tout le projet dans une archive rangée par étape : scénario, dépouillement, découpage, storyboard, plans au sol, matériel, plan de travail, feuilles de service.</p>
        </div>
        <Button
          variant="primary"
          icon={<Download size={15} strokeWidth={1.4} />}
          onClick={async () => {
            toast({ message: 'Préparation du dossier de production…' });
            const { buildProductionZip } = await import('./productionZip');
            downloadBlob(await buildProductionZip(doc), `${base}-dossier-de-production.zip`);
          }}
          data-testid="export-zip"
        >
          Télécharger (.zip)
        </Button>
      </section>

      <section className={s.card}>
        <header className={s.cardHead}>
          <h2>Découpage technique</h2>
          <div className={s.actions}>
            <Button variant="ghost" icon={<Eye size={15} strokeWidth={1.3} />} onClick={() => navigate('print')} data-testid="export-preview">
              Aperçu
            </Button>
            <Button variant="outline" icon={<Table2 size={15} strokeWidth={1.3} />} onClick={() => downloadBlob(new Blob([toCsv(doc)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)} data-testid="export-csv">
              CSV
            </Button>
            <Button variant="outline" icon={<FileSpreadsheet size={15} strokeWidth={1.3} />} onClick={xlsx} data-testid="export-xlsx">
              Excel
            </Button>
            <Button variant="primary" icon={<Printer size={15} strokeWidth={1.3} />} onClick={() => navigate('print', { auto: '1' })} data-testid="export-pdf">
              PDF
            </Button>
          </div>
        </header>

        <div className={s.split}>
          <div>
            <h3 className={s.h3}>Mise en page</h3>
            <div className={s.line}>
              <span>Thème</span>
              <Seg
                name="theme"
                value={settings.exportTheme}
                options={[
                  ['mauve', 'Mauve'],
                  ['papier', 'Papier'],
                  ['sobre', 'Sobre'],
                ]}
                onChange={(v) => mutateDoc((d) => void (d.project.settings.exportTheme = v as ExportTheme))}
              />
            </div>
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
            <Check checked={settings.exportFooter} onChange={(v) => setFlag('exportFooter', v)} label="Pied de page" hint="Titre, version, date, numéro de page." />
            <Check checked={!!settings.exportInkSaver} onChange={(v) => setFlag('exportInkSaver', v)} label="Économie d’encre" hint="Aucun aplat de couleur." />
            <Check checked={!!settings.exportSmart} onChange={(v) => setFlag('exportSmart', v)} label="Masquer les colonnes vides" hint="Page par page." />
            <Check checked={!!settings.exportNoMerge} onChange={(v) => setFlag('exportNoMerge', v)} label="Sans fusion" hint="Chaque cellule répétée en entier." />
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
                      <Button variant="icon" size="sm" aria-label={`Monter ${label(c)}`} disabled={i === 0} onClick={() => move(c, -1)} icon={<ArrowUp size={13} />} />
                      <Button variant="icon" size="sm" aria-label={`Descendre ${label(c)}`} disabled={i === shown.length - 1} onClick={() => move(c, 1)} icon={<ArrowDown size={13} />} />
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
          <h2>Fichier du projet</h2>
        </header>
        <div className={s.fileRow}>
          <div>
            <strong>Sauvegarde complète</strong>
            <span>Le projet entier au format JSON, identique au fichier .decoupage.</span>
          </div>
          <Button variant="outline" icon={<Braces size={15} strokeWidth={1.3} />} onClick={() => downloadBlob(new Blob([serializeDoc(doc)], { type: 'application/json' }), `${base}.json`)} data-testid="export-json">
            JSON
          </Button>
        </div>
        <div className={s.fileRow}>
          <div>
            <strong>Ouvrir un projet</strong>
            <span>Remplace le projet ouvert, qui reste dans l’accueil.</span>
          </div>
          <Button variant="outline" icon={<FileUp size={15} strokeWidth={1.3} />} onClick={async () => (await openFromFile()) && navigate('grid')}>
            .decoupage / JSON…
          </Button>
        </div>
        <div className={s.fileRow}>
          <div>
            <strong>Importer un découpage</strong>
            <span>Depuis un tableur : une ligne par plan.</span>
          </div>
          <Button
            variant="outline"
            icon={<Table2 size={15} strokeWidth={1.3} />}
            onClick={async () => {
              const f = await pickFile('.csv,.tsv,.txt,text/csv', false);
              if (f) setCsvText(await f.text());
            }}
            data-testid="import-csv"
          >
            CSV / TSV…
          </Button>
        </div>
        {csvText !== null && <CsvImport text={csvText} onDone={() => setCsvText(null)} />}
      </section>
    </div>
  );
}

const label = (c: ColumnKey) => {
  const l = COLUMN_DEFS[c].label;
  if (l !== l.toUpperCase()) return l;
  // « SÉQUENCE » → « Séquence », mais « TC MIN » reste tel quel.
  return l
    .split(' ')
    .map((w, i) => (w.length <= 3 ? w : (i ? w.charAt(0).toLowerCase() : w.charAt(0)) + w.slice(1).toLowerCase()))
    .join(' ');
};

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

function Check({ checked, onChange, label: l, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {l} <small>{hint}</small>
      </span>
    </label>
  );
}
