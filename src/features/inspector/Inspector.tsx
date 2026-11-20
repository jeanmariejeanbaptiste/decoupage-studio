import { newId } from '../../domain/factory';
import { formatOneShotDuration, oneShotTiming, toggleOneShot } from '../../domain/oneshot';
import { Fragment, useEffect, useState, type DragEvent } from 'react';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { ImagePlus, PanelRightClose, Plus, Trash2 } from 'lucide-react';
import { setCellText } from '../../domain/cells';
import { deduceEquipment, EQUIPMENT_CATEGORIES } from '../../domain/equipment';
import { diagonalFov, fullFrameEquivalent, horizontalFov } from '../../domain/focal';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import type { ID, ProjectDoc } from '../../domain/types';
import { isZoom } from '../../domain/vocabulary';
import { putBlob } from '../../store/db';
import { cropStyle, removeFrame, setFrame } from '../../domain/keyframes';
import { aspectRatio } from '../../domain/aspect';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { FovCone } from './FovCone';
import { RuleMaker } from './RuleMaker';
import { effectiveShot } from '../../domain/rules';
import { camerasForShot } from '../../domain/floorplan';
import s from './Inspector.module.css';


export function Inspector({ doc, shotId }: { doc: ProjectDoc; shotId: ID | undefined }) {
  const set = useUi((u) => u.set);
  const shot = shotId ? doc.shots[shotId] : undefined;
  const thumb = useBlobUrl(shot?.storyboard?.blobKey);
  const [over, setOver] = useState(false);

  if (!shot) {
    return (
      <aside className={s.panel} aria-label="Inspecteur du plan">
        <Header onClose={() => set({ rightPanel: null })} />
        <p className={s.empty}>
          <Hand>Sélectionnez un plan</Hand>
          <br />
          pour voir son angle de champ, son matériel et ses notes.
        </p>
      </aside>
    );
  }

  const seq = doc.sequences[shot.sequenceId];
  const decor = seq?.decorId ? doc.decors[seq.decorId] : undefined;
  const st = doc.project.settings;
  // Ce que le plan est vraiment, règles comprises : focale, matériel et champ en découlent.
  const eff = effectiveShot(doc, shot).shot;
  const zoom = isZoom(eff.movement);
  const focals = [eff.focal.from, zoom ? eff.focal.to : undefined].filter((f): f is number => f !== undefined);
  const equipment = deduceEquipment(eff);
  const block = doc.blocks[shot.actionBlockId];
  const update = (fn: (d: ProjectDoc) => void) => mutateDoc(fn);
  const code = shotCode(doc, shot.id);
  const cameras = camerasForShot(doc, shot.id);

  const dropImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, file.name, file);
    update((d) => setFrame(d, shot.id, 0, { blobKey: key, baseKey: undefined, sketch: undefined, crop: undefined, fit: undefined, baseCrop: undefined, baseFit: undefined, sketchAspect: undefined }));
  };
  const fmt = (n: number) => n.toFixed(1).replace('.', ',');

  return (
    <aside className={s.panel} aria-label="Inspecteur du plan" data-testid="inspector">
      <Header onClose={() => set({ rightPanel: null })} />
      {/* Rapport : des cases séparées par des filets, comme un rapport caméra. */}
      <div className={s.report}>
        <div className={[s.cell, s.span2].join(' ')}>
          <span className={s.k}>Plan</span>
          <span className={s.big}>{code}</span>
          <span className="visually-hidden">Plan {code}</span>
        </div>
        <div className={s.cell}>
          <span className={s.k}>Int./ext.</span>
          <span className={s.v}>{seq?.intExt ?? '—'}</span>
          <span className={s.k}>Effet</span>
          <span className={s.v}>{seq?.effect ?? '—'}</span>
        </div>
        <div className={[s.cell, s.full].join(' ')}>
          <span className={s.k}>Séquence</span>
          <span className={s.v}>
            {sequenceHeading(doc, shot.sequenceId)}
            {decor && decor.name.toUpperCase() !== seq?.label.toUpperCase() ? ` · ${decor.name}` : ''}
          </span>
        </div>
        <div className={[s.cell, s.full, s.rowCell].join(' ')}>
          <span className={s.k}>Type</span>
          <div className={s.seg} role="radiogroup" aria-label="Type de plan">
            <button type="button" role="radio" aria-checked={!shot.oneShot} className={!shot.oneShot ? s.segOn : ''} onClick={() => shot.oneShot && update((d) => toggleOneShot(d, shot.id))}>
              Plan
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!!shot.oneShot}
              className={shot.oneShot ? s.segOn : ''}
              onClick={() => {
                if (!shot.oneShot) update((d) => toggleOneShot(d, shot.id));
                set({ oneShotEditor: shot.id });
              }}
              data-testid={shot.oneShot ? 'open-oneshot' : 'make-oneshot'}
              title={shot.oneShot ? 'Ouvrir la chorégraphie' : undefined}
            >
              Plan-séquence{shot.oneShot ? ` · ${shot.oneShot.beats.length} temps${formatOneShotDuration(oneShotTiming(shot.oneShot.beats)) ? ` · ${formatOneShotDuration(oneShotTiming(shot.oneShot.beats))}` : ''}` : ''}
            </button>
          </div>
        </div>

        <div
          className={[s.cell, s.full, s.thumb, over ? s.over : ''].join(' ')}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setOver(false);
            void dropImage(e.dataTransfer.files[0]);
          }}
        >
          {thumb ? (
            <>
              <img src={thumb} alt={`Storyboard du plan ${code}`} style={{ aspectRatio: String(aspectRatio(st.storyboardAspect)), ...(shot.storyboard ? cropStyle(shot.storyboard, aspectRatio(st.storyboardAspect)) : {}) }} />
              <Button variant="icon" size="sm" className={s.thumbDel} aria-label="Retirer la vignette" icon={<Trash2 size={13} />} onClick={() => update((d) => removeFrame(d, shot.id, 0))} />
            </>
          ) : (
            <label className={s.thumbEmpty}>
              <ImagePlus size={18} strokeWidth={1.25} />
              <span>Ajouter une image</span>
              <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => void dropImage(e.target.files?.[0])} />
            </label>
          )}
          <div className={s.keyframes}>
            {(shot.keyframes ?? []).map((k, i) => (
              <KeyThumb key={k.id} blobKey={k.blobKey} label={`K${i + 2}`} />
            ))}
            <label className={s.addKey} title="Ajouter une image à ce plan (keyframe suivante)" aria-label="Ajouter une keyframe">
              <Plus size={12} strokeWidth={1.5} />
              <input
                type="file"
                accept="image/*"
                className="visually-hidden"
                data-testid="inspector-add-keyframe"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f?.type.startsWith('image/')) return;
                  const key = await putBlob(doc.project.id, f.name, f);
                  update((d) => {
                    if (!d.shots[shot.id].storyboard) d.shots[shot.id].storyboard = { blobKey: key };
                    else (d.shots[shot.id].keyframes ??= []).push({ id: newId(), blobKey: key });
                  });
                }}
              />
            </label>
          </div>
        </div>

        {block?.scenarioAnchor && doc.scenario && (
          <div className={[s.cell, s.full].join(' ')}>
            <span className={s.k}>Scénario</span>
            <p className={s.passage} data-testid="inspector-passage">
              {doc.scenario.slice(block.scenarioAnchor.start, block.scenarioAnchor.end)}
            </p>
          </div>
        )}

        <div className={[s.cell, s.full].join(' ')}>
          <span className={s.k}>Champ</span>
          {focals.length ? (
            <div className={s.fov}>
              <FovCone degrees={horizontalFov(focals[0], st.cropFactor)} secondary={focals[1] !== undefined ? horizontalFov(focals[1], st.cropFactor) : undefined} />
              <dl className={s.kv}>
                <dt>Focale</dt>
                <dd>{focals.map((f) => `${f} mm`).join(' → ')}</dd>
                <dt>Horizontal</dt>
                <dd>{focals.map((f) => `${fmt(horizontalFov(f, st.cropFactor))}°`).join(' → ')}</dd>
                <dt>Diagonale</dt>
                <dd>{focals.map((f) => `${fmt(diagonalFov(f, st.cropFactor))}°`).join(' → ')}</dd>
                {st.cropFactor !== 1 && (
                  <>
                    <dt>Plein format</dt>
                    <dd>{focals.map((f) => `≈ ${String(fullFrameEquivalent(f, st.cropFactor)).replace('.', ',')} mm`).join(' → ')}</dd>
                  </>
                )}
                {cameras.length > 0 && (
                  <>
                    <dt>Plan au sol</dt>
                    <dd data-testid="inspector-cameras">{cameras.join(', ')}</dd>
                  </>
                )}
              </dl>
            </div>
          ) : (
            <span className={s.muted}>—</span>
          )}
        </div>

        <div className={[s.cell, s.full].join(' ')}>
          <span className={s.k}>Matériel</span>
          {equipment.length === 0 ? (
            <span className={s.muted}>—</span>
          ) : (
            <dl className={s.kv}>
              {EQUIPMENT_CATEGORIES.map((c) => {
                const items = equipment.filter((e) => e.category === c);
                return items.length ? (
                  <Fragment key={c}>
                    <dt>{c}</dt>
                    <dd>{items.map((i) => i.label).join(', ')}</dd>
                  </Fragment>
                ) : null;
              })}
            </dl>
          )}
        </div>

        <label className={[s.cell, s.span2, s.field].join(' ')}>
          <span className={s.k}>Son</span>
          <Draft value={shot.sound ?? ''} placeholder={eff.sound && !shot.sound ? eff.sound : undefined} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'sound', v))} />
        </label>
        <label className={[s.cell, s.field].join(' ')}>
          <span className={s.k}>Lumière</span>
          <Draft value={shot.light ?? ''} placeholder={eff.light && !shot.light ? eff.light : undefined} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'light', v))} />
        </label>
        <label className={[s.cell, s.full, s.field].join(' ')}>
          <span className={s.k}>Image</span>
          <Draft multiline value={shot.notes ?? ''} placeholder={eff.notes && !shot.notes ? eff.notes : undefined} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'notes', v))} />
        </label>

        <RuleMaker doc={doc} shotId={shot.id} />
      </div>
    </aside>
  );
}

function KeyThumb({ blobKey, label }: { blobKey?: string; label: string }) {
  const url = useBlobUrl(blobKey);
  return <span className={s.keyThumb}>{url ? <img src={url} alt={label} /> : null}<em>{label}</em></span>;
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className={s.header}>
      <Hand>Inspecteur</Hand>
      <Button variant="icon" size="sm" aria-label="Replier l’inspecteur" title="Replier l’inspecteur" onClick={onClose} icon={<PanelRightClose size={15} strokeWidth={1.25} />} />
    </div>
  );
}

/**
 * Champ de l'inspecteur saisi d'un trait : la frappe reste locale et n'est enregistrée qu'en quittant
 * le champ (ou Entrée), si bien qu'une note entière s'annule en une seule fois avec ⌘Z.
 */
function Draft({ value, onCommit, multiline, type, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; type?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const commit = () => {
    setFocused(false);
    if (draft !== value) onCommit(draft);
  };
  const common = {
    value: draft,
    onFocus: () => setFocused(true),
    onBlur: commit,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    placeholder,
  };
  return multiline ? (
    <textarea rows={3} {...common} />
  ) : (
    <input
      type={type}
      min={type === 'number' ? 1 : undefined}
      {...common}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
