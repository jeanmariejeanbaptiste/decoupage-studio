import { useMemo, useState, type DragEvent } from 'react';
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
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { FovCone } from './FovCone';
import { camerasForShot } from '../../domain/floorplan';
import s from './Inspector.module.css';

const SOUND = ['IN', 'OFF', 'V.O.', 'Musique diégétique', 'Musique extradiégétique', 'Playback'];
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
        <Header onClose={() => set({ inspectorOpen: false })} />
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
    update((d) => void (d.shots[shot.id].storyboard = { blobKey: key }));
  };

  return (
    <aside className={s.panel} aria-label="Inspecteur du plan" data-testid="inspector">
      <Header onClose={() => set({ inspectorOpen: false })} />
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
            <img src={thumb} alt={`Storyboard du plan ${shotCode(doc, shot.id)}`} />
            <Button variant="icon" size="sm" className={s.thumbDel} aria-label="Retirer la vignette" icon={<Trash2 size={13} />} onClick={() => update((d) => void (d.shots[shot.id].storyboard = undefined))} />
          </>
        ) : (
          <label className={s.thumbEmpty}>
            <ImagePlus size={18} strokeWidth={1.25} />
            <span>Glisser une image de storyboard</span>
            <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => void dropImage(e.target.files?.[0])} />
          </label>
        )}
      </div>

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
        <h3>Son, lumière, raccords</h3>
        <label className={s.field}>
          <span>Son</span>
          <input list="sound-options" value={shot.sound ?? ''} onChange={(e) => update((d) => void setCellText(d, shot.id, 'sound', e.target.value))} />
          <datalist id="sound-options">
            {SOUND.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className={s.field}>
          <span>Lumière (effet, intention)</span>
          <input value={shot.light ?? ''} onChange={(e) => update((d) => void setCellText(d, shot.id, 'light', e.target.value))} />
        </label>
        <label className={s.field}>
          <span>Notes de raccord (costume, accessoire, entrées / sorties de champ)</span>
          <textarea rows={3} value={shot.notes ?? ''} onChange={(e) => update((d) => void setCellText(d, shot.id, 'notes', e.target.value))} />
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
            <input type="number" min={1} value={shot.shootingDay ?? ''} onChange={(e) => update((d) => void setCellText(d, shot.id, 'shootingDay', e.target.value))} />
          </label>
        </div>
      </section>

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

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className={s.header}>
      <Hand>Inspecteur</Hand>
      <Button variant="icon" size="sm" aria-label="Replier l’inspecteur" title="Replier l’inspecteur" onClick={onClose} icon={<PanelRightClose size={15} strokeWidth={1.25} />} />
    </div>
  );
}
