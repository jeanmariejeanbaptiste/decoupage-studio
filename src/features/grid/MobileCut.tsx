import { SeqMeta } from './SeqMeta';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, List, Plus, Trash2, X } from 'lucide-react';
import { COLUMN_DEFS, tcLast } from '../../domain/columns';
import { editableText, isEditable, setCellText } from '../../domain/cells';
import { sequenceHeading, sequenceNumber, shotCode } from '../../domain/numbering';
import { addSequence, addShotAfter, deleteShot, duplicateShot } from '../../domain/ops';
import { suggestionSource } from './suggestions';
import type { Suggestion } from '../../ui/SuggestList';
import { computeTiming, shotTcLabel } from '../../domain/timing';
import type { ColumnKey, ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import { useUi } from '../../store/uiStore';
import s from './MobileCut.module.css';

/** Écran de téléphone ? (largeur et pointeur tactile) */
export function useIsMobile(): boolean {
  const query = '(max-width: 700px)';
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

const label = (c: ColumnKey) => {
  const l = COLUMN_DEFS[c].label;
  return l === l.toUpperCase() && l.length > 3 ? l.charAt(0) + l.slice(1).toLowerCase() : l;
};
/** Point de départ du glissement du doigt (un seul doigt à la fois). */
const swipe = { x: 0, y: 0 };
const MULTILINE: ColumnKey[] = ['action', 'dialogue', 'notes', 'sound'];

/**
 * Découpage sur téléphone : pas de tableau. Un plan à la fois, en pleine hauteur, champ par champ ;
 * on passe d'un plan à l'autre avec les flèches, on ajoute un plan ou une séquence en bas, et la vue
 * d'ensemble est une simple liste.
 */
export function MobileCut({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const order = useMemo(() => doc.project.sequenceIds.flatMap((id) => doc.sequences[id]?.shotIds ?? []), [doc]);
  const timing = useMemo(() => computeTiming(doc), [doc]);
  const [current, setCurrent] = useState<ID | undefined>(() => order[0]);
  const [list, setList] = useState(false);
  const idx = current ? order.indexOf(current) : -1;
  const shotId = idx >= 0 ? current : order[0];
  const i = shotId ? order.indexOf(shotId) : -1;
  const shot = shotId ? doc.shots[shotId] : undefined;

  // L'inspecteur, l'aperçu et le panneau scénario ne servent pas sur téléphone.
  useEffect(() => {
    useUi.getState().set({ printView: false });
  }, []);

  const cols = tcLast(doc.project.settings.gridColumns).filter((c) => c !== 'number' && c !== 'tc');
  const go = (k: number) => {
    const next = order[Math.max(0, Math.min(order.length - 1, k))];
    if (next) setCurrent(next);
    window.scrollTo({ top: 0 });
  };
  const addShot = () => {
    if (!shotId) return;
    const id = mutateDoc((d) => addShotAfter(d, shotId));
    if (id) setCurrent(id);
  };
  const duplicate = () => {
    if (!shotId) return;
    const id = mutateDoc((d) => duplicateShot(d, shotId));
    if (id) setCurrent(id);
  };
  // Supprimer : on reste sur le plan voisin ; ⌘Z (ou l'annulation du haut) le fait revenir.
  const remove = () => {
    if (!shotId) return;
    const next = order[i + 1] ?? order[i - 1];
    mutateDoc((d) => deleteShot(d, shotId));
    setCurrent(next);
  };
  const addSeq = () => {
    const seqId = shot?.sequenceId;
    const at = seqId ? doc.project.sequenceIds.indexOf(seqId) + 1 : doc.project.sequenceIds.length;
    const id = mutateDoc((d) => {
      const sid = addSequence(d, at);
      return d.sequences[sid].shotIds[0];
    });
    if (id) setCurrent(id);
  };

  if (list || !shot) {
    return (
      <div className={s.wrap}>
        <header className={s.head}>
          <h1 className={s.title}>Vue d’ensemble</h1>
          {shot && (
            <button type="button" className={s.iconBtn} onClick={() => setList(false)} aria-label="Fermer la vue d’ensemble">
              <X size={18} strokeWidth={1.6} />
            </button>
          )}
        </header>
        {doc.project.sequenceIds.length === 0 && (
          <button type="button" className={s.primary} onClick={addSeq} disabled={readOnly}>
            <Plus size={16} /> Première séquence
          </button>
        )}
        {doc.project.sequenceIds.map((seqId) => (
          <section key={seqId} className={s.listSeq}>
            <h2>{sequenceHeading(doc, seqId)}</h2>
            <ul>
              {(doc.sequences[seqId]?.shotIds ?? []).map((id) => {
                const sh = doc.shots[id];
                const action = doc.blocks[sh.actionBlockId]?.text ?? '';
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={id === shotId ? s.listOn : ''}
                      onClick={() => {
                        setCurrent(id);
                        setList(false);
                        window.scrollTo({ top: 0 });
                      }}
                      data-testid="mobile-list-shot"
                    >
                      <span className={s.listNum}>{shotCode(doc, id)}</span>
                      <span className={s.listBody}>
                        <strong>{[sh.subject, sh.value].filter(Boolean).join(' · ') || 'Plan vide'}</strong>
                        {action && <span>{action}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  const tc = shotTcLabel(doc, timing, shot.id);
  // Glisser le doigt vers la gauche / la droite : plan suivant / précédent.
  const onTouchStart = (e: React.TouchEvent) => {
    swipe.x = e.touches[0].clientX;
    swipe.y = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = e.target as HTMLElement;
    if (t0.closest('input, textarea, select')) return;
    const dx = e.changedTouches[0].clientX - swipe.x;
    const dy = e.changedTouches[0].clientY - swipe.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? i + 1 : i - 1);
  };
  return (
    <div className={s.wrap} data-testid="mobile-cut" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Séquences : on saute directement à la première de ses plans. */}
      <nav className={s.seqTabs} aria-label="Séquences">
        {doc.project.sequenceIds.map((id) => (
          <button
            key={id}
            type="button"
            className={id === shot.sequenceId ? s.seqTabOn : ''}
            onClick={() => {
              const first = doc.sequences[id]?.shotIds[0];
              if (first) setCurrent(first);
            }}
          >
            {sequenceHeading(doc, id)}
          </button>
        ))}
      </nav>
      <header className={s.head}>
        <div>
          {/* Nom de la séquence, modifiable comme dans la grille. */}
          <label className={s.seqName}>
            <span>{sequenceNumber(doc, shot.sequenceId)},</span>
            <SeqInput
              value={editableText(doc, shot.id, 'sequence')}
              readOnly={readOnly}
              onCommit={(v) => mutateDoc((d) => void setCellText(d, shot.id, 'sequence', v))}
            />
          </label>
          <SeqMeta doc={doc} seqId={shot.sequenceId} readOnly={readOnly} className={s.kickerMeta} />
          <h1 className={s.title}>
            Plan {shotCode(doc, shot.id)}
            {tc && <span className={s.tc}>{tc}</span>}
          </h1>
        </div>
        <div className={s.headActions}>
          <button type="button" className={s.iconBtn} onClick={() => setList(true)} aria-label="Vue d’ensemble" data-testid="mobile-overview">
            <List size={18} strokeWidth={1.6} />
          </button>
          {!readOnly && (
            <>
              <button type="button" className={s.iconBtn} onClick={duplicate} aria-label="Dupliquer le plan" title="Dupliquer">
                <Copy size={16} strokeWidth={1.6} />
              </button>
              <button type="button" className={s.iconBtn} onClick={remove} aria-label="Supprimer le plan" title="Supprimer">
                <Trash2 size={16} strokeWidth={1.6} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className={s.fields}>
        {cols.map((c) =>
          c === 'sequence' ? null : (
            <Field
              key={`${shot.id}-${c}`}
              label={label(c)}
              value={editableText(doc, shot.id, c)}
              multiline={MULTILINE.includes(c)}
              readOnly={readOnly || !isEditable(c)}
              suggest={readOnly ? undefined : suggestionSource(doc, c)}
              numeric={c === 'focal' || c === 'aperture'}
              onCommit={(v) => mutateDoc((d) => void setCellText(d, shot.id, c, v))}
            />
          ),
        )}
      </div>

      <nav className={s.bar} aria-label="Plans">
        <button type="button" className={s.navBtn} onClick={() => go(i - 1)} disabled={i <= 0} aria-label="Plan précédent" data-testid="mobile-prev">
          <ChevronLeft size={22} strokeWidth={1.6} />
        </button>
        <div className={s.adds}>
          {!readOnly && (
            <>
              <button type="button" onClick={addShot} data-testid="mobile-add-shot">
                <Plus size={15} /> Plan
              </button>
              <button type="button" onClick={addSeq} data-testid="mobile-add-seq">
                <Plus size={15} /> Séquence
              </button>
            </>
          )}
          <span className={s.count}>
            {i + 1} / {order.length}
          </span>
        </div>
        <button type="button" className={s.navBtn} onClick={() => go(i + 1)} disabled={i >= order.length - 1} aria-label="Plan suivant" data-testid="mobile-next">
          <ChevronRight size={22} strokeWidth={1.6} />
        </button>
      </nav>
    </div>
  );
}

/** Champ saisi d'un trait, enregistré en quittant le champ. */
function Field({
  label: l,
  value,
  multiline,
  readOnly,
  suggest,
  numeric,
  onCommit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  readOnly?: boolean;
  suggest?: (q: string) => Suggestion[];
  numeric?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const common = {
    value: draft,
    readOnly,
    placeholder: readOnly ? '' : '—',
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft !== value) onCommit(draft);
    },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    'aria-label': l,
  };
  // Suggestions à toucher (vocabulaire, focales…) : pour la dernière valeur saisie après une virgule.
  const last = draft.split(/,\s*/).pop() ?? '';
  // Valeur déjà complète : on propose toute la liste, pour changer d'un geste.
  const matches = focused && suggest ? suggest(last) : [];
  const chips = (matches.length <= 1 && suggest && focused ? suggest('') : matches).slice(0, 12);
  const pick = (sg: Suggestion) => {
    const v = sg.value ?? sg.label;
    const parts = draft.split(/,\s*/);
    parts[parts.length - 1] = v;
    const next = parts.filter(Boolean).join(', ');
    setDraft(next);
    onCommit(next);
  };
  return (
    <label className={s.field}>
      <span>{l}</span>
      {multiline ? (
        <textarea rows={Math.max(2, Math.ceil(draft.length / 38))} {...common} />
      ) : (
        <input {...common} inputMode={numeric ? 'decimal' : undefined} enterKeyHint="next" />
      )}
      {chips.length > 0 && (
        <span className={s.chips}>
          {chips.map((sg) => (
            <button key={sg.label} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(sg)}>
              {sg.label}
            </button>
          ))}
        </span>
      )}
    </label>
  );
}

/** Nom de séquence saisi d'un trait, enregistré en quittant le champ. */
function SeqInput({ value, readOnly, onCommit }: { value: string; readOnly?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <input
      value={draft}
      readOnly={readOnly}
      placeholder="Nom de la séquence"
      aria-label="Nom de la séquence"
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
