import { Fragment, useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
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
import { useDraft } from '../../ui/useDraft';
import s from './OneShotStudio.module.css';

/** Temps alternés en gris (aucune couleur) : on les distingue par leur ton et leur numéro. */
const HUES = ['#111318', '#5f636b', '#3a3e46', '#8b9099'];
const CSS_ESCAPE = (v: string) => (typeof window !== 'undefined' && window.CSS?.escape ? window.CSS.escape(v) : v);
/** Lecteurs d'écran : comment déplacer un temps sans la souris. */
const A11Y = { screenReaderInstructions: { draggable: 'Alt et flèche gauche ou droite pour déplacer ce temps.' } };

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
  // Au clavier : Alt + ← / → sur l'en-tête d'une fiche avance ou recule le temps ; l'en-tête garde le focus.
  const moveByKey = (e: ReactKeyboardEvent<HTMLDivElement>, b: OneShotBeat, i: number) => {
    if (!e.altKey || e.target !== e.currentTarget || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to >= beats.length) return;
    mutateDoc((d) => reorderBeat(d, shotId, b.id, to));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#beat-${CSS_ESCAPE(b.id)} [data-beat-handle]`)?.focus());
  };
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
          accessibility={A11Y}
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
                <div
                  className={s.cardHead}
                  {...handle}
                  data-beat-handle
                  aria-label={`Temps ${i + 1}`}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  onKeyDown={(e) => moveByKey(e, b, i)}
                  title="Glisser pour déplacer le temps"
                >
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
                    <DraftNumber list="os-focal" value={b.focal} onCommit={(v) => set(b, { focal: v === undefined || !Number.isFinite(v) ? undefined : Math.max(1, v) })} aria-label={`Focale du temps ${i + 1}`} />
                    mm
                  </span>
                </label>
                <label className={s.field}>
                  <span>Durée</span>
                  <span className={s.unit}>
                    <DraftNumber value={b.minSec} placeholder="min" onCommit={(v) => set(b, { minSec: v === undefined || !Number.isFinite(v) ? undefined : Math.max(0, v) })} aria-label={`Durée minimale du temps ${i + 1} (secondes)`} />
                    à
                    <DraftNumber value={b.maxSec} placeholder="max" onCommit={(v) => set(b, { maxSec: v === undefined || !Number.isFinite(v) ? undefined : Math.max(0, v) })} aria-label={`Durée maximale du temps ${i + 1} (secondes)`} />
                    s
                  </span>
                </label>
                <label className={s.field}>
                  <span>Repères</span>
                  <DraftArea rows={3} value={b.cue ?? ''} onCommit={(v) => set(b, { cue: v || undefined })} placeholder="Caméra, comédiens, déclencheur du temps suivant…" aria-label={`Repères du temps ${i + 1}`} />
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
                  <DraftArea
                    rows={3}
                    value={b.bridge ?? ''}
                    onCommit={(v) => set(b, { bridge: v || undefined })}
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

/** Champ texte appliqué après une pause ou en le quittant : une étape d'annulation par saisie, pas par lettre. */
function Field({ label, list, value, onChange }: { label: string; list: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft, flush] = useDraft(value, onChange);
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input list={list} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={flush} aria-label={label} />
    </label>
  );
}

function DraftArea({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [draft, setDraft, flush] = useDraft(value, onCommit);
  return <textarea {...rest} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={flush} />;
}

/** Nombre entier appliqué après une pause, à la validation ou en quittant le champ. */
function DraftNumber({ value, onCommit, ...rest }: { value?: number; onCommit: (v: number | undefined) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft, flush] = useDraft(value === undefined ? '' : String(value), (v) => onCommit(v.trim() === '' ? undefined : Math.round(Number(v.replace(',', '.')))));
  return <input {...rest} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d,.]/g, ''))} onBlur={flush} onKeyDown={(e) => e.key === 'Enter' && flush()} />;
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
