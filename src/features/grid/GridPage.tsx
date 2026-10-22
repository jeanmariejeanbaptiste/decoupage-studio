import { OneShotStudio } from '../oneshot/OneShotStudio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Eye, Link2, PanelRight, Plus, Rows3, Unlink2 } from 'lucide-react';
import { Inspector } from '../inspector/Inspector';
import { ALL_COLUMNS, COLUMN_DEFS, tcLast } from '../../domain/columns';
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
import { linkSelection, newSequenceAfter, newShotBelow, unlinkSelection } from './actions';
import { Grid } from './Grid';
import { GridFooter } from './GridFooter';
import { buildGridModel } from './gridModel';
import { useGridDnd } from './useGridDnd';
import { TemplatesMenu } from './TemplatesMenu';
import { AssistantButton } from '../assistant/AssistantButton';
import { navigate } from '../../app/router';
import { TrackBar } from './TrackBar';
import s from './GridPage.module.css';

const IC = { size: 15, strokeWidth: 1.25 } as const;

export function GridPage({ doc: storeDoc }: { doc: ProjectDoc }) {
  const { displayDoc: doc, wrap } = useGridDnd(storeDoc);
  const model = useMemo(() => buildGridModel(doc), [doc]);
  const printView = useUi((u) => u.printView);
  const inspectorOpen = useUi((u) => u.inspectorOpen);
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
          <div className={s.addGroup} role="group" aria-label="Ajouter">
            <Button icon={<Plus {...IC} />} onClick={newShotBelow} title="Nouveau plan sous le plan sélectionné (⌘↵)" disabled={printView || nSeq === 0}>
              Plan
            </Button>
            <Button icon={<Rows3 {...IC} />} onClick={newSequenceAfter} title="Nouvelle séquence après la séquence sélectionnée (⌘⇧↵)" disabled={printView}>
              Séquence
            </Button>
            <TemplatesMenu doc={doc} variant="caret" />
          </div>
          <AssistantButton doc={doc} />
          <span className={s.sep} />
          {linked ? (
            <Button icon={<Unlink2 {...IC} />} onClick={unlinkSelection} title="Délier l’action des plans sélectionnés" disabled={printView}>
              Délier
            </Button>
          ) : (
            <Button icon={<Link2 {...IC} />} onClick={linkSelection} title="Lier l’action des plans sélectionnés (au moins deux plans consécutifs)" disabled={printView}>
              Lier l’action
            </Button>
          )}
          <ColumnsMenu doc={doc} />
          <Button
            icon={<PanelRight {...IC} />}
            aria-pressed={inspectorOpen}
            onClick={() => setUi({ inspectorOpen: !inspectorOpen })}
            title="Afficher ou masquer l’inspecteur du plan"
            disabled={printView}
          >
            Inspecteur
          </Button>
          <span className={s.sep} />
          <Button
            variant={printView ? 'primary' : 'outline'}
            icon={<Eye {...IC} />}
            aria-pressed={printView}
            onClick={() => setUi({ printView: !printView, editing: null })}
            data-testid="toggle-print"
          >
            Aperçu
          </Button>
          <ExportPanel
            doc={storeDoc}
            id="grid"
            title="Exporter le découpage"
            themed
            extra={[
              { key: 'excel', label: 'Excel', hint: 'Classeur avec fusions, couleurs et onglet Registre.' },
              ...(Object.values(storeDoc.shots).some((x) => x.oneShot)
                ? [{ key: 'annex', label: 'Annexe plans-séquences', hint: 'PDF A4 : une page par plan-séquence (frise des temps, tableau, transitions en clair, plan au sol dédié).' }]
                : []),
            ]}
            disabled={nSeq === 0 || !!imaging}
            options={
              <label className={s.noMerge} title="Chaque ligne porte sa propre valeur (utile pour retraiter le tableau)">
                <input
                  type="checkbox"
                  checked={!!storeDoc.project.settings.exportNoMerge}
                  onChange={(e) => mutateDoc((d) => void (d.project.settings.exportNoMerge = e.target.checked || undefined))}
                  data-testid="grid-export-nomerge"
                />
                Sans fusion de cellules
              </label>
            }
            onExport={async ({ format, orientation, numbers }) => {
              if (format === 'pdf' || format === 'images') setImaging({ format, orientation, numbers });
              else if (format === 'annex')
                await exportDocumentPages(oneShotAnnexDocument(storeDoc).html, `${fileNameFor(storeDoc).replace(/\.decoupage$/, '')}-annexe-plans-sequences`, { format: 'pdf', orientation: 'portrait', numbers });
              else {
                const { exportXlsx } = await import('../export/xlsx');
                downloadBlob(await exportXlsx(storeDoc), `${fileNameFor(storeDoc).replace(/\.decoupage$/, '')}.xlsx`);
              }
            }}
          />
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
          <ExportTable doc={doc} />
        </div>
      ) : (
        <>
          {doc.project.settings.tcMode === 'piste' && <TrackBar doc={storeDoc} />}
          <div className={s.workspace}>
            <div className={s.main}>
              {wrap(<Grid doc={doc} model={model} />)}
              <GridFooter sequences={nSeq} shots={model.rows.length} timing={model.timing} mode={doc.project.settings.tcMode} />
            </div>
            {inspectorOpen && <Inspector doc={storeDoc} shotId={selectedShot} />}
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
      const all = ALL_COLUMNS;
      const next = g.includes(c) ? g.filter((x) => x !== c) : [...g, c];
      d.project.settings.gridColumns = tcLast(all.filter((x) => next.includes(x)));
    });
  return (
    <div className={s.menuWrap} ref={ref}>
      <Button icon={<Columns3 {...IC} />} aria-expanded={open} onClick={() => setOpen(!open)}>
        Colonnes
      </Button>
      {open && (
        <div className={s.menu} role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className={s.menuTitle}>Colonnes de la grille</p>
          {ALL_COLUMNS.map((c) => (
            <label key={c} className={s.menuItem}>
              <input
                type="checkbox"
                checked={cols.includes(c)}
                disabled={c === 'sequence' || c === 'number'}
                onChange={() => toggle(c)}
              />
              {COLUMN_DEFS[c].label.charAt(0) + COLUMN_DEFS[c].label.slice(1).toLowerCase()}
              {COLUMN_DEFS[c].optional && <em>option</em>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
