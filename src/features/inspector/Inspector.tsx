import { newId } from '../../domain/factory';
import { formatOneShotDuration, oneShotTiming, toggleOneShot } from '../../domain/oneshot';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { ImagePlus, PanelRightClose, Trash2 } from 'lucide-react';
import { setCellText } from '../../domain/cells';
import { deduceEquipment, EQUIPMENT_CATEGORIES } from '../../domain/equipment';
import { diagonalFov, fullFrameEquivalent, horizontalFov } from '../../domain/focal';
import { runChecks } from '../../domain/lint';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import type { ID, ProjectDoc, ShotStatus } from '../../domain/types';
import { computeTiming } from '../../domain/timing';
import { isZoom } from '../../domain/vocabulary';
import { putBlob } from '../../store/db';
import { cropStyle, removeFrame, setFrame } from '../../domain/keyframes';
import { aspectRatio } from '../../domain/aspect';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { FovCone } from './FovCone';
import { camerasForShot } from '../../domain/floorplan';
import s from './Inspector.module.css';

const STATUSES: ShotStatus[] = ['à tourner', 'tourné', 'abandonné'];

export function Inspector({ doc, shotId }: { doc: ProjectDoc; shotId: ID | undefined }) {
  const set = useUi((u) => u.set);
  const shot = shotId ? doc.shots[shotId] : undefined;
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const issues = useMemo(() => (shotId ? runChecks(doc, timing).filter((i) => i.shotId === shotId) : []), [doc, timing, shotId]);
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
  const zoom = isZoom(shot.movement);
  const focals = [shot.focal.from, zoom ? shot.focal.to : undefined].filter((f): f is number => f !== undefined);
  const equipment = deduceEquipment(shot);
  const block = doc.blocks[shot.actionBlockId];
  const update = (fn: (d: ProjectDoc) => void) => mutateDoc(fn);

  const dropImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const key = await putBlob(doc.project.id, file.name, file);
    update((d) => setFrame(d, shot.id, 0, { blobKey: key, baseKey: undefined, sketch: undefined, crop: undefined, fit: undefined, baseCrop: undefined, baseFit: undefined, sketchAspect: undefined }));
  };

  return (
    <aside className={s.panel} aria-label="Inspecteur du plan" data-testid="inspector">
      <Header onClose={() => set({ rightPanel: null })} />
      <div className={s.code}>
        <span className={s.big}>Plan {shotCode(doc, shot.id)}</span>
        <span className={s.meta}>
          {sequenceHeading(doc, shot.sequenceId)}
          {decor && decor.name.toUpperCase() !== seq?.label.toUpperCase() ? ` · ${decor.name}` : ''}
          {[seq?.intExt, seq?.effect].filter(Boolean).length ? ` · ${[seq?.intExt, seq?.effect].filter(Boolean).join(' · ')}` : ''}
        </span>
      </div>

      <div
        className={[s.thumb, over ? s.over : ''].join(' ')}
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
            <img src={thumb} alt={`Storyboard du plan ${shotCode(doc, shot.id)}`} style={{ aspectRatio: String(aspectRatio(doc.project.settings.storyboardAspect)), ...(shot.storyboard ? cropStyle(shot.storyboard) : {}) }} />
            <Button variant="icon" size="sm" className={s.thumbDel} aria-label="Retirer la vignette" icon={<Trash2 size={13} />} onClick={() => update((d) => removeFrame(d, shot.id, 0))} />
          </>
        ) : (
          <label className={s.thumbEmpty}>
            <ImagePlus size={18} strokeWidth={1.25} />
            <span>Glisser une image de storyboard</span>
            <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => void dropImage(e.target.files?.[0])} />
          </label>
        )}
      </div>

      <div className={s.keyframes}>
        {(shot.keyframes ?? []).map((k, i) => (
          <KeyThumb key={k.id} blobKey={k.blobKey} label={`K${i + 2}`} />
        ))}
        <label className={s.addKey} title="Ajouter une image à ce plan (keyframe suivante), visible dans le storyboard">
          + keyframe
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

      {shot.oneShot && (
        <button type="button" className={s.oneShotOpen} onClick={() => set({ oneShotEditor: shot.id })} data-testid="open-oneshot">
          <strong>Plan-séquence · {shot.oneShot.beats.length} temps</strong>
          <span>{formatOneShotDuration(oneShotTiming(shot.oneShot.beats)) || 'durée à estimer'}</span>
          <em>Ouvrir l’éditeur de chorégraphie</em>
        </button>
      )}

      {block?.scenarioAnchor && doc.scenario && (
        <section className={s.block}>
          <h3>Passage du scénario</h3>
          <blockquote className={s.passage} data-testid="inspector-passage">
            {doc.scenario.slice(block.scenarioAnchor.start, block.scenarioAnchor.end)}
          </blockquote>
        </section>
      )}

      <section className={s.block}>
        <h3>Angle de champ</h3>
        {focals.length ? (
          <div className={s.fov}>
            <FovCone degrees={horizontalFov(focals[0], st.cropFactor)} secondary={focals[1] !== undefined ? horizontalFov(focals[1], st.cropFactor) : undefined} />
            <ul>
              {focals.map((f) => (
                <li key={f}>
                  <b>{f} mm</b> · {horizontalFov(f, st.cropFactor).toFixed(1).replace('.', ',')}° horiz. · {diagonalFov(f, st.cropFactor).toFixed(1).replace('.', ',')}° diag.
                  {st.cropFactor !== 1 && <em> (≈ {String(fullFrameEquivalent(f, st.cropFactor)).replace('.', ',')} mm plein format)</em>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={s.muted}>Renseignez la focale pour calculer l’angle de champ.</p>
        )}
        {camerasForShot(doc, shot.id).length > 0 && (
          <p className={s.muted} data-testid="inspector-cameras">
            Plan au sol : {camerasForShot(doc, shot.id).join(', ')}
          </p>
        )}
      </section>

      <section className={s.block}>
        <h3>Matériel déduit</h3>
        {equipment.length === 0 ? (
          <p className={s.muted}>Aucun matériel particulier.</p>
        ) : (
          EQUIPMENT_CATEGORIES.map((c) => {
            const items = equipment.filter((e) => e.category === c);
            return items.length ? (
              <div key={c} className={s.equip}>
                <span className={s.cat}>{c}</span>
                <ul>
                  {items.map((i) => (
                    <li key={i.key}>{i.label}</li>
                  ))}
                </ul>
              </div>
            ) : null;
          })
        )}
      </section>

      <section className={s.block}>
        <h3>Son, lumière, image</h3>
        <label className={s.field}>
          <span>Son</span>
          <Draft value={shot.sound ?? ''} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'sound', v))} />
        </label>
        <label className={s.field}>
          <span>Lumière (effet, intention)</span>
          <Draft value={shot.light ?? ''} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'light', v))} />
        </label>
        <label className={s.field}>
          <span>Image</span>
          <Draft multiline value={shot.notes ?? ''} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'notes', v))} />
        </label>
        <div className={s.row}>
          <label className={s.field}>
            <span>Statut</span>
            <select value={shot.status} onChange={(e) => update((d) => void (d.shots[shot.id].status = e.target.value as ShotStatus))}>
              {STATUSES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>Jour de tournage</span>
            <Draft type="number" value={shot.shootingDay !== undefined ? String(shot.shootingDay) : ''} onCommit={(v) => update((d) => void setCellText(d, shot.id, 'shootingDay', v))} />
          </label>
        </div>
      </section>

      {!shot.oneShot && (
        <button type="button" className={s.oneShotLink} onClick={() => { update((d) => toggleOneShot(d, shot.id)); set({ oneShotEditor: shot.id }); }} data-testid="make-oneshot" title="Un seul plan qui enchaîne plusieurs cadrages : chorégraphie en temps successifs">
          Transformer en plan-séquence
        </button>
      )}

      {issues.length > 0 && (
        <section className={s.block}>
          <h3>Vérifications</h3>
          <ul className={s.issues}>
            {issues.map((i) => (
              <li key={i.id} className={i.level === 'info' ? s.info : undefined}>
                <span>{i.message}</span>
                <button type="button" onClick={() => update((d) => void d.ignoredChecks.push(i.id))}>
                  ignorer ici
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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
function Draft({ value, onCommit, multiline, type }: { value: string; onCommit: (v: string) => void; multiline?: boolean; type?: string }) {
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
