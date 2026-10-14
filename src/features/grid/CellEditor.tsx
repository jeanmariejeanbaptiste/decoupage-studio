import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { parseTokens, type TokenSep } from '../../domain/tokens';
import type { ColumnKey, ProjectDoc } from '../../domain/types';
import { hasAngleConflict, isZoom } from '../../domain/vocabulary';
import { SuggestList, type Suggestion } from '../../ui/SuggestList';
import { useSuggest } from '../../ui/useSuggest';
import { suggestionSource } from './suggestions';
import s from './CellEditor.module.css';

export type CommitMove = 'down' | 'right' | 'left' | 'none';

interface EditorProps {
  doc: ProjectDoc;
  shotId: string;
  col: ColumnKey;
  initial: string;
  /** Saisie démarrée par une frappe : le contenu est remplacé. */
  replace?: string;
  onCommit: (text: string, move: CommitMove) => void;
  onCancel: () => void;
}

export function CellEditor(raw: EditorProps) {
  // Une seule validation par session d'édition (le blur qui suit Entrée est ignoré).
  const done = useRef(false);
  const props: EditorProps = {
    ...raw,
    onCommit: (text, move) => {
      if (done.current) return;
      done.current = true;
      raw.onCommit(text, move);
    },
    onCancel: () => {
      if (done.current) return;
      done.current = true;
      raw.onCancel();
    },
  };
  if (props.col === 'angle' || props.col === 'movement') return <TokenEditor {...props} />;
  if (props.col === 'focal') return <FocalEditor {...props} />;
  return <TextEditor {...props} />;
}

function commitKey(e: KeyboardEvent, multiline: boolean): CommitMove | null {
  if (e.key === 'Enter' && !(multiline && e.shiftKey) && !e.metaKey && !e.ctrlKey) return 'down';
  if (e.key === 'Tab') return e.shiftKey ? 'left' : 'right';
  return null;
}

function TextEditor({ doc, col, initial, replace, onCommit, onCancel }: EditorProps) {
  const multiline = col === 'action' || col === 'dialogue' || col === 'notes';
  const [value, setValue] = useState(replace ?? initial);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const listId = useId();
  // Les suggestions n'apparaissent qu'une fois la saisie commencée.
  const touched = replace !== undefined || value !== initial;
  const sug = useSuggest(touched ? value : '', suggestionSource(doc, col));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && multiline) {
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value, multiline]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (sug.onKey(e)) {
      e.preventDefault();
      return;
    }
    const move = commitKey(e, multiline);
    if (move) {
      e.preventDefault();
      onCommit(sug.picked ? (sug.picked.value ?? sug.picked.label) : value, move);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    e.stopPropagation();
  };

  const common = {
    ref,
    value,
    className: [s.input, col === 'sequence' ? s.upper : '', col === 'tc' ? s.mono : ''].join(' '),
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onKeyDown,
    onBlur: () => onCommit(value, 'none'),
    'aria-label': `Modifier ${col}`,
    'aria-autocomplete': 'list' as const,
    'aria-controls': sug.items.length ? listId : undefined,
    'aria-activedescendant': sug.active >= 0 ? `${listId}-${sug.active}` : undefined,
    'data-testid': 'cell-editor',
  };
  return (
    <>
      {multiline ? <textarea rows={1} {...common} /> : <input {...common} />}
      <SuggestList
        id={listId}
        anchor={ref}
        items={sug.items}
        active={sug.active}
        onHover={sug.setActive}
        onPick={(it: Suggestion) => onCommit(it.value ?? it.label, 'none')}
      />
    </>
  );
}

function TokenEditor({ doc, col, initial, replace, onCommit, onCancel }: EditorProps) {
  const parsed = parseTokens(initial);
  const [tokens, setTokens] = useState<string[]>(replace !== undefined ? [] : parsed.tokens);
  const [sep, setSep] = useState<TokenSep>(parsed.sep);
  const [draft, setDraft] = useState(replace ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sug = useSuggest(draft, suggestionSource(doc, col));
  const conflict = col === 'angle' && hasAngleConflict(tokens);

  useLayoutEffect(() => ref.current?.focus(), []);

  const serialize = (list: string[]) => list.join(sep);
  const withDraft = (extra?: string) => {
    const t = (extra ?? draft).trim();
    return t ? [...tokens, t] : tokens;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (sug.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === ',' || e.key === '+') {
      e.preventDefault();
      if (e.key === '+') setSep(' + ');
      else setSep(', ');
      if (draft.trim()) {
        setTokens(withDraft());
        setDraft('');
      }
      return;
    }
    if (e.key === 'Backspace' && draft === '' && tokens.length) {
      e.preventDefault();
      setTokens(tokens.slice(0, -1));
      return;
    }
    if (e.key === 'Enter' && sug.picked) {
      e.preventDefault();
      setTokens(withDraft(sug.picked.label));
      setDraft('');
      return;
    }
    const move = commitKey(e, false);
    if (move) {
      e.preventDefault();
      onCommit(serialize(withDraft(sug.picked?.label)), move);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      ref={boxRef}
      className={[s.tokens, conflict ? s.conflict : ''].join(' ')}
      title={conflict ? 'Deux axes ou deux hauteurs incompatibles' : undefined}
      onMouseDown={(e) => {
        if (e.target === boxRef.current) {
          e.preventDefault();
          ref.current?.focus();
        }
      }}
    >
      {tokens.map((t, i) => (
        <span key={`${t}-${i}`} className={s.chip} data-testid="token">
          {t}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Retirer ${t}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setTokens(tokens.filter((_, j) => j !== i));
            }}
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        className={s.tokenInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onCommit(serialize(withDraft()), 'none')}
        aria-label={`Ajouter un jeton (${col})`}
        aria-autocomplete="list"
        aria-controls={sug.items.length ? listId : undefined}
        data-testid="cell-editor"
      />
      <SuggestList
        id={listId}
        anchor={boxRef}
        items={sug.items}
        active={sug.active}
        onHover={sug.setActive}
        onPick={(it) => {
          setTokens(withDraft(it.label));
          setDraft('');
          ref.current?.focus();
        }}
      />
    </div>
  );
}

function FocalEditor({ doc, shotId, initial, replace, onCommit, onCancel }: EditorProps) {
  const shot = doc.shots[shotId];
  const zoom = isZoom(shot?.movement ?? []);
  const [from0, to0] = initial.split('→').map((x) => x.trim());
  const [from, setFrom] = useState(replace !== undefined ? replace.replace(/\D/g, '') : (from0 ?? ''));
  const [to, setTo] = useState(to0 ?? (shot?.focal.to !== undefined ? String(shot.focal.to) : ''));
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sug = useSuggest(replace !== undefined || from !== from0 ? from : '', suggestionSource(doc, 'focal'));
  const blurTimer = useRef<number>();

  useLayoutEffect(() => fromRef.current?.focus(), []);
  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  const serialize = (f: string, t: string) => (zoom && t ? `${f} → ${t}` : f);
  const digits = (v: string) => v.replace(/[^\d.,]/g, '');

  const onKeyDown = (which: 'from' | 'to') => (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (which === 'from' && sug.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (zoom && which === 'from' && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (sug.picked) setFrom(sug.picked.value ?? '');
      toRef.current?.focus();
      return;
    }
    const move = commitKey(e, false);
    if (move) {
      e.preventDefault();
      const f = which === 'from' && sug.picked ? (sug.picked.value ?? from) : from;
      onCommit(serialize(f, to), move);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  // Le blur ne valide que si le focus quitte réellement l'éditeur (pas de « de » vers « à »).
  const onBlur = () => {
    blurTimer.current = window.setTimeout(() => {
      if (!boxRef.current?.contains(document.activeElement)) onCommit(serialize(from, to), 'none');
    }, 0);
  };

  return (
    <div ref={boxRef} className={[s.focal, zoom ? s.zoom : ''].join(' ')}>
      {zoom && <span className={s.word}>de</span>}
      <input
        ref={fromRef}
        inputMode="numeric"
        className={s.num}
        value={from}
        onChange={(e) => setFrom(digits(e.target.value))}
        onKeyDown={onKeyDown('from')}
        onBlur={onBlur}
        aria-label={zoom ? 'Focale de départ' : 'Focale'}
        data-testid="cell-editor"
      />
      {zoom && (
        <>
          <span className={s.word}>à</span>
          <input
            ref={toRef}
            inputMode="numeric"
            className={s.num}
            value={to}
            onChange={(e) => setTo(digits(e.target.value))}
            onKeyDown={onKeyDown('to')}
            onBlur={onBlur}
            aria-label="Focale d’arrivée"
            data-testid="focal-to"
          />
        </>
      )}
      <span className={s.mm} aria-hidden="true">mm</span>
      <SuggestList
        id={listId}
        anchor={boxRef}
        items={sug.items}
        active={sug.active}
        onHover={sug.setActive}
        onPick={(it) => {
          setFrom(it.value ?? '');
          if (zoom) toRef.current?.focus();
          else onCommit(serialize(it.value ?? '', to), 'none');
        }}
      />
    </div>
  );
}
