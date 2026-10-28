import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Maximize2, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { addBeat, BRIDGE_PRESETS, formatOneShotDuration, needsBridge, oneShotTiming, reorderBeat, removeBeat, toggleOneShot, updateBeat } from '../../domain/oneshot';
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
  const [full, setFull] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
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
    <div className={[s.backdrop, full ? s.full : ''].join(' ')} role="dialog" aria-modal="true" aria-label="Chorégraphie du plan-séquence" data-testid="oneshot-studio">
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
          <Button variant="icon" aria-label={full ? 'Réduire' : 'Plein écran'} title={full ? 'Réduire' : 'Plein écran'} icon={full ? <Minimize2 size={17} /> : <Maximize2 size={17} />} onClick={() => setFull(!full)} data-testid="studio-full" />
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e: DragEndEvent) => {
            const to = beats.findIndex((x) => x.id === e.over?.id);
            if (e.over && to >= 0) mutateDoc((d) => reorderBeat(d, shotId, String(e.active.id), to));
          }}
        >
        <SortableContext items={beats.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
        <div className={s.beats}>
          {beats.map((b, i) => {
            const w = t.beats[i];
            const next = beats[i + 1];
            return (
              <Fragment key={b.id}>
              <SortableCard id={b.id} className={[s.card, focus === b.id ? s.cardOn : ''].join(' ')} style={{ borderTopColor: HUES[i % HUES.length] }} onFocus={() => setFocus(b.id)}>
                {(handle) => (
                <>
                <div className={s.cardHead} {...handle} title="Glisser pour déplacer le temps">
                  <b style={{ color: HUES[i % HUES.length] }}>T{i + 1}</b>
                  <span className={s.when}>
                    début {w.startMin === w.startMax ? formatTc(w.startMin) : `${formatTc(w.startMin)} – ${formatTc(w.startMax)}`}
                  </span>
                  <span className={s.tools}>
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
                </>
                )}
              </SortableCard>
              {next && (
                <div className={[s.bridge, !b.bridge && needsBridge(b, next) ? s.bridgeTodo : ''].join(' ')} data-testid="studio-bridge">
                  <span className={s.bridgeHead}>
                    T{i + 1} <ArrowRight size={12} /> T{i + 2}
                  </span>
                  <span className={s.bridgeLabel}>Liaison</span>
                  <textarea
                    rows={3}
                    value={b.bridge ?? ''}
                    onChange={(e) => set(b, { bridge: e.target.value || undefined })}
                    placeholder={needsBridge(b, next) ? `Comment passer de ${b.subject} à ${next.subject} ?` : 'Mouvement de passage…'}
                    aria-label={`Liaison du temps ${i + 1} au temps ${i + 2}`}
                  />
                  <select value="" onChange={(e) => e.target.value && set(b, { bridge: e.target.value })} aria-label={`Liaison type du temps ${i + 1} au temps ${i + 2}`}>
                    <option value="">Choisir…</option>
                    {BRIDGE_PRESETS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              </Fragment>
            );
          })}
          <button type="button" className={s.add} onClick={() => mutateDoc((d) => addBeat(d, shotId))} data-testid="studio-add-beat">
            <Plus size={18} />
            Ajouter un temps
          </button>
        </div>
        </SortableContext>
        </DndContext>

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

/** Fiche d'un temps, déplaçable par son en-tête : les autres fiches glissent pour lui faire place. */
function SortableCard({ id, className, style, onFocus, children }: { id: ID; className: string; style: CSSProperties; onFocus: () => void; children: (handle: Record<string, unknown>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <section
      ref={setNodeRef}
      id={`beat-${id}`}
      className={className}
      style={{ ...style, transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 5 : undefined, boxShadow: isDragging ? '0 14px 30px rgba(42, 40, 36, 0.18)' : undefined }}
      onFocus={onFocus}
      data-testid="studio-beat"
    >
      {children({ ...attributes, ...listeners })}
    </section>
  );
}
