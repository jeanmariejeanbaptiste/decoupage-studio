import { NO_CROP, addKeyframe, cropStyle, framesOf, imageCount, removeFrame, setFrame, type Crop as CropT, type Frame } from '../../domain/keyframes';
import { createPortal } from 'react-dom';
import { ASPECT_PRESETS, DEFAULT_ASPECT, aspectRatio, formatAspect, parseAspect } from '../../domain/aspect';
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpRight, Crop, ImagePlus, PenLine, Trash2 } from 'lucide-react';
import { FramingIcon } from './FramingIcon';
import { SketchEditor } from './SketchEditor';
import { exportNodePages, waitForImages, waitForPages, type PageExportOptions } from '../export/imageExport';
import { ExportPanel } from '../export/ExportPanel';
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
import { Hand } from '../../ui/Hand';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { deleteShotById, dropShot } from '../grid/actions';
import { goToShot } from '../registry/RegistryPage';
import s from './StoryboardPage.module.css';


/** Storyboard (§15.1) : les plans en cartes, réordonnables, planche imprimable 2, 4 ou 6 par page. */
export function StoryboardPage({ doc }: { doc: ProjectDoc }) {
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


  const [imaging, setImaging] = useState<PageExportOptions | null>(null);
  const imagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!imaging || !imagesRef.current) return;
    const base = `${doc.project.title || 'projet'}-storyboard-A4-${imaging.orientation === 'portrait' ? 'portrait' : 'paysage'}`;
    const root = imagesRef.current;
    const expected = allShots.reduce((n, id) => n + (doc.shots[id] ? imageCount(doc.shots[id]) : 0), 0);
    void waitForPages(root, '[data-testid="storyboard-sheet"]')
      .then(async (p) => {
        await waitForImages(root, expected);
        return exportNodePages(p, base, imaging);
      })
      .finally(() => setImaging(null));
  }, [imaging]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page page--wide">
      <header className="page-head no-print">
        <div className={s.toolbar}>
          <AspectPicker doc={doc} />
          <PerRowPicker doc={doc} />
          <ExportPanel
            doc={doc}
            id="storyboard"
            title="Exporter le storyboard"
            perPage={[1, 2, 3, 4, 6, 9]}
            noNumbers
            disabled={allShots.length === 0 || !!imaging}
            onExport={({ format, orientation, numbers }) => setImaging({ format: format as 'pdf' | 'images', orientation, numbers })}
          >
            <label className={s.inkCheck}>
              <input
                type="checkbox"
                checked={!!doc.project.settings.exportInkSaver}
                onChange={(e) => mutateDoc((d) => void (d.project.settings.exportInkSaver = e.target.checked))}
              />
              Économie d’encre (cadres sans fond)
            </label>
          </ExportPanel>
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
                      <SortableCard key={id} doc={doc} shot={doc.shots[id]} timing={timing} />
                    ))}
                  </div>
                </SortableContext>
              </section>
            );
          })}
        </DndContext>
        <p className={s.hint}>
          <Hand>glisser une carte pour réordonner · « Importer » ou déposer une image sur un cadre pour l’illustrer</Hand>
        </p>
      </div>

      {/* Page paysage sans nom : Safari ignore les pages nommées (`page: storyboard`). */}
      <style>{'@media print { @page { size: A4 landscape; margin: 0; } }'}</style>
      <Sheets doc={doc} shots={allShots} perPage={perPage} timing={timing} className={s.print} />
      {imaging && (
        <div ref={imagesRef}>
          <Sheets
            doc={doc}
            shots={allShots}
            perPage={perPage}
            timing={timing}
            className={[s.print, s.imaging].join(' ')}
            orientation={imaging.orientation}
          />
        </div>
      )}
    </div>
  );
}

/** Grille d'une planche : colonnes × lignes selon le nombre de plans et l'orientation. */
function sheetDims(n: number, o: 'landscape' | 'portrait'): [number, number] {
  const land: Record<number, [number, number]> = { 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3] };
  const port: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] };
  return (o === 'portrait' ? port : land)[n] ?? [2, 2];
}

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

function Sheets({ doc, shots, perPage, timing, className, orientation }: { doc: ProjectDoc; shots: ID[]; perPage: number; timing: Timing; className: string; orientation?: 'landscape' | 'portrait' }) {
  const ink = !!doc.project.settings.exportInkSaver;
  const [cols, rows] = sheetDims(perPage, orientation ?? 'landscape');
  const pages = paginateShots(doc, shots, cols, rows);
  const size = orientation === 'portrait' ? { '--sheet-w': '210mm', '--sheet-h': '297mm' } : orientation ? { '--sheet-w': '297mm', '--sheet-h': '210mm' } : undefined;
  return (
    <div className={className} aria-hidden="true" style={size as React.CSSProperties | undefined}>
      {pages.map((ids, i) => (
        <div key={i} className={[s.sheet, ink ? s.ink : ''].join(' ')} data-testid="storyboard-sheet">
          <header className={s.sheetHead}>
            <strong>{doc.project.title}</strong>
            <span>Storyboard · {doc.project.version}</span>
            <span>
              planche {i + 1} / {pages.length}
            </span>
          </header>
          <div className={s.sheetGrid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
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

function SortableCard(props: { doc: ProjectDoc; shot: Shot; timing: Timing }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.shot.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.85 : 1}}
      {...attributes}
      {...listeners}
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
    <label className={s.aspect}>
      <span>Par ligne</span>
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

/** Choix du format d'image du storyboard : formats usuels ou valeur saisie. */
function AspectPicker({ doc }: { doc: ProjectDoc }) {
  const a = doc.project.settings.storyboardAspect ?? DEFAULT_ASPECT;
  const preset = ASPECT_PRESETS.findIndex((p) => Math.abs(p.w / p.h - a.w / a.h) < 0.001);
  const [custom, setCustom] = useState(preset < 0);
  const set = (v: { w: number; h: number }) => mutateDoc((d) => void (d.project.settings.storyboardAspect = v));
  return (
    <label className={s.aspect}>
      <span>Format</span>
      <select
        value={custom ? 'custom' : String(preset)}
        onChange={(e) => {
          if (e.target.value === 'custom') return setCustom(true);
          setCustom(false);
          const p = ASPECT_PRESETS[Number(e.target.value)];
          set({ w: p.w, h: p.h });
        }}
        aria-label="Format des images du storyboard"
        data-testid="storyboard-aspect"
      >
        {ASPECT_PRESETS.map((p, i) => (
          <option key={p.label} value={i}>
            {p.label}
          </option>
        ))}
        <option value="custom">Personnalisé…</option>
      </select>
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
    </label>
  );
}

/** Une keyframe : image importée ou dessinée. */
function FrameView({ doc, shot, index, count, frame, printing, ratio }: { doc: ProjectDoc; shot: Shot; index: number; count: number; frame: Frame; printing: boolean; ratio: number }) {
  const url = useBlobUrl(frame.blobKey);
  const [over, setOver] = useState(false);
  const [sketching, setSketching] = useState(false);
  // Recadrage : réglage local, enregistré d'un coup à la validation (un seul pas d'annulation).
  const [crop, setCrop] = useState<{ c: CropT; fit: 'cover' | 'contain' } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const label = `${shotCode(doc, shot.id)}${count > 1 ? ` · K${index + 1}` : ''}`;
  const importImage = async (f: File | undefined) => {
    if (!f?.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, f.name, f);
    mutateDoc((d) => setFrame(d, shot.id, index, { blobKey: key, baseKey: undefined, sketch: undefined, crop: undefined, fit: undefined }));
  };
  const shown: Frame = crop ? { ...frame, crop: crop.c, fit: crop.fit } : frame;
  const editing = !!crop;
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !editing) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop((v) => (v ? { ...v, c: { ...v.c, zoom: Math.max(0.3, Math.min(6, v.c.zoom * Math.exp(-e.deltaY * 0.0025))) } } : v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editing]);
  const zoomBy = (k: number) => setCrop((v) => (v ? { ...v, c: { ...v.c, zoom: Math.max(0.3, Math.min(6, v.c.zoom * k)) } } : v));
  return (
    <div className={s.frameWrap}>
      <div
        ref={frameRef}
        data-fit={shown.fit ?? 'cover'}
        data-crop={JSON.stringify(shown.crop ?? NO_CROP)}
        onPointerDownCapture={(e) => {
          if (!editing || (e.target as Element).closest('button')) return;
          e.stopPropagation();
          panFrom.current = { x: e.clientX, y: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const p = panFrom.current;
          if (!editing || !p) return;
          const r = e.currentTarget.getBoundingClientRect();
          const [dx, dy] = [((e.clientX - p.x) / r.width) * 100, ((e.clientY - p.y) / r.height) * 100];
          panFrom.current = { x: e.clientX, y: e.clientY };
          setCrop((v) => (v ? { ...v, c: { ...v.c, x: v.c.x + dx, y: v.c.y + dy } } : v));
        }}
        onPointerUp={() => (panFrom.current = null)}
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
        {url ? <img src={url} alt={`Storyboard du plan ${label}`} style={cropStyle(shown)} draggable={false} /> : !printing && <FramingIcon value={shot.value} focal={shot.focal.from} ratio={ratio} />}
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
        {!printing && url && !editing && (
          <button type="button" className={s.cropBtn} onPointerDown={(e) => e.stopPropagation()} onClick={() => setCrop({ c: frame.crop ?? NO_CROP, fit: frame.fit ?? 'cover' })} title="Recadrer : zoom, déplacement, rotation, remplir ou ajuster" data-testid="storyboard-crop">
            <Crop size={13} strokeWidth={1.5} />
          </button>
        )}
        {editing && crop && (
          <div className={s.cropBar} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => zoomBy(1 / 1.15)} aria-label="Dézoomer">−</button>
            <button type="button" onClick={() => zoomBy(1.15)} aria-label="Zoomer">+</button>
            <button type="button" onClick={() => setCrop({ ...crop, c: { ...crop.c, rot: crop.c.rot - 90 } })} aria-label="Pivoter à gauche">⟲</button>
            <button type="button" onClick={() => setCrop({ ...crop, c: { ...crop.c, rot: crop.c.rot + 90 } })} aria-label="Pivoter à droite">⟳</button>
            <input type="range" min={-45} max={45} step={0.5} value={((crop.c.rot % 90) + 135) % 90 - 45} onChange={(e) => setCrop({ ...crop, c: { ...crop.c, rot: Math.round(crop.c.rot / 90) * 90 + Number(e.target.value) } })} aria-label="Rotation fine" />
            <button type="button" className={s.fitSwitch} onClick={() => setCrop({ ...crop, fit: crop.fit === 'cover' ? 'contain' : 'cover' })} data-testid="storyboard-fit">
              {crop.fit === 'cover' ? 'Remplir' : 'Ajuster'}
            </button>
            <button type="button" onClick={() => setCrop({ c: NO_CROP, fit: 'cover' })}>Réinit.</button>
            <button type="button" onClick={() => setCrop(null)}>Annuler</button>
            <button
              type="button"
              className={s.cropOk}
              onClick={() => {
                mutateDoc((d) => setFrame(d, shot.id, index, { crop: crop.c, fit: crop.fit }));
                setCrop(null);
              }}
              data-testid="storyboard-crop-ok"
            >
              OK
            </button>
          </div>
        )}
        {!printing && (url || count > 1) && (
          <button type="button" className={s.remove} onPointerDown={(e) => e.stopPropagation()} onClick={() => mutateDoc((d) => removeFrame(d, shot.id, index))} aria-label={`Retirer l’image ${label}`}>
            ×
          </button>
        )}
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
              valueLabel(shot.value, doc.project.settings.labelStyle),
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
        {/* Fiche compacte : une ligne justifiée, dans l'ordre des colonnes, chaque nature d'info sa couleur. */}
        <p className={s.line}>
          {[
            <b key="s">{shot.subject || <em>sans sujet</em>}</b>,
            valueLabel(shot.value, doc.project.settings.labelStyle) && <span key="v" className={s.tValue}>{valueLabel(shot.value, doc.project.settings.labelStyle)}</span>,
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
