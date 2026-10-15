import { useMemo, useState, type DragEvent } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ImagePlus, Printer } from 'lucide-react';
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
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { deleteShotById, dropShot } from '../grid/actions';
import { goToShot } from '../registry/RegistryPage';
import s from './StoryboardPage.module.css';

type PerPage = 2 | 4 | 6;

/** Storyboard (§15.1) : les plans en cartes, réordonnables, planche imprimable 2, 4 ou 6 par page. */
export function StoryboardPage({ doc }: { doc: ProjectDoc }) {
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const [perPage, setPerPage] = useState<PerPage>(4);
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

  const pages: ID[][] = [];
  for (let i = 0; i < allShots.length; i += perPage) pages.push(allShots.slice(i, i + perPage));

  return (
    <div className="page page--wide">
      <header className="page-head no-print">
        <div>
          <p className="page-kicker">Étape 5 · Storyboard</p>
          <h1 className="page-title">
            Les <em>{allShots.length}</em> plans en images
          </h1>
        </div>
        <div className={s.toolbar}>
          <div className={s.seg} role="radiogroup" aria-label="Plans par page">
            {([2, 4, 6] as PerPage[]).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={perPage === n} className={perPage === n ? s.on : ''} onClick={() => setPerPage(n)}>
                {n} / page
              </button>
            ))}
          </div>
          <Button variant="outline" icon={<Printer size={15} strokeWidth={1.25} />} onClick={() => window.print()} data-testid="storyboard-print">
            Planche PDF
          </Button>
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

      <div className={s.print} aria-hidden="true">
        {pages.map((ids, i) => (
          <div key={i} className={[s.sheet, s[`per${perPage}`]].join(' ')}>
            <header className={s.sheetHead}>
              <strong>{doc.project.title}</strong> · Storyboard · {doc.project.version}
              <span>
                planche {i + 1} / {pages.length}
              </span>
            </header>
            <div className={s.sheetGrid}>
              {ids.map((id) => (
                <Card key={id} doc={doc} shot={doc.shots[id]} timing={timing} printing />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SortableCard(props: { doc: ProjectDoc; shot: Shot; timing: Timing }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.shot.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.85 : 1 }}
      {...attributes}
      {...listeners}
      aria-roledescription="carte de storyboard déplaçable"
    >
      <Card {...props} />
    </div>
  );
}

function Card({ doc, shot, timing, printing = false }: { doc: ProjectDoc; shot: Shot; timing: Timing; printing?: boolean }) {
  const url = useBlobUrl(shot.storyboard?.blobKey);
  const [over, setOver] = useState(false);
  const block = doc.blocks[shot.actionBlockId];
  const meta = [valueLabel(shot.value, doc.project.settings.labelStyle), formatFocal(shot.focal, isZoom(shot.movement)), renderTokens(shot.movement, shot.movementSep)].filter(Boolean).join(' · ');
  const importImage = async (f: File | undefined) => {
    if (!f?.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, f.name, f);
    mutateDoc((d) => void (d.shots[shot.id].storyboard = { blobKey: key }));
  };
  const drop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    await importImage(e.dataTransfer.files[0]);
  };
  return (
    <article className={[s.card, shot.status === 'abandonné' ? s.dropped : ''].join(' ')} data-testid={printing ? undefined : 'storyboard-card'}>
      <div
        className={[s.frame, over ? s.over : ''].join(' ')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {url ? <img src={url} alt={`Storyboard du plan ${shotCode(doc, shot.id)}`} /> : !printing && <ImagePlus size={20} strokeWidth={1} aria-hidden="true" />}
        <span className={s.code}>{shotCode(doc, shot.id)}</span>
        {!printing && (
          <label className={s.import} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} title={url ? 'Remplacer l’image' : 'Importer une image'}>
            <ImagePlus size={13} strokeWidth={1.5} />
            {url ? 'Remplacer' : 'Importer'}
            <input
              type="file"
              accept="image/*"
              className="visually-hidden"
              aria-label={`Importer une image pour le plan ${shotCode(doc, shot.id)}`}
              onChange={(e) => {
                void importImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
        {!printing && url && (
          <button
            type="button"
            className={s.remove}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => mutateDoc((d) => void (d.shots[shot.id].storyboard = undefined))}
            aria-label={`Retirer l’image du plan ${shotCode(doc, shot.id)}`}
          >
            ×
          </button>
        )}
      </div>
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
