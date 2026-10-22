import { addKeyframe, framesOf, imageCount, removeFrame, setFrame, type Frame } from '../../domain/keyframes';
import { createPortal } from 'react-dom';
import { ASPECT_PRESETS, DEFAULT_ASPECT, aspectRatio, formatAspect, parseAspect } from '../../domain/aspect';
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ImagePlus, PenLine } from 'lucide-react';
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
          <ExportPanel
            doc={doc}
            id="storyboard"
            title="Exporter le storyboard"
            perPage={[1, 2, 3, 4, 6, 9]}
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
                  <div className={s.cards}>
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
            <strong>{doc.project.title}</strong> · Storyboard · {doc.project.version}
            <span>
              planche {i + 1} / {pages.length}
            </span>
          </header>
          <div className={s.sheetGrid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {ids.map(({ id, span }) => (
              <div key={id} style={{ gridColumn: `span ${span}`, minHeight: 0, display: 'flex' }}>
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
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.85 : 1, gridColumn: props.shot.keyframes?.length ? `span ${Math.min(3, props.shot.keyframes.length + 1)}` : undefined }}
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
  return printing ? <div className={s.frameCell}>{children}</div> : <>{children}</>;
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

/** Une keyframe : image importée ou dessinée, et une précision facultative. */
function FrameView({ doc, shot, index, count, frame, printing, ratio }: { doc: ProjectDoc; shot: Shot; index: number; count: number; frame: Frame; printing: boolean; ratio: number }) {
  const url = useBlobUrl(frame.blobKey);
  const [over, setOver] = useState(false);
  const [sketching, setSketching] = useState(false);
  const label = `${shotCode(doc, shot.id)}${count > 1 ? ` · K${index + 1}` : ''}`;
  const importImage = async (f: File | undefined) => {
    if (!f?.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, f.name, f);
    mutateDoc((d) => setFrame(d, shot.id, index, { blobKey: key, baseKey: undefined, sketch: undefined }));
  };
  return (
    <div className={s.frameWrap}>
      <div
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
        {url ? <img src={url} alt={`Storyboard du plan ${label}`} /> : !printing && <ImagePlus size={20} strokeWidth={1} aria-hidden="true" />}
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
        {!printing && (url || count > 1) && (
          <button type="button" className={s.remove} onPointerDown={(e) => e.stopPropagation()} onClick={() => mutateDoc((d) => removeFrame(d, shot.id, index))} aria-label={`Retirer l’image ${label}`}>
            ×
          </button>
        )}
      </div>
      {count > 1 &&
        (printing ? (
          frame.note && <p className={s.frameNote}>{frame.note}</p>
        ) : (
          <input
            className={s.frameNote}
            value={frame.note ?? ''}
            placeholder="Précision (facultatif)"
            aria-label={`Précision pour ${label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => mutateDoc((d) => setFrame(d, shot.id, index, { note: e.target.value || undefined }))}
          />
        ))}
    </div>
  );
}

function Card({ doc, shot, timing, printing = false }: { doc: ProjectDoc; shot: Shot; timing: Timing; printing?: boolean }) {
  const block = doc.blocks[shot.actionBlockId];
  const ratio = aspectRatio(doc.project.settings.storyboardAspect);
  const frames = framesOf(shot);
  const meta = [valueLabel(shot.value, doc.project.settings.labelStyle), formatFocal(shot.focal, isZoom(shot.movement)), renderTokens(shot.movement, shot.movementSep)].filter(Boolean).join(' · ');
  return (
    <article className={[s.card, shot.status === 'abandonné' ? s.dropped : ''].join(' ')} data-testid={printing ? undefined : 'storyboard-card'}>
      <FrameCell printing={printing}>
        {/* Keyframes d'un même plan : côte à côte, reliées, avec une seule fiche de découpage dessous. */}
        <div className={s.frames} style={{ '--n': frames.length, '--r': ratio } as React.CSSProperties}>
          {frames.map((f, i) => (
            <Fragment key={i}>
              {i > 0 && <span className={s.link} aria-hidden="true">›</span>}
              <FrameView doc={doc} shot={shot} index={i} count={frames.length} frame={f} printing={printing} ratio={ratio} />
            </Fragment>
          ))}
        </div>
      </FrameCell>
      {!printing && (
        <button type="button" className={s.addFrame} onPointerDown={(e) => e.stopPropagation()} onClick={() => mutateDoc((d) => addKeyframe(d, shot.id))} title="Ajouter une keyframe à ce plan (même plan, image suivante)" data-testid="storyboard-add-keyframe">
          + keyframe
        </button>
      )}
      <div className={s.body}>
        <p className={s.meta}>{meta || '—'}</p>
        <p className={s.subject}>{shot.subject}</p>
        <p className={s.action}>{block?.text}</p>
        <p className={s.foot}>
          <span className="mono">{formatTc(shotDurationSec(doc, timing, shot))}</span>
          {!printing && (
            <span>
              <button type="button" className={s.open} onPointerDown={(e) => e.stopPropagation()} onClick={() => goToShot(doc, shot.id)}>
                ouvrir
              </button>{' '}
              <button
                type="button"
                className={s.open}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => deleteShotById(shot.id)}
                aria-label={`Supprimer le plan ${shotCode(doc, shot.id)}`}
                data-testid="storyboard-delete"
              >
                supprimer
              </button>
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
