import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { OutlineSequence } from '../../../domain/outline';
import { stepLabel } from '../../../domain/truby';
import { useProjectStore } from '../../../store/projectStore';
import { registerFlush } from '../../../store/persistence';
import { isShortcut } from '../../../store/shortcuts';
import { useCommitDraft } from '../ResearchPanels';
import { Combo, EFFECTS, IntExtSelect, useLocationChoices } from './HeadingFields';
import { ActionMenu, PlotPicker, StepMenu } from './OutlineMenus';
import { commitHeading, commitPhrase, moveStep, setPlot, setStep, writeSequence } from './outlineActions';
import { setActive, setEditing, setInsertAfter, useOutlineUi } from './outlineUi';
import s from './OutlineView.module.css';

/** Remet le focus sur la ligne N (après une édition, un déplacement). */
export function focusRow(n: number) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-outline-n="${n}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  });
}

/** Phrase en cours d'édition : Entrée valide et passe à la suivante, Échap annule, ⌥↑ / ⌥↓ valident puis déplacent. */
export function PhraseField({ it, count, className }: { it: OutlineSequence; count: number; className?: string }) {
  const n = it.n;
  const [draft, setDraft, commit] = useCommitDraft(it.phrase, (v) => commitPhrase(n, v));
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const leave = () => {
    setEditing(null);
    focusRow(useOutlineUi.getState().active ?? n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const up = isShortcut(e, 'outlineMoveUp');
    if (up || isShortcut(e, 'outlineMoveDown')) {
      e.preventDefault();
      commit();
      moveStep(n, up ? -1 : 1);
      const to = useOutlineUi.getState().active ?? n;
      setEditing({ n: to, field: 'phrase' });
      return;
    }
    if (isShortcut(e, 'outlineWrite')) {
      e.preventDefault();
      commit();
      setEditing(null);
      return writeSequence(n);
    }
    if (isShortcut(e, 'outlineInsert')) {
      e.preventDefault();
      commit();
      setEditing(null);
      return setInsertAfter(n);
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      commit();
      if (n < count) {
        setActive(n + 1);
        setEditing({ n: n + 1, field: 'phrase' });
      } else leave();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(it.phrase);
      leave();
    }
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      className={[s.phraseInput, className].join(' ')}
      value={draft}
      aria-label={`Phrase de la séquence ${n}`}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={onKeyDown}
      onBlur={() => {
        commit();
        const ed = useOutlineUi.getState().editing;
        if (ed && 'n' in ed && ed.n === n && ed.field === 'phrase') setEditing(null);
      }}
      data-testid="outline-phrase-input"
    />
  );
}

/** En-tête édité sur place : INT. · Lieu · Moment. Entrée valide, Échap annule ; sortir du groupe valide. */
export function HeadingEditor({ it, doc }: { it: OutlineSequence; doc: Parameters<typeof useLocationChoices>[0] }) {
  const [h, setH] = useState({ intExt: it.intExt ?? '', location: it.location, effect: it.effect ?? '' });
  const ref = useRef(h);
  ref.current = h;
  const done = useRef(false);
  const place = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const locations = useLocationChoices(doc);
  const save = () => {
    if (done.current) return;
    const v = ref.current;
    if (!v.location.trim()) return;
    done.current = true;
    if (v.intExt !== (it.intExt ?? '') || v.location !== it.location || v.effect !== (it.effect ?? '')) commitHeading(it.n, { intExt: v.intExt || undefined, location: v.location, effect: v.effect || undefined });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    place.current?.focus();
    place.current?.select();
    // Rien de tapé ne se perd : enregistré avant une sauvegarde et quand le champ disparaît.
    const project = useProjectStore.getState().doc?.project.id;
    const off = registerFlush(() => saveRef.current());
    return () => {
      off();
      if (useProjectStore.getState().doc?.project.id === project) saveRef.current();
    };
  }, []);
  const close = () => {
    setEditing(null);
    focusRow(it.n);
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (!ref.current.location.trim()) return place.current?.focus();
      save();
      close();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      close();
    }
  };
  return (
    <div
      ref={box}
      className={s.headingEdit}
      role="group"
      aria-label={`En-tête de la séquence ${it.n}`}
      onBlur={(e) => {
        if (box.current?.contains(e.relatedTarget as Node)) return;
        // Une liste de suggestions (portée dans <body>) garde le focus dans le champ : rien à faire ici.
        save();
        const ed = useOutlineUi.getState().editing;
        if (ed && 'n' in ed && ed.n === it.n && ed.field === 'heading') setEditing(null);
      }}
      data-testid="outline-heading-edit"
    >
      <span className={s.qInt}>
        <IntExtSelect value={h.intExt} onChange={(v) => setH({ ...h, intExt: v })} onKeyDown={onKey} />
      </span>
      <Combo ref={place} className={s.qPlace} value={h.location} onChange={(v) => setH({ ...h, location: v })} choices={locations} placeholder="Lieu" onKeyDown={onKey} />
      <Combo className={s.qTime} value={h.effect} onChange={(v) => setH({ ...h, effect: v })} choices={EFFECTS} placeholder="Moment" onKeyDown={onKey} />
    </div>
  );
}

/** Étape et intrigue d'une séquence : chaque mot est un menu ; non renseignés, ils n'apparaissent qu'au survol. */
export function Attrs({
  it,
  plots,
  plotShown,
  readOnly,
  className,
}: {
  it: OutlineSequence;
  plots: ReadonlyArray<{ key: string; name: string }>;
  /** L'intrigue se lit toujours quand le projet en a plusieurs (ou si ce n'est pas la principale). */
  plotShown: boolean;
  readOnly: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState<'step' | 'plot' | null>(null);
  const stepRef = useRef<HTMLButtonElement>(null);
  const plotRef = useRef<HTMLButtonElement>(null);
  const hasStep = it.step !== undefined;
  const plotLabel = plots.find((p) => p.key === it.plot)?.name ?? `Intrigue ${it.plot}`;
  if (readOnly)
    return (
      <div className={[s.attrs, className].join(' ')}>
        {hasStep && <span>{stepLabel(it.step!)}</span>}
        {hasStep && plotShown && <span className={s.dot} aria-hidden="true">·</span>}
        {plotShown && <span>{plotLabel}</span>}
      </div>
    );
  return (
    <div className={[s.attrs, className].join(' ')}>
      <button
        ref={stepRef}
        type="button"
        className={[s.attr, hasStep ? '' : s.attrGhost].join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open === 'step'}
        onClick={(e) => {
          e.stopPropagation();
          setActive(it.n);
          setOpen(open === 'step' ? null : 'step');
        }}
        data-testid="outline-step"
      >
        {hasStep ? stepLabel(it.step!) : 'Étape'}
      </button>
      <span className={[s.dot, hasStep && plotShown ? '' : s.attrGhost].join(' ')} aria-hidden="true">
        ·
      </span>
      <button
        ref={plotRef}
        type="button"
        className={[s.attr, plotShown ? '' : s.attrGhost].join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open === 'plot'}
        onClick={(e) => {
          e.stopPropagation();
          setActive(it.n);
          setOpen(open === 'plot' ? null : 'plot');
        }}
        data-testid="outline-plot"
      >
        {plotShown ? plotLabel : 'Intrigue'}
      </button>
      {open === 'step' && <StepMenu anchor={stepRef} value={it.step} onClose={() => setOpen(null)} onPick={(n) => setStep(it.n, n)} />}
      {open === 'plot' && <PlotPicker anchor={plotRef} plots={plots} value={it.plot} onClose={() => setOpen(null)} onPick={(k) => setPlot(it.n, k)} />}
    </div>
  );
}

/** Bouton ⋯ et son menu, à place fixe en fin de ligne. */
export function RowMenu({ label, items }: { label: string; items: ReadonlyArray<{ label: string; run: () => void; testId?: string } | 'sep'> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={s.more}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        data-testid="outline-more"
      >
        <MoreHorizontal size={16} strokeWidth={1.25} />
      </button>
      {open && <ActionMenu anchor={ref} items={items} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}
