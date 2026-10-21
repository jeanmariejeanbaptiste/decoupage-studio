import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { addBeat, formatOneShotDuration, moveBeat, oneShotTiming, removeBeat, toggleOneShot, updateBeat } from '../../domain/oneshot';
import { formatTc, parseTc } from '../../domain/timecode';
import type { ID, OneShotBeat, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import s from './OneShotEditor.module.css';

const sec = (v: string): number | undefined => {
  const p = parseTc(v);
  return p?.kind === 'sec' ? p.sec : undefined;
};

/** Chorégraphie d'un plan-séquence : temps successifs, repères et fourchettes de durée. */
export function OneShotEditor({ doc, shotId }: { doc: ProjectDoc; shotId: ID }) {
  const beats = doc.shots[shotId]?.oneShot?.beats ?? [];
  const t = oneShotTiming(beats);
  const set = (b: OneShotBeat, patch: Partial<OneShotBeat>) => mutateDoc((d) => updateBeat(d, shotId, b.id, patch));
  return (
    <section className={s.box} data-testid="oneshot-editor">
      <header className={s.head}>
        <strong>Plan-séquence</strong>
        <span>{beats.length} temps</span>
        {formatOneShotDuration(t) && <span className={s.total}>{formatOneShotDuration(t)}</span>}
      </header>
      <p className={s.help}>Un seul plan, découpé en temps : chaque temps décrit ce que voit la caméra entre deux repères. Les fourchettes absorbent le rythme des comédiens.</p>
      <ol className={s.beats}>
        {beats.map((b, i) => {
          const w = t.beats[i];
          return (
            <li key={b.id} className={s.beat} data-testid="oneshot-beat">
              <div className={s.beatHead}>
                <b>T{i + 1}</b>
                <span className={s.window} title="Début au plus tôt – au plus tard">
                  {w.startMin === w.startMax ? formatTc(w.startMin) : `${formatTc(w.startMin)}–${formatTc(w.startMax)}`}
                </span>
                <span className={s.tools}>
                  <button type="button" aria-label="Monter le temps" disabled={i === 0} onClick={() => mutateDoc((d) => moveBeat(d, shotId, b.id, -1))}>
                    <ArrowUp size={11} />
                  </button>
                  <button type="button" aria-label="Descendre le temps" disabled={i === beats.length - 1} onClick={() => mutateDoc((d) => moveBeat(d, shotId, b.id, 1))}>
                    <ArrowDown size={11} />
                  </button>
                  <button type="button" aria-label="Insérer un temps après" onClick={() => mutateDoc((d) => addBeat(d, shotId, i))}>
                    <Plus size={11} />
                  </button>
                  <button type="button" aria-label="Supprimer le temps" disabled={beats.length < 2} onClick={() => mutateDoc((d) => removeBeat(d, shotId, b.id))}>
                    <X size={11} />
                  </button>
                </span>
              </div>
              <div className={s.fields}>
                <input value={b.value} onChange={(e) => set(b, { value: e.target.value })} placeholder="Valeur" aria-label={`Valeur du temps ${i + 1}`} />
                <input value={b.subject} onChange={(e) => set(b, { subject: e.target.value })} placeholder="Sujet" aria-label={`Sujet du temps ${i + 1}`} />
                <input value={b.angle} onChange={(e) => set(b, { angle: e.target.value })} placeholder="Angle" aria-label={`Angle du temps ${i + 1}`} />
                <input value={b.movement} onChange={(e) => set(b, { movement: e.target.value })} placeholder="Mouvement" aria-label={`Mouvement du temps ${i + 1}`} />
              </div>
              <textarea value={b.cue ?? ''} onChange={(e) => set(b, { cue: e.target.value || undefined })} rows={2} placeholder="Repères : caméra, comédiens, déclencheur du temps suivant…" aria-label={`Repères du temps ${i + 1}`} />
              <div className={s.dur}>
                durée de
                <input defaultValue={b.minSec !== undefined ? formatTc(b.minSec) : ''} onBlur={(e) => set(b, { minSec: sec(e.target.value) })} placeholder="0:10" aria-label={`Durée minimale du temps ${i + 1}`} />à
                <input defaultValue={b.maxSec !== undefined ? formatTc(b.maxSec) : ''} onBlur={(e) => set(b, { maxSec: sec(e.target.value) })} placeholder="0:15" aria-label={`Durée maximale du temps ${i + 1}`} />
              </div>
            </li>
          );
        })}
      </ol>
      <div className={s.foot}>
        <button type="button" onClick={() => mutateDoc((d) => addBeat(d, shotId))} data-testid="oneshot-add-beat">
          + Ajouter un temps
        </button>
        <button
          type="button"
          className={s.quiet}
          onClick={() => {
            if (window.confirm('Revenir à un plan simple ? Le premier temps devient le cadrage du plan (annulable avec ⌘Z).')) mutateDoc((d) => toggleOneShot(d, shotId));
          }}
        >
          Revenir à un plan simple
        </button>
      </div>
    </section>
  );
}
