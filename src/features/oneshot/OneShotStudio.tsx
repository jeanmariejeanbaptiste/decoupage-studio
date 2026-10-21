import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2, X } from 'lucide-react';
import { addBeat, formatOneShotDuration, moveBeat, oneShotTiming, removeBeat, toggleOneShot, updateBeat } from '../../domain/oneshot';
import { shotCode, sequenceHeading } from '../../domain/numbering';
import { formatTc } from '../../domain/timecode';
import type { ID, OneShotBeat, ProjectDoc } from '../../domain/types';
import { COMMON_FOCALS, vocabularyFor } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import s from './OneShotStudio.module.css';

const HUES = ['#a4472c', '#2c5d8a', '#6b8e3a', '#8a4f9e', '#b8862e', '#2f7f7a', '#9b3b5a', '#556070'];

/** Éditeur plein écran d'un plan-séquence : frise des temps, puis une fiche par temps. */
export function OneShotStudio({ doc }: { doc: ProjectDoc }) {
  const shotId = useUi((u) => u.oneShotEditor);
  const close = () => useUi.getState().set({ oneShotEditor: null });
  const shot = shotId ? doc.shots[shotId] : undefined;
  const beats = shot?.oneShot?.beats ?? [];
  const [focus, setFocus] = useState<ID | null>(null);
  useEffect(() => {
    if (!shotId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shotId]);
  if (!shotId || !shot?.oneShot) return null;

  const t = oneShotTiming(beats);
  const vocab = doc.customVocabulary;
  const lists = {
    value: vocabularyFor('value', vocab).map((v) => v.long),
    angle: vocabularyFor('angle', vocab).map((v) => v.short),
    movement: vocabularyFor('movement', vocab).map((v) => v.short),
    subject: [...new Set([...Object.values(doc.characters).map((c) => c.name), ...doc.sequences[shot.sequenceId].shotIds.map((id) => doc.shots[id]?.subject).filter(Boolean)])],
  };
  const set = (b: OneShotBeat, patch: Partial<OneShotBeat>) => mutateDoc((d) => updateBeat(d, shotId, b.id, patch));
  const total = Math.max(1, t.expected || beats.length);
  const share = (i: number) => {
    const b = beats[i];
    const a = b.minSec ?? b.maxSec;
    const z = b.maxSec ?? b.minSec;
    return a !== undefined && z !== undefined ? (a + z) / 2 : t.expected ? 0 : 1;
  };

  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label="Chorégraphie du plan-séquence" data-testid="oneshot-studio">
      <div className={s.sheet}>
        <header className={s.head}>
          <div>
            <p className={s.kicker}>Plan-séquence · {sequenceHeading(doc, shot.sequenceId)}</p>
            <h2>
              Plan {shotCode(doc, shotId)} <span>{beats.length} temps</span>
            </h2>
          </div>
          <div className={s.total}>
            <span>Durée</span>
            <strong>{formatOneShotDuration(t) || 'à estimer'}</strong>
          </div>
          <Button variant="icon" aria-label="Fermer" icon={<X size={18} />} onClick={close} />
        </header>

        {/* Frise : chaque temps proportionnel à sa durée probable. */}
        <div className={s.strip} aria-label="Frise des temps">
          {beats.map((b, i) => (
            <button
              key={b.id}
              type="button"
              className={[s.seg, focus === b.id ? s.segOn : ''].join(' ')}
              style={{ flexGrow: Math.max(share(i), total * 0.04), background: HUES[i % HUES.length] }}
              onClick={() => {
                setFocus(b.id);
                document.getElementById(`beat-${b.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              }}
              title={`T${i + 1} · début ${formatTc(t.beats[i].startMin)}${t.beats[i].startMax !== t.beats[i].startMin ? `–${formatTc(t.beats[i].startMax)}` : ''}`}
            >
              <b>T{i + 1}</b> {b.value || b.subject || ''}
            </button>
          ))}
        </div>

        <datalist id="os-value">{lists.value.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="os-angle">{lists.angle.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="os-movement">{lists.movement.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="os-subject">{lists.subject.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="os-focal">{COMMON_FOCALS.map((v) => <option key={v} value={v} />)}</datalist>

        <div className={s.beats}>
          {beats.map((b, i) => {
            const w = t.beats[i];
            return (
              <section key={b.id} id={`beat-${b.id}`} className={[s.card, focus === b.id ? s.cardOn : ''].join(' ')} style={{ borderTopColor: HUES[i % HUES.length] }} onFocus={() => setFocus(b.id)} data-testid="studio-beat">
                <div className={s.cardHead}>
                  <b style={{ color: HUES[i % HUES.length] }}>T{i + 1}</b>
                  <span className={s.when}>
                    début {w.startMin === w.startMax ? formatTc(w.startMin) : `${formatTc(w.startMin)} – ${formatTc(w.startMax)}`}
                  </span>
                  <span className={s.tools}>
                    <button type="button" aria-label="Temps précédent" disabled={i === 0} onClick={() => mutateDoc((d) => moveBeat(d, shotId, b.id, -1))}>
                      <ArrowLeft size={13} />
                    </button>
                    <button type="button" aria-label="Temps suivant" disabled={i === beats.length - 1} onClick={() => mutateDoc((d) => moveBeat(d, shotId, b.id, 1))}>
                      <ArrowRight size={13} />
                    </button>
                    <button type="button" aria-label={`Supprimer le temps ${i + 1}`} disabled={beats.length < 2} onClick={() => mutateDoc((d) => removeBeat(d, shotId, b.id))}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <Field label="Valeur" list="os-value" value={b.value} onChange={(v) => set(b, { value: v })} />
                <Field label="Sujet" list="os-subject" value={b.subject} onChange={(v) => set(b, { subject: v })} />
                <Field label="Angle" list="os-angle" value={b.angle} onChange={(v) => set(b, { angle: v })} />
                <Field label="Mouvement" list="os-movement" value={b.movement} onChange={(v) => set(b, { movement: v })} />
                <label className={s.field}>
                  <span>Focale</span>
                  <span className={s.unit}>
                    <input type="number" min={4} max={1200} step={1} inputMode="numeric" list="os-focal" value={b.focal ?? ''} onChange={(e) => set(b, { focal: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })} aria-label={`Focale du temps ${i + 1}`} />
                    mm
                  </span>
                </label>
                <label className={s.field}>
                  <span>Durée</span>
                  <span className={s.unit}>
                    <input type="number" min={0} step={1} inputMode="numeric" value={b.minSec ?? ''} placeholder="min" onChange={(e) => set(b, { minSec: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} aria-label={`Durée minimale du temps ${i + 1} (secondes)`} />
                    à
                    <input type="number" min={0} step={1} inputMode="numeric" value={b.maxSec ?? ''} placeholder="max" onChange={(e) => set(b, { maxSec: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} aria-label={`Durée maximale du temps ${i + 1} (secondes)`} />
                    s
                  </span>
                </label>
                <label className={s.field}>
                  <span>Repères</span>
                  <textarea rows={3} value={b.cue ?? ''} onChange={(e) => set(b, { cue: e.target.value || undefined })} placeholder="Caméra, comédiens, déclencheur du temps suivant…" aria-label={`Repères du temps ${i + 1}`} />
                </label>
              </section>
            );
          })}
          <button type="button" className={s.add} onClick={() => mutateDoc((d) => addBeat(d, shotId))} data-testid="studio-add-beat">
            <Plus size={18} />
            Ajouter un temps
          </button>
        </div>

        <footer className={s.foot}>
          <span>Les durées absorbent le rythme des comédiens : la durée totale donne la fourchette et l’estimation la plus probable.</span>
          <button
            type="button"
            className={s.quiet}
            onClick={() => {
              if (!window.confirm('Revenir à un plan simple ? Le premier temps devient le cadrage du plan (annulable avec ⌘Z).')) return;
              mutateDoc((d) => toggleOneShot(d, shotId));
              close();
            }}
          >
            Revenir à un plan simple
          </button>
          <Button variant="primary" onClick={close}>
            Terminé
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, list, value, onChange }: { label: string; list: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input list={list} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}
