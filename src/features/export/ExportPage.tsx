import { useState } from 'react';
import { ArrowDown, ArrowUp, Braces, FolderArchive, FileSpreadsheet, FileText, FileUp, Printer, Table2 } from 'lucide-react';
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

const IC = { size: 18, strokeWidth: 1.25 } as const;
const ALL: ColumnKey[] = [...ALL_COLUMNS];

export function ExportPage({ doc }: { doc: ProjectDoc }) {
  const settings = doc.project.settings;
  const [csvText, setCsvText] = useState<string | null>(null);
  const base = fileNameFor(doc).replace(/\.decoupage$/, '');
  const toast = useUi((u) => u.toast);

  const xlsx = async () => {
    const { exportXlsx } = await import('./xlsx');
    downloadBlob(await exportXlsx(doc), `${base}.xlsx`);
    toast({ message: `Classeur ${base}.xlsx téléchargé.` });
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

  return (
    <div className="page">
      <header className="page-head">
      </header>

      <section className={s.formats}>
        <button
          type="button"
          className={['card', s.format, s.zip].join(' ')}
          onClick={async () => {
            toast({ message: 'Préparation du dossier de production…' });
            const { buildProductionZip } = await import('./productionZip');
            downloadBlob(await buildProductionZip(doc), `${base}-dossier-de-production.zip`);
          }}
          data-testid="export-zip"
        >
          <FolderArchive {...IC} />
          <strong>Dossier de production complet</strong>
          <span>Une archive .zip rangée par étape : projet, scénario, dépouillement, découpage Excel, storyboard, plans au sol, matériel, plan de travail, feuilles de service, registre.</span>
        </button>
        <button type="button" className={['card', s.format].join(' ')} onClick={() => navigate('print', { auto: '1' })} data-testid="export-pdf">
          <Printer {...IC} />
          <strong>Exporter PDF</strong>
          <span>Vue d’impression fusionnée, thème {settings.exportTheme}, {settings.exportPaper} paysage.</span>
        </button>
        <button type="button" className={['card', s.format].join(' ')} onClick={() => navigate('print')} data-testid="export-preview">
          <FileText {...IC} />
          <strong>Aperçu avant impression</strong>
          <span>Vérifier la mise en page, choisir le thème et le format.</span>
        </button>
        <button type="button" className={['card', s.format].join(' ')} onClick={xlsx} data-testid="export-xlsx">
          <FileSpreadsheet {...IC} />
          <strong>Excel (.xlsx)</strong>
          <span>Mêmes fusions et couleurs, onglet « Registre ».</span>
        </button>
        <button
          type="button"
          className={['card', s.format].join(' ')}
          onClick={() => downloadBlob(new Blob([toCsv(doc)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)}
          data-testid="export-csv"
        >
          <Table2 {...IC} />
          <strong>CSV</strong>
          <span>Une ligne par plan, sans fusion.</span>
        </button>
        <button
          type="button"
          className={['card', s.format].join(' ')}
          onClick={() => downloadBlob(new Blob([serializeDoc(doc)], { type: 'application/json' }), `${base}.json`)}
          data-testid="export-json"
        >
          <Braces {...IC} />
          <strong>JSON</strong>
          <span>Projet complet (identique au fichier .decoupage).</span>
        </button>
      </section>

      <div className={s.columns}>
        <section className="card">
          <h2 className={s.h2}>Mise en page</h2>
          <div className={s.field}>
            <span>Thème</span>
            <div className={s.seg}>
              {(['mauve', 'papier', 'sobre'] as ExportTheme[]).map((t) => (
                <label key={t} className={settings.exportTheme === t ? s.on : ''}>
                  <input
                    type="radio"
                    name="theme"
                    checked={settings.exportTheme === t}
                    onChange={() =>
                      mutateDoc((d) => {
                        d.project.settings.exportTheme = t;
                      })
                    }
                  />
                  {t === 'mauve' ? 'Mauve' : t === 'papier' ? 'Papier' : 'Sobre'}
                </label>
              ))}
            </div>
          </div>
          <div className={s.field}>
            <span>Format</span>
            <div className={s.seg}>
              {(['A4', 'A3'] as const).map((p) => (
                <label key={p} className={settings.exportPaper === p ? s.on : ''}>
                  <input
                    type="radio"
                    name="paper"
                    checked={settings.exportPaper === p}
                    onChange={() =>
                      mutateDoc((d) => {
                        d.project.settings.exportPaper = p;
                      })
                    }
                  />
                  {p} paysage
                </label>
              ))}
            </div>
          </div>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={settings.exportFooter}
              onChange={(e) =>
                mutateDoc((d) => {
                  d.project.settings.exportFooter = e.target.checked;
                })
              }
            />
            Pied de page : titre · version · date · page x / y
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={!!settings.exportInkSaver}
              onChange={(e) =>
                mutateDoc((d) => {
                  d.project.settings.exportInkSaver = e.target.checked;
                })
              }
            />
            Économie d’encre : aucun aplat de couleur (en couleur avec Mauve ou Papier, en noir et blanc avec Sobre)
          </label>
        </section>

        <section className="card">
          <h2 className={s.h2}>Colonnes exportées</h2>
          <ul className={s.colList}>
            {ALL.filter((c) => cols.includes(c))
              .sort((a, b) => cols.indexOf(a) - cols.indexOf(b))
              .concat(ALL.filter((c) => !cols.includes(c)))
              .map((c) => {
                const on = cols.includes(c);
                return (
                  <li key={c} className={on ? '' : s.off}>
                    <label>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={c === 'sequence'}
                        onChange={() => setCols(on ? cols.filter((x) => x !== c) : [...cols, c])}
                      />
                      {COLUMN_DEFS[c].label}
                    </label>
                    {on && (
                      <span className={s.colTools}>
                        <label className={s.never} title="Ne jamais fusionner cette colonne">
                          <input
                            type="checkbox"
                            checked={settings.neverMerge.includes(c)}
                            disabled={c === 'sequence' || c === 'number'}
                            onChange={(e) =>
                              mutateDoc((d) => {
                                const n = d.project.settings.neverMerge;
                                d.project.settings.neverMerge = e.target.checked ? [...n, c] : n.filter((x) => x !== c);
                              })
                            }
                          />
                          ne jamais fusionner
                        </label>
                        <Button variant="icon" size="sm" aria-label={`Monter ${COLUMN_DEFS[c].label}`} onClick={() => move(c, -1)} icon={<ArrowUp size={13} />} />
                        <Button variant="icon" size="sm" aria-label={`Descendre ${COLUMN_DEFS[c].label}`} onClick={() => move(c, 1)} icon={<ArrowDown size={13} />} />
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>

        <section className="card">
          <h2 className={s.h2}>Importer</h2>
          <p className={s.note}>Ouvrir un projet .decoupage ou JSON remplace le projet courant (il reste dans l’accueil).</p>
          <div className={s.importRow}>
            <Button variant="outline" icon={<FileUp size={15} strokeWidth={1.25} />} onClick={async () => (await openFromFile()) && navigate('grid')}>
              .decoupage / JSON…
            </Button>
            <Button
              variant="outline"
              icon={<Table2 size={15} strokeWidth={1.25} />}
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
    </div>
  );
}
