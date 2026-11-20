import { NO_CROP, addKeyframe, clampCrop, cropStyle, framesOf, imageCount, removeFrame, setFrame, type Crop as CropT, type Frame } from '../../domain/keyframes';
import { createPortal } from 'react-dom';
import { ASPECT_PRESETS, DEFAULT_ASPECT, aspectRatio, formatAspect, parseAspect } from '../../domain/aspect';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpRight, ChevronDown, Crop, ImagePlus, PenLine, Trash2 } from 'lucide-react';
import { ShotSketch } from './ShotSketch';
import { SketchEditor } from './SketchEditor';
import { exportNodePages, waitForImages, waitForPages, type PageExportOptions } from '../export/imageExport';
import { formatFocal } from '../../domain/focal';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import { shotDurationSec } from '../../domain/rows';
import { formatTc } from '../../domain/timecode';
import { computeTiming, type Timing } from '../../domain/timing';
import { renderTokens } from '../../domain/tokens';
import type { ID, ProjectDoc, Shot } from '../../domain/types';
import { isZoom, valueLabel } from '../../domain/vocabulary';
import { putBlob } from '../../store/db';
import { mutateDoc } from '../../store/projectStore';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { usePrintMedia } from '../../ui/usePrintMedia';
import { deleteShotById, dropShot } from '../grid/actions';
import { goToShot } from '../grid/goTo';
import s from './StoryboardPage.module.css';
import { exportBase } from '../../domain/serialize';
import { sheetChoices, sheetLayout, sheetPerPage } from '../../domain/storyboardSheet';
import { useUi } from '../../store/uiStore';
import { recoverStaleChunk } from '../../ui/staleChunk';
import { create } from 'zustand';

/** Séquences écartées de l'export du storyboard (le temps de la session, propre à chaque projet). */
const useSbExclude = create<{ projectId?: string; excluded: string[] }>(() => ({ excluded: [] }));
const excludedFor = (doc: ProjectDoc) => {
  const st = useSbExclude.getState();
  return st.projectId === doc.project.id ? st.excluded : [];
};


/** Planches du storyboard rendues hors écran le temps d'un export (PDF ou images A4). */
export function StoryboardImaging({ doc, imaging, onDone }: { doc: ProjectDoc; imaging: PageExportOptions; onDone: () => void }) {
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const perPage = doc.project.settings.exportPrefs?.storyboard?.perPage ?? 4;
  const excluded = excludedFor(doc);
  const allShots = doc.project.sequenceIds.filter((id) => !excluded.includes(id)).flatMap((id) => doc.sequences[id]?.shotIds ?? []);
  const imagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!imagesRef.current) return;
    const base = `${exportBase(doc)}-storyboard-A4-${imaging.orientation === 'portrait' ? 'portrait' : 'paysage'}`;
    const root = imagesRef.current;
    const expected = allShots.reduce((n, id) => n + (doc.shots[id] ? imageCount(doc.shots[id]) : 0), 0);
    void waitForPages(root, '[data-testid="storyboard-sheet"]')
      .then(async (p) => {
        await waitForImages(root, expected);
        return exportNodePages(p, base, imaging);
      })
      .catch((err) => {
        if (!recoverStaleChunk(err)) useUi.getState().toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
      })
      .finally(onDone);
  }, [imaging]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    // Papier blanc quel que soit le thème : l'export ne prend jamais les couleurs de l'écran sombre.
    <div ref={imagesRef} className="paper-light">
      <Sheets doc={doc} shots={allShots} perPage={perPage} timing={timing} className={[s.print, s.imaging].join(' ')} orientation={imaging.orientation} />
    </div>
  );
}

/**
 * Aperçu des planches du storyboard, telles qu'elles sortiront à l'export : mêmes réglages
 * (plans par planche, orientation, économie d'encre), réduites pour tenir dans la largeur.
 */
export function StoryboardPreview({ doc }: { doc: ProjectDoc }) {
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const prefs = doc.project.settings.exportPrefs?.storyboard;
  const perPage = prefs?.perPage ?? 4;
  const orientation = prefs?.orientation ?? 'landscape';
  const allShots = doc.project.sequenceIds.flatMap((id) => doc.sequences[id]?.shotIds ?? []);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Largeur d'une planche (mm → px), réduite pour tenir dans la colonne.
    const sheetPx = ((orientation === 'portrait' ? 210 : 297) * 96) / 25.4;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - 24) / sheetPx));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orientation]);
  if (!allShots.length) return <p className={s.previewEmpty}>Aucun plan à mettre en planche.</p>;
  return (
    <div ref={box} className={s.previewBox} data-testid="storyboard-preview">
      <div style={{ zoom }} className="paper-light">
        <Sheets doc={doc} shots={allShots} perPage={perPage} timing={timing} className={[s.print, s.previewSheets].join(' ')} orientation={orientation} visible />
      </div>
    </div>
  );
}

/** Réglages de l'export du storyboard (dans le panneau d'export). */
export function StoryboardExportOptions({ doc }: { doc: ProjectDoc }) {
  const st = useSbExclude();
  const excluded = st.projectId === doc.project.id ? st.excluded : [];
  const seqs = doc.project.sequenceIds.filter((id) => doc.sequences[id]?.shotIds.length);
  const chosen = seqs.filter((id) => !excluded.includes(id));
  // Au moins une séquence reste choisie : « Toutes » ne fait que tout rétablir.
  const setExcluded = (ids: string[]) => ids.length < seqs.length && useSbExclude.setState({ projectId: doc.project.id, excluded: ids });
  return (
    <>
      {seqs.length > 1 && (
        <details className={s.seqPick} data-testid="storyboard-export-sequences">
          <summary>
            Séquences <b>{chosen.length === seqs.length ? 'toutes' : `${chosen.length} / ${seqs.length}`}</b>
          </summary>
          <div className={s.seqList}>
            <label className={s.inkCheck}>
              <input type="checkbox" checked={chosen.length === seqs.length} disabled={chosen.length === seqs.length} onChange={() => setExcluded([])} />
              Toutes
            </label>
            {seqs.map((id) => (
              <label key={id} className={s.inkCheck}>
                <input
                  type="checkbox"
                  checked={!excluded.includes(id)}
                  onChange={(e) => setExcluded(e.target.checked ? excluded.filter((x) => x !== id) : [...excluded, id])}
                />
                {sequenceHeading(doc, id)}
              </label>
            ))}
          </div>
        </details>
      )}
      <label className={s.inkCheck}>
        <input type="checkbox" checked={!!doc.project.settings.exportInkSaver} onChange={(e) => mutateDoc((d) => void (d.project.settings.exportInkSaver = e.target.checked))} />
        Économie d’encre (cadres sans fond)
      </label>
    </>
  );
}

/**
 * Storyboard (§15.1) : les plans en cartes, réordonnables, planche imprimable 2, 4 ou 6 par page.
 * Vue du découpage technique : `lead` (choix de la vue) et `trail` (export) viennent de la page.
 */
export function StoryboardPage({ doc, lead, trail, selectedShot, onSelect }: { doc: ProjectDoc; lead?: ReactNode; trail?: ReactNode; selectedShot?: ID; onSelect?: (id: ID) => void }) {
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const perPage = doc.project.settings.exportPrefs?.storyboard?.perPage ?? 4;
  const perRow = doc.project.settings.storyboardPerRow;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const allShots = doc.project.sequenceIds.flatMap((id) => doc.sequences[id]?.shotIds ?? []);

  const onDragEnd = (e: DragEndEvent) => {
    const from = String(e.active.id);
    const to = e.over ? String(e.over.id) : null;
    if (!to || from === to) return;
    const target = doc.shots[to];
    if (!target) return;
    const index = doc.sequences[target.sequenceId].shotIds.indexOf(to);
    void dropShot(from, target.sequenceId, index);
  };


  const printing = usePrintMedia();
  // Le plan choisi dans le tableau est montré à l'arrivée sur le storyboard.
  useEffect(() => {
    if (selectedShot) document.querySelector(`[data-shot-card="${selectedShot}"]`)?.scrollIntoView({ block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page page--wide">
      <header className="page-head no-print">
        <div className={s.bar}>
          <div className={s.barLead}>{lead}</div>
          <div className={s.toolbar}>
            <span className={s.opts} data-edit>
              <AspectPicker doc={doc} />
              <PerRowPicker doc={doc} />
            </span>
            {trail}
          </div>
        </div>
      </header>

      <div className="no-print">
        {allShots.length === 0 && (
          <div className="card empty">
            <span className="hand">Aucun plan pour l’instant</span>
            <p>Le storyboard se remplit à partir du découpage.</p>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {doc.project.sequenceIds.map((seqId) => {
            const seq = doc.sequences[seqId];
            if (!seq?.shotIds.length) return null;
            return (
              <section key={seqId} className={s.seq}>
                <h2 className={s.h2}>{sequenceHeading(doc, seqId)}</h2>
                <SortableContext items={seq.shotIds} strategy={rectSortingStrategy}>
                  <div className={s.cards} style={perRow ? { gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` } : undefined}>
                    {seq.shotIds.map((id) => (
                      <SortableCard key={id} doc={doc} shot={doc.shots[id]} timing={timing} selected={id === selectedShot} onSelect={onSelect} />
                    ))}
                  </div>
                </SortableContext>
              </section>
            );
          })}
        </DndContext>
      </div>

      {/* Page paysage sans nom : Safari ignore les pages nommées (`page: storyboard`). */}
      <style>{'@media print { @page { size: A4 landscape; margin: 0; } }'}</style>
      {printing && <Sheets doc={doc} shots={allShots} perPage={perPage} timing={timing} className={s.print} />}
    </div>
  );
}

/** Grille d'une planche : colonnes × lignes selon le nombre de plans et l'orientation. */
/**
 * Répartit les plans en planches : chaque keyframe occupe une case entière (même taille qu'un plan
 * simple), un plan à plusieurs keyframes s'étale donc sur plusieurs cases d'une même ligne.
 */
function paginateShots(doc: ProjectDoc, shots: ID[], cols: number, rows: number): Array<Array<{ id: ID; span: number }>> {
  const pages: Array<Array<{ id: ID; span: number }>> = [[]];
  let row = 0;
  let col = 0;
  for (const id of shots) {
    const span = Math.min(cols, doc.shots[id] ? framesOf(doc.shots[id]).length : 1);
    if (col + span > cols) {
      row++;
      col = 0;
    }
    if (row >= rows) {
      pages.push([]);
      row = 0;
      col = 0;
    }
    pages[pages.length - 1].push({ id, span });
    col += span;
  }
  return pages.filter((p) => p.length);
}

function Sheets({ doc, shots, perPage, timing, className, orientation, visible = false }: { doc: ProjectDoc; shots: ID[]; perPage: number; timing: Timing; className: string; orientation?: 'landscape' | 'portrait'; visible?: boolean }) {
  const ink = !!doc.project.settings.exportInkSaver;
  // Grille calculée pour le format des images : seuls les nombres de cases qui remplissent bien la
  // feuille sont retenus ; le reste de hauteur va en marges, un peu plus en bas qu'en haut.
  const o = orientation ?? 'landscape';
  const ratio = aspectRatio(doc.project.settings.storyboardAspect);
  const layout = sheetLayout(sheetPerPage(perPage, sheetChoices(ratio, o)), ratio, o);
  const { cols, rows } = layout;
  const pages = paginateShots(doc, shots, cols, rows);
  // Feuille A4 réelle (export, aperçu) : cases à leur taille exacte ; impression du navigateur
  // (hauteur prudente) : la grille s'étire.
  const fixed = !!orientation;
  const gridStyle: React.CSSProperties = fixed
    ? {
        gridTemplateColumns: `repeat(${cols}, ${layout.cellW.toFixed(2)}mm)`,
        gridTemplateRows: `repeat(${rows}, ${layout.cellH.toFixed(2)}mm)`,
        justifyContent: 'center',
        alignContent: 'start',
        rowGap: `${layout.rowGap.toFixed(2)}mm`,
        flex: 'none',
        marginTop: `${layout.top.toFixed(2)}mm`,
      }
    : { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` };
  const size = orientation === 'portrait' ? { '--sheet-w': '210mm', '--sheet-h': '297mm' } : orientation ? { '--sheet-w': '297mm', '--sheet-h': '210mm' } : undefined;
  return (
    <div className={className} aria-hidden={visible ? undefined : true} style={size as React.CSSProperties | undefined}>
      {pages.map((ids, i) => (
        <div key={i} className={[s.sheet, ink ? s.ink : ''].join(' ')} data-testid="storyboard-sheet">
          <header className={s.sheetHead}>
            <strong>{doc.project.title}</strong>
            <span>Storyboard · {doc.project.version}</span>
            <span>
              planche {i + 1} / {pages.length}
            </span>
          </header>
          <div className={s.sheetGrid} style={gridStyle} data-grid={`${cols}x${rows}`}>
            {ids.map(({ id, span }) => (
              <div key={id} className={s.cell} style={{ gridColumn: `span ${span}` }}>
                <Card doc={doc} shot={doc.shots[id]} timing={timing} printing />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SortableCard({ selected, onSelect, ...props }: { doc: ProjectDoc; shot: Shot; timing: Timing; selected?: boolean; onSelect?: (id: ID) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.shot.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.85 : 1 }}
      {...attributes}
      {...listeners}
      className={selected ? s.selected : undefined}
      data-shot-card={props.shot.id}
      data-selected={selected || undefined}
      // Choisir une carte la sélectionne aussi dans le tableau.
      onClickCapture={() => onSelect?.(props.shot.id)}
      aria-roledescription="carte de storyboard déplaçable"
    >
      <Card {...props} />
    </div>
  );
}

/** À l'impression, la case occupe la place libre et le cadre y tient au bon format (centré). */
function FrameCell({ printing, children }: { printing: boolean; children: React.ReactNode }) {
  void printing;
  return <>{children}</>;
}

/** Nombre de cartes par ligne dans la page (automatique par défaut, selon la largeur). */
function PerRowPicker({ doc }: { doc: ProjectDoc }) {
  const v = doc.project.settings.storyboardPerRow;
  return (
    <label className={s.opt}>
      <span className={s.optName}>Par ligne</span>
      <span className={s.optValue}>{v ?? 'Auto'}</span>
      <ChevronDown size={13} strokeWidth={1.4} aria-hidden="true" />
      <select
        value={v ?? ''}
        onChange={(e) => mutateDoc((d) => void (d.project.settings.storyboardPerRow = e.target.value ? Number(e.target.value) : undefined))}
        aria-label="Plans par ligne"
        data-testid="storyboard-per-row"
      >
        <option value="">Auto</option>
        {[1, 2, 3, 4, 5, 6, 8].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Vignette d'une keyframe dans la bande de navigation d'une carte. */
function FrameThumb({ frame, label, active, ratio, onPick }: { frame: Frame; label: string; active: boolean; ratio: number; onPick: () => void }) {
  const url = useBlobUrl(frame.blobKey);
  return (
    <button
      type="button"
      className={[s.thumb, active ? s.thumbOn : ''].join(' ')}
      style={{ aspectRatio: String(ratio) }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onPick}
      aria-label={`Afficher ${label}`}
      aria-pressed={active}
    >
      {url ? <img src={url} alt="" style={cropStyle(frame)} draggable={false} /> : null}
      <span>{label}</span>
    </button>
  );
}

/** Silhouette d'un format : un rectangle à sa proportion, au trait. */
function RatioIcon({ ratio, dashed }: { ratio: number; dashed?: boolean }) {
  const [bw, bh] = [18, 12];
  const [w, h] = ratio >= bw / bh ? [bw, bw / ratio] : [bh * ratio, bh];
  return (
    <svg className={s.ratioIcon} width={bw + 2} height={bh + 2} viewBox={`-1 -1 ${bw + 2} ${bh + 2}`} aria-hidden="true">
      <rect x={(bw - w) / 2} y={(bh - h) / 2} width={w} height={h} rx={1} fill="none" stroke="currentColor" strokeWidth={1.1} strokeDasharray={dashed ? '2 1.6' : undefined} />
    </svg>
  );
}

/** Choix du format d'image du storyboard : formats usuels (silhouette et rapport) ou valeur saisie. */
function AspectPicker({ doc }: { doc: ProjectDoc }) {
  const a = doc.project.settings.storyboardAspect ?? DEFAULT_ASPECT;
  const preset = ASPECT_PRESETS.findIndex((p) => Math.abs(p.w / p.h - a.w / a.h) < 0.001);
  const [custom, setCustom] = useState(preset < 0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Format changé ailleurs (annulation, autre participant) : le choix suit.
  useEffect(() => setCustom(preset < 0), [a.w, a.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: { w: number; h: number }) => mutateDoc((d) => void (d.project.settings.storyboardAspect = v));
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const choose = (i: number | 'custom') => {
    setOpen(false);
    if (i === 'custom') return setCustom(true);
    setCustom(false);
    set({ w: ASPECT_PRESETS[i].w, h: ASPECT_PRESETS[i].h });
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      box.current?.querySelector<HTMLElement>('button')?.focus();
    }
  };
  return (
    <div ref={box} className={[s.opt, s.aspectOpt].join(' ')}>
      <button
        type="button"
        className={s.aspectBtn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Format des images du storyboard : ${custom ? 'personnalisé' : formatAspect(a)}`}
        onClick={() => setOpen((v) => !v)}
        data-testid="storyboard-aspect"
      >
        <span className={s.optName}>Format</span>
        <RatioIcon ratio={aspectRatio(a)} dashed={custom} />
        <span className={s.optValue}>{custom ? 'Personnalisé' : formatAspect(a)}</span>
        <ChevronDown size={13} strokeWidth={1.4} aria-hidden="true" />
      </button>
      {open && (
        <div ref={list} className={s.aspectList} role="listbox" aria-label="Format des images" onKeyDown={onListKey}>
          {ASPECT_PRESETS.map((p, i) => (
            <button key={p.label} type="button" role="option" aria-selected={!custom && i === preset} className={s.aspectItem} onClick={() => choose(i)} data-testid="storyboard-aspect-option">
              <RatioIcon ratio={p.w / p.h} />
              <span>{p.label}</span>
            </button>
          ))}
          <button type="button" role="option" aria-selected={custom} className={s.aspectItem} onClick={() => choose('custom')} data-testid="storyboard-aspect-option">
            <RatioIcon ratio={aspectRatio(a)} dashed />
            <span>Personnalisé…</span>
          </button>
        </div>
      )}
      {custom && (
        <input
          key={formatAspect(a)}
          defaultValue={formatAspect(a)}
          inputMode="decimal"
          placeholder="ex. 2.76:1"
          aria-label="Format personnalisé (largeur:hauteur)"
          data-testid="storyboard-aspect-custom"
          onBlur={(e) => {
            const v = parseAspect(e.target.value);
            if (v) set(v);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </div>
  );
}

/** Une keyframe : image importée ou dessinée. */
function FrameView({ doc, shot, index, count, frame, printing, ratio }: { doc: ProjectDoc; shot: Shot; index: number; count: number; frame: Frame; printing: boolean; ratio: number }) {
  const url = useBlobUrl(frame.blobKey);
  const [over, setOver] = useState(false);
  const [sketching, setSketching] = useState(false);
  // Recadrage : dans sa fenêtre, enregistré d'un coup à la validation (un seul pas d'annulation).
  const [cropping, setCropping] = useState(false);
  const label = `${shotCode(doc, shot.id)}${count > 1 ? ` · K${index + 1}` : ''}`;
  const importImage = async (f: File | undefined) => {
    if (!f?.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, f.name, f);
    mutateDoc((d) => setFrame(d, shot.id, index, { blobKey: key, baseKey: undefined, sketch: undefined, crop: undefined, fit: undefined }));
  };
  return (
    <div className={s.frameWrap}>
      <div
        data-fit={frame.fit ?? 'cover'}
        data-crop={JSON.stringify(frame.crop ?? NO_CROP)}
        className={[s.frame, over ? s.over : ''].join(' ')}
        style={{ aspectRatio: String(ratio) }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          void importImage(e.dataTransfer.files[0]);
        }}
      >
        {url ? <img src={url} alt={`Storyboard du plan ${label}`} style={cropStyle(frame, ratio)} draggable={false} /> : !printing && <ShotSketch doc={doc} shot={shot} ratio={ratio} />}
        <span className={s.code} data-label>
          {label}
        </span>
        {!printing && (
          <label className={s.import} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} title={url ? 'Remplacer l’image' : 'Importer une image'}>
            <ImagePlus size={13} strokeWidth={1.5} />
            {url ? 'Remplacer' : 'Importer'}
            <input
              type="file"
              accept="image/*"
              className="visually-hidden"
              aria-label={`Importer une image pour le plan ${label}`}
              onChange={(e) => {
                void importImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
        {!printing && (
          <button type="button" className={s.draw} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSketching(true)} title={url ? 'Dessiner, écrire ou poser des flèches sur l’image' : 'Dessiner la case'} data-testid="storyboard-draw">
            <PenLine size={13} strokeWidth={1.5} />
            Dessiner
          </button>
        )}
        {sketching && createPortal(<SketchEditor doc={doc} shotId={shot.id} frame={index} onClose={() => setSketching(false)} />, document.body)}
        {!printing && url && (
          <button type="button" className={s.cropBtn} onPointerDown={(e) => e.stopPropagation()} onClick={() => setCropping(true)} title="Recadrer" data-testid="storyboard-crop">
            <Crop size={13} strokeWidth={1.5} />
          </button>
        )}
        {cropping && url && createPortal(<CropDialog url={url} frame={frame} ratio={ratio} label={label} onClose={() => setCropping(false)} onSave={(c, fit) => mutateDoc((d) => setFrame(d, shot.id, index, { crop: c, fit }))} />, document.body)}
        {!printing && (url || count > 1) && (
          <button type="button" className={s.remove} onPointerDown={(e) => e.stopPropagation()} onClick={() => mutateDoc((d) => removeFrame(d, shot.id, index))} aria-label={`Retirer l’image ${label}`}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Fenêtre de recadrage d'une image du storyboard : grand cadre au format du storyboard, glisser pour
 * déplacer, molette ou curseur pour zoomer, rotation, remplir ou ajuster. En « remplir », l'image
 * couvre toujours tout le cadre : impossible de laisser une bande vide.
 */
function CropDialog({ url, frame, ratio, label, onClose, onSave }: { url: string; frame: Frame; ratio: number; label: string; onClose: () => void; onSave: (c: CropT, fit: 'cover' | 'contain') => void }) {
  const [c, setC] = useState<CropT>(frame.crop ?? NO_CROP);
  const [fit, setFit] = useState<'cover' | 'contain'>(frame.fit ?? 'cover');
  const boxRef = useRef<HTMLDivElement>(null);
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const shown = fit === 'cover' ? clampCrop(c, ratio) : c;
  const zoomBy = (k: number) => setC((v) => ({ ...v, zoom: Math.max(0.3, Math.min(6, (fit === 'cover' ? clampCrop(v, ratio) : v).zoom * k)) }));
  const save = () => {
    onSave(shown, fit);
    onClose();
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0025));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const fine = ((c.rot % 90) + 135) % 90 - 45;
  return (
    <div className={s.cropOverlay} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={s.cropDialog}
        role="dialog"
        aria-label={`Recadrer l’image du plan ${label}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && !(e.target as Element).closest('button')) save();
        }}
        data-testid="storyboard-crop-dialog"
      >
        <div
          ref={boxRef}
          className={s.cropStage}
          style={{ aspectRatio: String(ratio) }}
          onPointerDown={(e) => {
            panFrom.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
            setC(shown);
          }}
          onPointerMove={(e) => {
            const p = panFrom.current;
            if (!p) return;
            const r = e.currentTarget.getBoundingClientRect();
            const [dx, dy] = [((e.clientX - p.x) / r.width) * 100, ((e.clientY - p.y) / r.height) * 100];
            panFrom.current = { x: e.clientX, y: e.clientY };
            setC((v) => {
              const n = { ...v, x: v.x + dx, y: v.y + dy };
              return fit === 'cover' ? clampCrop(n, ratio) : n;
            });
          }}
          onPointerUp={() => (panFrom.current = null)}
        >
          <img src={url} alt="" style={cropStyle({ crop: shown, fit })} draggable={false} />
        </div>
        <div className={s.cropTools}>
          <div className={s.cropGroup}>
            <button type="button" onClick={() => zoomBy(1 / 1.15)} aria-label="Dézoomer" title="Dézoomer">−</button>
            <input type="range" min={fit === 'cover' ? clampCrop({ ...c, zoom: 0.3 }, ratio).zoom : 0.3} max={6} step={0.01} value={shown.zoom} onChange={(e) => setC({ ...shown, zoom: Number(e.target.value) })} aria-label="Zoom" />
            <button type="button" onClick={() => zoomBy(1.15)} aria-label="Zoomer" title="Zoomer">+</button>
          </div>
          <div className={s.cropGroup}>
            <button type="button" onClick={() => setC({ ...shown, rot: shown.rot - 90 })} aria-label="Pivoter à gauche" title="Pivoter à gauche">⟲</button>
            <input type="range" min={-45} max={45} step={0.5} value={fine} onChange={(e) => setC({ ...shown, rot: Math.round(c.rot / 90) * 90 + Number(e.target.value) })} aria-label="Rotation fine" />
            <button type="button" onClick={() => setC({ ...shown, rot: shown.rot + 90 })} aria-label="Pivoter à droite" title="Pivoter à droite">⟳</button>
          </div>
          <div className={s.cropSeg} role="radiogroup" aria-label="Cadrage">
            <button type="button" role="radio" aria-checked={fit === 'cover'} className={fit === 'cover' ? s.cropSegOn : ''} onClick={() => setFit('cover')} data-testid={fit === 'contain' ? 'storyboard-fit' : undefined}>Remplir</button>
            <button type="button" role="radio" aria-checked={fit === 'contain'} className={fit === 'contain' ? s.cropSegOn : ''} onClick={() => setFit('contain')} data-testid={fit === 'cover' ? 'storyboard-fit' : undefined}>Ajuster</button>
          </div>
          <span className={s.cropSpacer} />
          <button type="button" className={s.cropText} onClick={() => { setC(NO_CROP); setFit('cover'); }}>Réinitialiser</button>
          <button type="button" className={s.cropText} onClick={onClose}>Annuler</button>
          <button type="button" className={s.cropOk} onClick={save} data-testid="storyboard-crop-ok" autoFocus>Valider</button>
        </div>
      </div>
    </div>
  );
}

function Card({ doc, shot, timing, printing = false }: { doc: ProjectDoc; shot: Shot; timing: Timing; printing?: boolean }) {
  const block = doc.blocks[shot.actionBlockId];
  const ratio = aspectRatio(doc.project.settings.storyboardAspect);
  const frames = framesOf(shot);
  // À l'écran, une keyframe à la fois (carte de taille constante), les autres en bande de vignettes.
  const [cur, setCur] = useState(0);
  const k = Math.min(cur, frames.length - 1);
  const addFrame = () => {
    mutateDoc((d) => addKeyframe(d, shot.id));
    setCur(frames.length);
  };
  return (
    <article
      className={[s.card, shot.status === 'abandonné' ? s.dropped : ''].join(' ')}
      style={printing ? ({ '--r': ratio, '--n': frames.length } as React.CSSProperties) : undefined}
      data-testid={printing ? undefined : 'storyboard-card'}
    >
      <FrameCell printing={printing}>
        {/* Keyframes d'un même plan : côte à côte, reliées, avec une seule fiche de découpage dessous. */}
        <div className={s.frames} style={{ '--n': frames.length, '--r': ratio } as React.CSSProperties}>
          {printing ? (
            frames.map((f, i) => (
              <Fragment key={i}>
                {i > 0 && <span className={s.link} aria-hidden="true">›</span>}
                <FrameView doc={doc} shot={shot} index={i} count={frames.length} frame={f} printing ratio={ratio} />
              </Fragment>
            ))
          ) : (
            <FrameView key={k} doc={doc} shot={shot} index={k} count={frames.length} frame={frames[k]} printing={false} ratio={ratio} />
          )}
        </div>
      </FrameCell>
      {!printing && frames.length > 1 && (
        <div className={s.strip} aria-label="Keyframes du plan">
          {frames.map((f, i) => (
            <FrameThumb key={i} frame={f} label={`K${i + 1}`} active={i === k} ratio={ratio} onPick={() => setCur(i)} />
          ))}
          <button type="button" className={s.stripAdd} onPointerDown={(e) => e.stopPropagation()} onClick={addFrame} title="Ajouter une keyframe" data-testid="storyboard-add-keyframe">
            +
          </button>
        </div>
      )}
      {!printing && frames.length < 2 && (
        <button type="button" className={s.addFrame} onPointerDown={(e) => e.stopPropagation()} onClick={addFrame} title="Ajouter une keyframe à ce plan (même plan, image suivante)" data-testid="storyboard-add-keyframe">
          + keyframe
        </button>
      )}
      {printing ? (
        // Planche : une seule ligne justifiée, dans l'ordre des colonnes du découpage.
        <div className={s.body}>
          <p className={s.line}>
            {[
              shot.subject && <b key="s">{shot.subject}</b>,
              valueLabel(shot.value, doc.project.settings.labelStyle, doc.customVocabulary),
              renderTokens(shot.angle),
              renderTokens(shot.movement, shot.movementSep),
              formatFocal(shot.focal, isZoom(shot.movement)),
              block?.text,
              <span key="tc" className="mono">{formatTc(shotDurationSec(doc, timing, shot))}</span>,
            ]
              .filter(Boolean)
              .flatMap((x, i) => (i ? [' · ', x] : [x]))}
          </p>
        </div>
      ) : (
      <div className={s.body}>
        {/* Fiche compacte : une ligne justifiée, dans l'ordre des colonnes (valeur en noir, le reste en gris). */}
        <p className={s.line}>
          {[
            <b key="s">{shot.subject || <em>sans sujet</em>}</b>,
            valueLabel(shot.value, doc.project.settings.labelStyle, doc.customVocabulary) && <span key="v" className={s.tValue}>{valueLabel(shot.value, doc.project.settings.labelStyle, doc.customVocabulary)}</span>,
            renderTokens(shot.angle) && <span key="a" className={s.tAngle}>{renderTokens(shot.angle)}</span>,
            renderTokens(shot.movement, shot.movementSep) && <span key="m" className={s.tMove}>{renderTokens(shot.movement, shot.movementSep)}</span>,
            formatFocal(shot.focal, isZoom(shot.movement)) && <span key="f" className={s.tFocal}>{formatFocal(shot.focal, isZoom(shot.movement))}</span>,
            block?.text && <span key="t">{block.text}</span>,
            <span key="d" className={s.tDur}>{formatTc(shotDurationSec(doc, timing, shot))}</span>,
          ]
            .filter(Boolean)
            .flatMap((x, i) => (i ? [<span key={`sep${i}`} className={s.dot}> · </span>, x] : [x]))}
        </p>
        <span className={s.icons}>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => goToShot(doc, shot.id)} aria-label={`Ouvrir le plan ${shotCode(doc, shot.id)} dans le découpage`} title="Ouvrir dans le découpage">
            <ArrowUpRight size={14} strokeWidth={1.5} />
          </button>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteShotById(shot.id)} aria-label={`Supprimer le plan ${shotCode(doc, shot.id)}`} title="Supprimer le plan" data-testid="storyboard-delete">
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </span>
      </div>
      )}
    </article>
  );
}
