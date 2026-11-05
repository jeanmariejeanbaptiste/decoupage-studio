import { MobileCut, useIsMobile } from './MobileCut';
import { useReadOnly } from '../../store/share';
import { ScenarioPanel } from '../scenario/ScenarioPanel';
import { recoverStaleChunk } from '../../ui/staleChunk';
import { OneShotStudio } from '../oneshot/OneShotStudio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Columns3, Link2, PanelRight, ScrollText, Unlink2 } from 'lucide-react';
import { Inspector } from '../inspector/Inspector';
import { ALL_COLUMNS, COLUMN_DEFS, followOrder, isMovableColumn, moveColumn, syncExportColumn, tcLast } from '../../domain/columns';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { downloadBlob } from '../../store/persistence';
import { fileNameFor } from '../../domain/serialize';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { ExportTable } from '../export/ExportTable';
import { exportDocumentPages, exportNodePages, waitForPages, type PageExportOptions } from '../export/imageExport';
import { oneShotAnnexDocument } from '../../domain/documents';
import { ExportPanel } from '../export/ExportPanel';
import { linkSelection, newSequenceAfter, unlinkSelection } from './actions';
import { Grid } from './Grid';
import { GridFooter } from './GridFooter';
import { buildGridModel } from './gridModel';
import { useGridDnd } from './useGridDnd';
import { TemplatesMenu } from './TemplatesMenu';
import { navigate } from '../../app/router';
import { TrackBar } from './TrackBar';
import s from './GridPage.module.css';

const IC = { size: 15, strokeWidth: 1.25 } as const;

export function GridPage({ doc: storeDoc }: { doc: ProjectDoc }) {
  const { displayDoc: doc, wrap, dragging } = useGridDnd(storeDoc);
  const model = useMemo(() => buildGridModel(doc), [doc]);
  // Lecture seule : toujours l'aperçu, la grille d'édition n'a pas lieu d'être.
  const readOnly = useReadOnly();
  const isMobile = useIsMobile();
  const printView = useUi((u) => u.printView) || readOnly;
  const rightPanel = useUi((u) => u.rightPanel);
  const focusRow = useUi((u) => u.selection?.focus.row);
  const selectedShot = focusRow !== undefined ? model.rows[focusRow]?.shotId : undefined;
  const setUi = useUi((u) => u.set);
  const nSeq = doc.project.sequenceIds.length;
  const createFirst = useRef<HTMLButtonElement>(null);
  // Un seul bouton Lier / Délier : « Délier » quand la sélection touche une action déjà liée.
  const sel = useUi((u) => u.selection);
  const linked = useMemo(() => {
    if (!sel) return false;
    const [a, b] = [sel.anchor.row, sel.focus.row].sort((x, y) => x - y);
    const ids = model.rows.slice(a, b + 1).map((r) => r.shotId);
    return ids.some((id) => {
      const shot = doc.shots[id];
      return shot && Object.values(doc.shots).some((o) => o.id !== id && o.actionBlockId === shot.actionBlockId);
    });
  }, [sel, model, doc]);
  const multi = !!sel && sel.anchor.row !== sel.focus.row;
  // Export image : le rendu d'export est monté hors écran le temps de la capture.
  const [imaging, setImaging] = useState<PageExportOptions | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!imaging || !imageRef.current) return;
    const root = imageRef.current;
    const base = `${fileNameFor(storeDoc).replace(/\.decoupage$/, '')}-decoupage-A4-${imaging.orientation === 'portrait' ? 'portrait' : 'paysage'}`;
    void waitForPages(root, '[data-testid="print-page"]')
      .then((pages) => exportNodePages(pages, base, imaging, pages[0] ? getComputedStyle(pages[0]).backgroundColor : '#ffffff'))
      .finally(() => setImaging(null));
  }, [imaging]); // eslint-disable-line react-hooks/exhaustive-deps

  // Après la création de la première séquence, la grille prend le focus.
  const hadRows = useRef(model.rows.length > 0);
  useEffect(() => {
    if (!hadRows.current && model.rows.length > 0) document.querySelector<HTMLElement>('[data-testid="grid"]')?.focus();
    hadRows.current = model.rows.length > 0;
  }, [model.rows.length]);

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div className={s.toolbar} role="toolbar" aria-label="Outils de la grille">
          {/* Gauche : ce qu'on regarde (édition ou aperçu), puis l'action liée à la sélection. */}
          <div className={s.left}>
            <div className={s.views} role="radiogroup" aria-label="Affichage">
              <button type="button" role="radio" aria-checked={!printView} className={!printView ? s.viewOn : ''} onClick={() => setUi({ printView: false })}>
                Découpage
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={printView}
                aria-pressed={printView}
                className={printView ? s.viewOn : ''}
                onClick={() => setUi({ printView: true, editing: null })}
                data-testid="toggle-print"
              >
                Aperçu
              </button>
            </div>
            {!printView && (linked || multi) && (
              linked ? (
                <Button size="sm" icon={<Unlink2 {...IC} />} onClick={unlinkSelection} title="Délier l’action des plans sélectionnés">
                  Délier
                </Button>
              ) : (
                <Button size="sm" icon={<Link2 {...IC} />} onClick={linkSelection} title="Une seule action pour les plans sélectionnés">
                  Lier l’action
                </Button>
              )
            )}
          </div>
          {/* Droite : les panneaux (icônes), puis l'export. */}
          <div className={s.right}>
            {!printView && (
              <div className={s.icons}>
                <ColumnsMenu doc={doc} />
                <Button
                  variant="icon"
                  icon={<PanelRight {...IC} />}
                  aria-label="Inspecteur"
                  aria-pressed={rightPanel === 'inspector'}
                  className={rightPanel === 'inspector' ? s.iconOn : ''}
                  onClick={() => setUi({ rightPanel: rightPanel === 'inspector' ? null : 'inspector' })}
                  title="Inspecteur du plan"
                />
                <Button
                  variant="icon"
                  icon={<ScrollText {...IC} />}
                  aria-label="Scénario"
                  aria-pressed={rightPanel === 'scenario'}
                  className={rightPanel === 'scenario' ? s.iconOn : ''}
                  onClick={() => setUi({ rightPanel: rightPanel === 'scenario' ? null : 'scenario' })}
                  title="Scénario à droite"
                  data-testid="toggle-scenario"
                />
              </div>
            )}
          <ExportPanel
            doc={storeDoc}
            id="grid"
            title="Exporter le découpage"
            extra={[
              { key: 'excel', label: 'Excel', hint: 'Classeur avec fusions, couleurs et onglet Registre.' },
              ...(Object.values(storeDoc.shots).some((x) => x.oneShot)
                ? [{ key: 'annex', label: 'Annexe plans-séquences', hint: 'PDF A4 : une page par plan-séquence (frise des temps, tableau, transitions en clair, plan au sol dédié).' }]
                : []),
            ]}
            disabled={nSeq === 0 || !!imaging}
            options={
              <>
              <label className={s.noMerge} title="Chaque ligne porte sa propre valeur (utile pour retraiter le tableau)">
                <input
                  type="checkbox"
                  checked={!!storeDoc.project.settings.exportNoMerge}
                  onChange={(e) => mutateDoc((d) => void (d.project.settings.exportNoMerge = e.target.checked || undefined))}
                  data-testid="grid-export-nomerge"
                />
                Sans fusion de cellules
              </label>
              <label className={s.noMerge} title="PDF et images : sur chaque page, les colonnes facultatives vides (dialogue, son, notes…) sont masquées, et l’espace profite aux autres">
                <input
                  type="checkbox"
                  checked={!!storeDoc.project.settings.exportSmart}
                  onChange={(e) => mutateDoc((d) => void (d.project.settings.exportSmart = e.target.checked || undefined))}
                  data-testid="grid-export-smart"
                />
                Export intelligent (colonnes vides masquées par page)
              </label>
              </>
            }
            onExport={async ({ format, orientation, numbers }) => {
              try {
                if (format === 'pdf' || format === 'images') setImaging({ format, orientation, numbers });
                else if (format === 'annex')
                  await exportDocumentPages(oneShotAnnexDocument(storeDoc).html, `${fileNameFor(storeDoc).replace(/\.decoupage$/, '')}-annexe-plans-sequences`, { format: 'pdf', orientation: 'portrait', numbers });
                else {
                  const { exportXlsx } = await import('../export/xlsx');
                  downloadBlob(await exportXlsx(storeDoc), `${fileNameFor(storeDoc).replace(/\.decoupage$/, '')}.xlsx`);
                }
              } catch (err) {
                if (recoverStaleChunk(err)) return;
                useUi.getState().toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
              }
            }}
          />
          </div>
        </div>
      </header>

      <OneShotStudio doc={storeDoc} />
      {imaging && (
        <div ref={imageRef} aria-hidden="true" style={{ position: 'fixed', left: -20000, top: 0 }}>
          <ExportTable doc={storeDoc} paper="A4" orientation={imaging.orientation} safety={0} />
        </div>
      )}
      {nSeq === 0 ? (
        <div className="card empty">
          <span className="hand">Aucune séquence pour l’instant</span>
          <p>Créez la première, ou importez un scénario.</p>
          <div className={s.emptyActions}>
            <Button ref={createFirst} variant="primary" autoFocus onClick={newSequenceAfter} data-testid="create-first">
              Créer la première séquence
            </Button>
            <TemplatesMenu doc={doc} variant="outline" />
            <Button variant="outline" onClick={() => navigate('scenario')}>
              Écrire ou importer un scénario
            </Button>
          </div>
        </div>
      ) : printView ? (
        <div className={s.printPreview}>
          {/* Aperçu à l'écran : toujours le style sobre du papier, le thème coloré reste réservé aux exports. */}
          <ExportTable doc={doc} theme="papier" />
        </div>
      ) : isMobile ? (
        // Téléphone : mêmes outils (colonnes, aperçu, export, lier), mais un plan à la fois.
        <MobileCut doc={storeDoc} />
      ) : (
        <>
          {doc.project.settings.tcMode === 'piste' && <TrackBar doc={storeDoc} />}
          <div className={s.workspace}>
            <div className={s.main}>
              {wrap(<Grid doc={doc} model={model} animate={!!dragging} />)}
              <GridFooter sequences={nSeq} shots={model.rows.length} timing={model.timing} mode={doc.project.settings.tcMode} />
            </div>
            {rightPanel === 'inspector' && <Inspector doc={storeDoc} shotId={selectedShot} />}
            {rightPanel === 'scenario' && <ScenarioPanel doc={storeDoc} />}
          </div>
        </>
      )}
    </div>
  );
}

function ColumnsMenu({ doc }: { doc: ProjectDoc }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cols = doc.project.settings.gridColumns;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (c: ColumnKey) =>
    mutateDoc((d) => {
      const g = d.project.settings.gridColumns;
      const shown = !g.includes(c);
      // Une colonne ajoutée prend sa place naturelle ; l'ordre choisi pour les autres est conservé.
      d.project.settings.gridColumns = syncExportColumn(g, c, shown);
      // Ce qu'on affiche dans la grille, on veut l'exporter (et inversement).
      d.project.settings.exportColumns = syncExportColumn(d.project.settings.exportColumns, c, shown);
    });
  const move = (c: ColumnKey, delta: -1 | 1) =>
    mutateDoc((d) => {
      const st = d.project.settings;
      st.gridColumns = moveColumn(tcLast(st.gridColumns), c, delta);
      st.exportColumns = followOrder(st.exportColumns, st.gridColumns);
    });
  const shownCols = tcLast(cols);
  const listed = [...shownCols, ...ALL_COLUMNS.filter((c) => !cols.includes(c))];
  return (
    <div className={s.menuWrap} ref={ref}>
      <Button variant="icon" icon={<Columns3 {...IC} />} aria-label="Colonnes" title="Colonnes" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className={s.menu} role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className={s.menuTitle}>Colonnes de la grille</p>
          {listed.map((c) => {
            const on = cols.includes(c);
            const label = COLUMN_DEFS[c].label.charAt(0) + COLUMN_DEFS[c].label.slice(1).toLowerCase();
            const i = shownCols.indexOf(c);
            const canUp = on && isMovableColumn(c) && i > 0 && isMovableColumn(shownCols[i - 1]);
            const canDown = on && isMovableColumn(c) && i < shownCols.length - 1 && isMovableColumn(shownCols[i + 1]);
            return (
              <div key={c} className={[s.menuItem, on ? '' : s.menuOff, i === shownCols.length - 1 ? s.menuLastOn : ''].join(' ')}>
                <label>
                  <input type="checkbox" checked={on} disabled={c === 'sequence' || c === 'number'} onChange={() => toggle(c)} />
                  {label}
                </label>
                {COLUMN_DEFS[c].optional && on ? (
                  <span className={s.menuMove}>
                    <button type="button" aria-label={`Déplacer ${label} vers la gauche`} title="Vers la gauche" disabled={!canUp} onClick={() => move(c, -1)}>
                      <ChevronUp size={13} strokeWidth={1.5} />
                    </button>
                    <button type="button" aria-label={`Déplacer ${label} vers la droite`} title="Vers la droite" disabled={!canDown} onClick={() => move(c, 1)}>
                      <ChevronDown size={13} strokeWidth={1.5} />
                    </button>
                  </span>
                ) : (
                  COLUMN_DEFS[c].optional && <em>option</em>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
