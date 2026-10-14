import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Eye, Link2, Plus, Rows3, Unlink2 } from 'lucide-react';
import { COLUMN_DEFS } from '../../domain/columns';
import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS, type ColumnKey, type ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { ExportTable } from '../export/ExportTable';
import { linkSelection, newSequenceAfter, newShotBelow, unlinkSelection } from './actions';
import { Grid } from './Grid';
import { GridFooter } from './GridFooter';
import { buildGridModel } from './gridModel';
import s from './GridPage.module.css';

const IC = { size: 15, strokeWidth: 1.25 } as const;

export function GridPage({ doc }: { doc: ProjectDoc }) {
  const model = useMemo(() => buildGridModel(doc), [doc]);
  const printView = useUi((u) => u.printView);
  const setUi = useUi((u) => u.set);
  const nSeq = doc.project.sequenceIds.length;
  const createFirst = useRef<HTMLButtonElement>(null);

  // Après la création de la première séquence, la grille prend le focus.
  const hadRows = useRef(model.rows.length > 0);
  useEffect(() => {
    if (!hadRows.current && model.rows.length > 0) document.querySelector<HTMLElement>('[data-testid="grid"]')?.focus();
    hadRows.current = model.rows.length > 0;
  }, [model.rows.length]);

  return (
    <div className="page page--wide">
      <header className="page-head">
        <div>
          <p className="page-kicker">Étape 4 · Découpage</p>
          <h1 className="page-title">
            {nSeq === 0 ? 'Le découpage' : (
              <>
                Les <em>{nSeq}</em> séquence{nSeq > 1 ? 's' : ''}
              </>
            )}
          </h1>
        </div>
        <div className={s.toolbar} role="toolbar" aria-label="Outils de la grille">
          <Button icon={<Plus {...IC} />} onClick={newShotBelow} title="Nouveau plan (⌘↵)" disabled={printView || nSeq === 0}>
            Plan
          </Button>
          <Button icon={<Rows3 {...IC} />} onClick={newSequenceAfter} title="Nouvelle séquence (⌘⇧↵)" disabled={printView}>
            Séquence
          </Button>
          <span className={s.sep} />
          <Button icon={<Link2 {...IC} />} onClick={linkSelection} title="Lier l’action des plans sélectionnés" disabled={printView}>
            Lier l’action
          </Button>
          <Button icon={<Unlink2 {...IC} />} onClick={unlinkSelection} title="Délier l’action" disabled={printView}>
            Délier
          </Button>
          <span className={s.sep} />
          <ColumnsMenu doc={doc} />
          <Button
            variant={printView ? 'primary' : 'outline'}
            icon={<Eye {...IC} />}
            aria-pressed={printView}
            onClick={() => setUi({ printView: !printView, editing: null })}
            data-testid="toggle-print"
          >
            Vue impression
          </Button>
        </div>
      </header>

      {nSeq === 0 ? (
        <div className="card empty">
          <span className="hand">Aucune séquence pour l’instant</span>
          <p>Créez la première, ou importez un scénario.</p>
          <Button ref={createFirst} variant="primary" autoFocus onClick={newSequenceAfter} data-testid="create-first">
            Créer la première séquence
          </Button>
        </div>
      ) : printView ? (
        <div className={s.printPreview}>
          <ExportTable doc={doc} />
        </div>
      ) : (
        <>
          <Grid doc={doc} model={model} />
          <GridFooter sequences={nSeq} shots={model.rows.length} timing={model.timing} mode={doc.project.settings.tcMode} />
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
      const all: ColumnKey[] = [...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS];
      const next = g.includes(c) ? g.filter((x) => x !== c) : [...g, c];
      d.project.settings.gridColumns = all.filter((x) => next.includes(x));
    });
  return (
    <div className={s.menuWrap} ref={ref}>
      <Button icon={<Columns3 {...IC} />} aria-expanded={open} onClick={() => setOpen(!open)}>
        Colonnes
      </Button>
      {open && (
        <div className={s.menu} role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className={s.menuTitle}>Colonnes de la grille</p>
          {[...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS].map((c) => (
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
