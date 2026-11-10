import { forwardRef, useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { blocksFromSource, EFFECT_WORDS, locationsOf } from '../../../domain/screenplay';
import type { ProjectDoc } from '../../../domain/types';
import { SuggestList, type Suggestion } from '../../../ui/SuggestList';
import { useSuggest } from '../../../ui/useSuggest';
import { pickChoices } from './outlineModel';
import s from './HeadingFields.module.css';

export const INT_EXT = ['INT.', 'EXT.'] as const;

export interface HeadingDraft {
  intExt: string;
  location: string;
  effect: string;
}

/** Lieux proposés : ceux des en-têtes du texte, puis les décors du projet. */
export function useLocationChoices(doc: ProjectDoc): string[] {
  return useMemo(() => {
    const fromText = locationsOf(blocksFromSource(doc.scenario ?? '').blocks);
    const decors = Object.values(doc.decors ?? {}).map((d) => d.name.trim().toLocaleUpperCase('fr'));
    return [...new Set([...fromText, ...decors].filter(Boolean))];
  }, [doc.scenario, doc.decors]);
}

/** Champ à suggestions (lieu, moment) : ↑ / ↓ choisissent, Entrée retient le choix ; sinon Entrée passe au formulaire. */
export const Combo = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    choices: readonly string[];
    placeholder: string;
    className?: string;
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
    testId?: string;
  }
>(function Combo({ value, onChange, choices, placeholder, className, onKeyDown, testId }, ref) {
  const [focused, setFocused] = useState(false);
  const anchor = useRef<HTMLInputElement | null>(null);
  const id = useId();
  const source = useCallback((q: string): Suggestion[] => pickChoices(choices, q).map((label) => ({ label })), [choices]);
  const sug = useSuggest(value, focused ? source : undefined);
  return (
    <>
      <input
        ref={(el) => {
          anchor.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        className={[s.field, className].join(' ')}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={sug.items.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (sug.onKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if ((e.key === 'Enter' || e.key === 'Tab') && sug.picked && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            if (e.key === 'Enter') e.preventDefault();
            onChange(sug.picked.value ?? sug.picked.label);
            sug.close();
            if (e.key === 'Enter') return;
          }
          onKeyDown?.(e);
        }}
        data-testid={testId}
      />
      {focused && (
        <SuggestList
          anchor={anchor}
          items={sug.items}
          active={sug.active}
          id={id}
          onHover={sug.setActive}
          onPick={(it) => {
            onChange(it.value ?? it.label);
            sug.close();
          }}
        />
      )}
    </>
  );
});

/** Préfixe de l'en-tête : liste native, sans cadre (Tab et les flèches y fonctionnent d'office). */
export function IntExtSelect({ value, onChange, onKeyDown, testId }: { value: string; onChange: (v: string) => void; onKeyDown?: (e: KeyboardEvent<HTMLSelectElement>) => void; testId?: string }) {
  return (
    <span className={s.select}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Intérieur ou extérieur" onKeyDown={onKeyDown} data-testid={testId}>
        {INT_EXT.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {!INT_EXT.includes(value as (typeof INT_EXT)[number]) && <option value={value}>{value || '—'}</option>}
      </select>
      <ChevronDown size={14} strokeWidth={1.25} aria-hidden="true" />
    </span>
  );
}

export const EFFECTS: readonly string[] = EFFECT_WORDS;
