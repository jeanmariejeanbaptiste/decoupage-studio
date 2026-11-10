import { useCallback, useEffect, useRef, useState } from 'react';
import { editableText, setCellText } from '../../../domain/cells';
import type { ColumnKey, ID, ProjectDoc } from '../../../domain/types';
import { mutateDoc } from '../../../store/projectStore';
import { commitCell } from '../actions';
import { suggestionSource } from '../suggestions';
import { SeqMeta } from '../SeqMeta';
import { Sheet, sheetStyles as s } from './Sheet';

const MULTILINE: readonly ColumnKey[] = ['action', 'dialogue', 'notes', 'sound', 'light'];

/**
 * Feuille d'un champ écrit (son, image, dialogue, sujet, ouverture…) : le texte, et pour les champs
 * à vocabulaire, les propositions à toucher. Validé en refermant la feuille.
 */
export function TextSheet({ doc, shotId, col, label, onClose }: { doc: ProjectDoc; shotId: ID; col: ColumnKey; label: string; onClose: () => void }) {
  const initial = editableText(doc, shotId, col);
  const [draft, setDraft] = useState(initial);
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const done = useCallback(() => {
    if (draft !== initial) commitCell(shotId, col, col === 'action' || MULTILINE.includes(col) ? draft.trim() : draft);
    onClose();
  }, [col, draft, initial, onClose, shotId]);

  const suggest = suggestionSource(doc, col);
  // Dernière valeur après une virgule : on la complète ; valeur entière : toute la liste.
  const last = draft.split(/,\s*/).pop() ?? '';
  const matches = suggest ? suggest(last) : [];
  const chips = (matches.length <= 1 && suggest ? suggest('') : matches).slice(0, 12);
  const pick = (v: string) => {
    const parts = draft.split(/,\s*/);
    parts[parts.length - 1] = v;
    setDraft(parts.filter(Boolean).join(', '));
  };
  const multi = MULTILINE.includes(col);
  const common = { value: draft, 'aria-label': label, placeholder: '—', onChange: (e: { target: { value: string } }) => setDraft(e.target.value) };
  return (
    <Sheet label={label} onDone={done} testId={`sheet-${col}`}>
      <div className={s.text}>
        {multi ? (
          <textarea ref={field} rows={Math.max(4, Math.ceil(draft.length / 32))} {...common} />
        ) : (
          <input ref={field} {...common} inputMode={col === 'aperture' || col === 'shootingDay' ? 'decimal' : undefined} enterKeyHint="done" onKeyDown={(e) => e.key === 'Enter' && done()} />
        )}
      </div>
      {chips.length > 0 && (
        <div className={s.chips}>
          {chips.map((sg) => {
            const v = sg.value ?? sg.label;
            return (
              <button key={sg.label} type="button" className={draft.split(/,\s*/).includes(v) ? s.on : ''} onPointerDown={(e) => e.preventDefault()} onClick={() => pick(v)}>
                {sg.label}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/** Feuille Séquence : son nom (décor), intérieur ou extérieur et effet. */
export function SequenceSheet({ doc, shotId, onClose }: { doc: ProjectDoc; shotId: ID; onClose: () => void }) {
  const initial = editableText(doc, shotId, 'sequence');
  const [draft, setDraft] = useState(initial);
  const done = useCallback(() => {
    if (draft.trim() !== initial) mutateDoc((d) => void setCellText(d, shotId, 'sequence', draft));
    onClose();
  }, [draft, initial, onClose, shotId]);
  const suggest = suggestionSource(doc, 'sequence');
  const chips = suggest ? suggest(draft).filter((x) => x.label !== draft.trim().toUpperCase()).slice(0, 6) : [];
  return (
    <Sheet label="Séquence" onDone={done} testId="sheet-sequence">
      <div className={s.text}>
        <input value={draft} aria-label="Nom de la séquence" placeholder="—" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && done()} />
      </div>
      {chips.length > 0 && (
        <div className={s.chips}>
          {chips.map((sg) => (
            <button key={sg.label} type="button" onClick={() => setDraft(sg.label)}>
              {sg.label}
            </button>
          ))}
        </div>
      )}
      <div className={s.meta}>
        <SeqMeta doc={doc} seqId={doc.shots[shotId].sequenceId} />
      </div>
    </Sheet>
  );
}
