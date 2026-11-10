import { InterviewExport, InterviewPanel, InterviewPreview } from '../interview/InterviewPanel';
import { MobileCut, useIsMobile } from './MobileCut';
import { useReadOnly } from '../../store/share';
import { ScenarioPanel } from '../scenario/ScenarioPanel';
import { OneShotStudio } from '../oneshot/OneShotStudio';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Columns3, Eye, Link2, PanelRight, ScrollText, Unlink2 } from 'lucide-react';
import { Inspector } from '../inspector/Inspector';
import { ALL_COLUMNS, COLUMN_DEFS, columnMenuLabel, followOrder, isMovableColumn, moveColumn, syncExportColumn, tcLast } from '../../domain/columns';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { ExportTable } from '../export/ExportTable';
import { CutComments } from '../comments/CutComments';
import { cutComments } from '../../domain/comments';
import { linkSelection, newSequenceAfter, rowOfShot, unlinkSelection } from './actions';
import { CutExport } from './CutExport';
import { VersionSwitcher } from '../versions/VersionSwitcher';
import { StoryboardPage, StoryboardPreview } from '../storyboard/StoryboardPage';
import { Grid } from './Grid';
import { GridFooter } from './GridFooter';
import { buildGridModel } from './gridModel';
import { useGridDnd } from './useGridDnd';
import { navigate } from '../../app/router';
import { TrackBar } from './TrackBar';
import s from './GridPage.module.css';

const IC = { size: 15, strokeWidth: 1.25 } as const;

/** Découpage technique : le tableau, le storyboard (même découpage, en cartes) et l'aperçu imprimable. */
export function GridPage({ doc: storeDoc, board = false }: { doc: ProjectDoc; board?: boolean }) {
  const { displayDoc: doc, wrap, dragging } = useGridDnd(storeDoc);
  const model = useMemo(() => buildGridModel(doc), [doc]);
  // Lecture seule : toujours l'aperçu, la grille d'édition n'a pas lieu d'être.
  const readOnly = useReadOnly();
  const isMobile = useIsMobile();
  const printViewRaw = useUi((u) => u.printView) || readOnly;
  // Institutionnel : deux volets, l'interview (A-roll) et les illustrations (B-roll, la grille).
  const institutional = storeDoc.project.format === 'institutionnel';
  const itwTab = useUi((u) => u.itwTab) === 'itw';
  // Trois vues (Interview, Tableau, Storyboard) ; l'Aperçu montre celle qui est choisie, rien d'autre.
  const itwSelected = institutional && itwTab && !board;
  const printView = printViewRaw;
  const interviewView = itwSelected && !printView;
  const pickItw = (on: boolean) => {
    setUi({ itwTab: on ? 'itw' : 'broll' });
    try {
      localStorage.setItem('ds-itw-tab', on ? 'itw' : 'broll');
    } catch {
      /* stockage indisponible */
    }
  };
  const rightPanel = useUi((u) => u.rightPanel);
  // Sélection posée d'office : l'inspecteur n'y voit aucun plan choisi.
  const focusRow = useUi((u) => (u.selection?.auto ? undefined : u.selection?.focus.row));
  const selectedShot = focusRow !== undefined ? model.rows[focusRow]?.shotId : undefined;
  const setUi = useUi((u) => u.set);
  const nSeq = doc.project.sequenceIds.length;
  const createFirst = useRef<HTMLButtonElement>(null);
  // Un seul bouton Lier / Délier : « Délier » quand la sélection touche une action déjà liée.
  const sel = useUi((u) => u.selection);
  // Les caméras d'un cadre d'interview partagent l'action de la fiche : ni Lier ni Délier pour elles.
  const selIds = useMemo(() => {
    if (!sel) return [];
    const [a, b] = [sel.anchor.row, sel.focus.row].sort((x, y) => x - y);
    return [...new Set(model.rows.slice(a, b + 1).map((r) => r.shotId))].filter((id) => doc.shots[id] && !doc.shots[id].interview);
  }, [sel, model, doc]);
  const linked = useMemo(
    () =>
      selIds.some((id) => {
        const shot = doc.shots[id];
        return Object.values(doc.shots).some((o) => o.id !== id && o.actionBlockId === shot.actionBlockId);
      }),
    [selIds, doc],
  );
  const multi = selIds.length > 1;
  // Aperçu : une séquence sans plan n'y figure (comme à l'export) que si un commentaire la vise, ou
  // si une vérification y mène. Le relecteur et l'invité en lecture seule les voient toutes, réduites
  // à leur en-tête : on peut viser (commenter) une séquence pas encore découpée.
  const cutFocus = useUi((u) => u.cutFocus);
  const keepEmpty = useMemo(() => {
    const keep = new Set(
      readOnly
        ? storeDoc.project.sequenceIds.filter((id) => !storeDoc.sequences[id]?.shotIds.length)
        : [...cutComments(storeDoc).values()].flatMap((l) => (l[0].anchor.kind === 'sequence' ? [l[0].anchor.seqId] : [])),
    );
    if (cutFocus && !cutFocus.shotId) keep.add(cutFocus.seqId);
    return keep;
  }, [storeDoc, readOnly, cutFocus]);
  // L'arrivée d'une vérification ne vaut que pour cette visite (le démontage d'essai du mode strict la garde).
  useEffect(
    () => () => {
      if (!/^#\/(grid|storyboard)\b/.test(window.location.hash)) useUi.getState().set({ cutFocus: null });
    },
    [],
  );

  // Après la création de la première séquence, la grille prend le focus.
  const hadRows = useRef(model.rows.length > 0);
  useEffect(() => {
    if (!hadRows.current && model.rows.length > 0) document.querySelector<HTMLElement>('[data-testid="grid"]')?.focus();
    hadRows.current = model.rows.length > 0;
  }, [model.rows.length]);

  // Vue choisie : le storyboard a son adresse (#/storyboard), le tableau et l'aperçu celle du découpage.
  const toGrid = () => board && navigate('grid');
  const views = (
    // Tableau et storyboard servent à regarder : ils restent en lecture seule (relecteur, invité).
    <div className={s.views} role="radiogroup" aria-label="Affichage" data-view>
      {institutional ? (
        <>
          <button
            type="button"
            role="radio"
            aria-checked={!board && itwTab}
            className={!board && itwTab ? s.viewOn : ''}
            onClick={() => {
              pickItw(true);
              toGrid();
            }}
            data-testid="tab-interview"
          >
            Interview
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!board && !itwTab}
            className={!board && !itwTab ? s.viewOn : ''}
            onClick={() => {
              pickItw(false);
              toGrid();
            }}
            data-testid="view-table"
          >
            Tableau
          </button>
        </>
      ) : (
        <button
          type="button"
          role="radio"
          aria-checked={!board}
          className={!board ? s.viewOn : ''}
          onClick={toGrid}
          data-testid="view-table"
        >
          Tableau
        </button>
      )}
      <button type="button" role="radio" aria-checked={board} className={board ? s.viewOn : ''} onClick={() => !board && navigate('storyboard')} data-testid="view-storyboard">
        Storyboard
      </button>
    </div>
  );
  // Aperçu de la vue en cours, tel qu'à l'export : le tableau du découpage ou les planches du storyboard.
  // (En lecture seule, l'aperçu est la seule vue : pas de bascule.)
  const previewToggle = readOnly ? null : (
    <button
      type="button"
      role="switch"
      className={[s.preview, printView ? s.previewOn : ''].join(' ')}
      aria-checked={printView}
      aria-pressed={printView}
      onClick={() => setUi({ printView: !printView, editing: null })}
      title={board ? 'Planches du storyboard telles qu’à l’export' : itwSelected ? 'Fiche d’interview telle qu’à l’export' : 'Découpage tel qu’à l’export'}
      data-testid="toggle-print"
    >
      <Eye {...IC} />
      Aperçu
      <span className={s.lever} aria-hidden="true">
        <span />
      </span>
    </button>
  );

  // Storyboard : les planches seulement sur demande ; en lecture seule, les cartes restent la vue.
  if (board && printView && !readOnly) {
    return (
      <div className="page page--wide">
        <header className="page-head">
          <div className={s.toolbar} role="toolbar" aria-label="Outils du storyboard">
            <div className={s.left}>
              {views}
              {previewToggle}
            </div>
            <div className={s.right}>
              <VersionSwitcher doc={storeDoc} />
              <CutExport doc={storeDoc} defaultContent="storyboard" />
            </div>
          </div>
        </header>
        <StoryboardPreview doc={storeDoc} />
      </div>
    );
  }

  if (board) {
    return (
      <StoryboardPage
        doc={storeDoc}
        lead={
          <>
            {views}
            {previewToggle}
          </>
        }
        trail={
          <>
            <VersionSwitcher doc={storeDoc} />
            <CutExport doc={storeDoc} defaultContent="storyboard" />
          </>
        }
        selectedShot={selectedShot}
        onSelect={(id) => {
          const row = rowOfShot(storeDoc, id);
          if (row >= 0) useUi.getState().setSelection({ row, col: 'subject' });
        }}
      />
    );
  }

  // Tableau : la page tient dans la fenêtre, la grille défile seule et le pied reste en bas, entier.
  const fill = !itwSelected && !printView && !isMobile && nSeq > 0;
  return (
    <div className={['page page--wide', fill ? s.fill : ''].join(' ')}>
      <header className="page-head">
        <div className={s.toolbar} role="toolbar" aria-label="Outils de la grille">
          {/* Gauche : ce qu'on regarde (tableau, storyboard ou aperçu), puis l'action liée à la sélection. */}
          <div className={s.left}>
            {views}
            {previewToggle}
            {!printView && !interviewView && (linked || multi) && (
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
            {!printView && !interviewView && (
              <div className={s.icons}>
                <ColumnsMenu doc={doc} />
                {/* Téléphone : ni inspecteur ni panneau du scénario, seuls les champs du plan. */}
                {!isMobile && (
                  <>
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
                  </>
                )}
              </div>
            )}
            {!interviewView && <VersionSwitcher doc={storeDoc} />}
            {itwSelected ? <InterviewExport doc={storeDoc} /> : <CutExport doc={storeDoc} defaultContent="grid" />}
          </div>
        </div>
      </header>

      <OneShotStudio doc={storeDoc} />
      {interviewView ? (
        <InterviewPanel doc={storeDoc} />
      ) : itwSelected ? (
        <div className={[s.printPreview, 'paper-light'].join(' ')}>
          <InterviewPreview doc={storeDoc} />
        </div>
      ) : nSeq === 0 ? (
        <div className="card empty">
          <span className="hand">Aucune séquence pour l’instant</span>
          <p>Créez la première, ou importez un scénario.</p>
          <div className={s.emptyActions}>
            <Button ref={createFirst} variant="primary" autoFocus onClick={newSequenceAfter} data-testid="create-first">
              Créer la première séquence
            </Button>
            <Button variant="outline" onClick={() => navigate('scenario')}>
              Écrire ou importer un scénario
            </Button>
          </div>
        </div>
      ) : printView ? (
        <div className={[s.printPreview, 'paper-light'].join(' ')}>
          {/* Aperçu : les pages A4 de l'export (paysage par défaut), sur papier quel que soit le thème. */}
          <CutComments doc={storeDoc}>
            <ExportTable doc={doc} theme="papier" paper="A4" orientation={doc.project.settings.exportPrefs?.grid?.orientation ?? 'landscape'} safety={0} keepEmpty={keepEmpty} />
          </CutComments>
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
            {rightPanel === 'inspector' && <Inspector doc={storeDoc} shotId={selectedShot} issues={selectedShot ? (model.issues.get(selectedShot) ?? []) : []} />}
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
  const menuRef = useRef<HTMLDivElement>(null);
  // Le menu reste dans la fenêtre (téléphone : bouton parfois proche du bord gauche).
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const r = open ? menuRef.current?.getBoundingClientRect() : undefined;
    if (!r) return setShift(0);
    const margin = 8;
    if (r.left < margin) setShift(margin - r.left);
    else if (r.right > window.innerWidth - margin) setShift(window.innerWidth - margin - r.right);
  }, [open]);
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
        <div ref={menuRef} className={s.menu} style={shift ? { transform: `translateX(${shift}px)` } : undefined} role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className={s.menuTitle}>Colonnes de la grille</p>
          {listed.map((c) => {
            const on = cols.includes(c);
            const label = columnMenuLabel(c);
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
