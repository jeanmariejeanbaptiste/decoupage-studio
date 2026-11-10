import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectDoc } from '../../../domain/types';
import { addEntry } from './outlineActions';
import { Combo, EFFECTS, IntExtSelect, useLocationChoices } from './HeadingFields';
import { setActive, setInsertAfter } from './outlineUi';
import f from './HeadingFields.module.css';
import s from './OutlineView.module.css';

interface Draft {
  intExt: string;
  location: string;
  effect: string;
  phrase: string;
}

/** Brouillon de l'ajout rapide en fin de liste, par projet : il survit à un changement de vue ou de sous-page. */
const kept = new Map<string, Draft>();
const EMPTY: Draft = { intExt: 'INT.', location: '', effect: '', phrase: '' };

/**
 * Ajout rapide : INT. · Lieu · Moment · Action essentielle. Entrée ajoute la séquence (après `after`,
 * ou à la fin), puis le focus revient au lieu, sélectionné ; INT. et le moment restent pour la suite.
 */
export function QuickAdd({ doc, after, autoFocus, stacked, onClose }: { doc: ProjectDoc; after: number | 'end'; autoFocus?: boolean; stacked?: boolean; onClose?: () => void }) {
  const inline = after !== 'end';
  const project = doc.project.id;
  const [d, setD] = useState<Draft>(() => {
    const k = kept.get(project) ?? EMPTY;
    return inline ? { ...k, location: '', phrase: '' } : k;
  });
  const set = (patch: Partial<Draft>) =>
    setD((cur) => {
      const next = { ...cur, ...patch };
      if (!inline) kept.set(project, next);
      return next;
    });
  const place = useRef<HTMLInputElement>(null);
  const locations = useLocationChoices(doc);
  useEffect(() => {
    if (autoFocus) place.current?.focus({ preventScroll: inline ? false : true });
  }, [autoFocus, inline]);

  const submit = () => {
    if (!d.location.trim()) return place.current?.focus();
    const n = addEntry(after, { intExt: d.intExt, location: d.location, effect: d.effect || undefined, phrase: d.phrase });
    if (n === undefined) return;
    set({ phrase: '' });
    setActive(n);
    if (inline) setInsertAfter(n);
    requestAnimationFrame(() => {
      document.querySelector(`[data-outline-n="${n}"]`)?.scrollIntoView({ block: 'nearest' });
      place.current?.focus();
      place.current?.select();
    });
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onClose) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={[s.quick, stacked ? s.quickStacked : '', inline ? s.quickInline : ''].join(' ')} data-testid={inline ? 'outline-insert' : 'outline-quick-add'} role="group" aria-label="Nouvelle séquence">
      <span className={s.qInt}>
        <IntExtSelect value={d.intExt} onChange={(v) => set({ intExt: v })} onKeyDown={onKey} testId="quick-intext" />
      </span>
      <Combo ref={place} className={s.qPlace} value={d.location} onChange={(v) => set({ location: v })} choices={locations} placeholder="Lieu" onKeyDown={onKey} testId="quick-location" />
      <Combo className={s.qTime} value={d.effect} onChange={(v) => set({ effect: v })} choices={EFFECTS} placeholder="Moment" onKeyDown={onKey} testId="quick-effect" />
      <input
        className={[f.field, s.qPhrase].join(' ')}
        value={d.phrase}
        placeholder="Action essentielle en une phrase"
        aria-label="Action essentielle en une phrase"
        onChange={(e) => set({ phrase: e.target.value })}
        onKeyDown={onKey}
        data-testid="quick-phrase"
      />
    </div>
  );
}
