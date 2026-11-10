import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, Keyboard } from 'lucide-react';
import { editableText } from '../../../domain/cells';
import { parseFountain, parseHeading } from '../../../domain/fountain';
import { sequenceNumber } from '../../../domain/numbering';
import { insertAtCaret, markRanges, scriptPieces, type ScriptPiece } from '../../../domain/phoneCut';
import { passageInsertText } from '../../../domain/scriptToShot';
import type { ID, ProjectDoc } from '../../../domain/types';
import { commitCell } from '../actions';
import { Sheet, sheetStyles as s } from './Sheet';

type Mode = 'keys' | 'script';

/**
 * Feuille Action : le texte, écrit au clavier ou pris dans le scénario. Toucher une phrase (ou une
 * réplique) de la séquence l'insère au curseur et la surligne, ici et dans le scénario ; l'action du
 * plan est alors liée à ces passages (même annulation que le texte).
 */
export function ActionSheet({ doc, shotId, onClose }: { doc: ProjectDoc; shotId: ID; onClose: () => void }) {
  const shot = doc.shots[shotId];
  const initial = editableText(doc, shotId, 'action');
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const picked = useRef<Array<{ start: number; end: number }>>([]);
  const [inserted, setInserted] = useState<string[]>([]);
  // Le texte de la séquence, et celui de la suivante (en retrait) : de quoi continuer l'action.
  const { pieces, next } = useMemo(() => {
    const elements = parseFountain(doc.scenario ?? '');
    const ids = doc.project.sequenceIds;
    const after = ids[ids.indexOf(shot.sequenceId) + 1];
    return { pieces: scriptPieces(doc, shot.sequenceId, elements), next: after ? scriptPieces(doc, after, elements) : [] };
  }, [doc, shot.sequenceId]);
  const hasScript = pieces.some((p) => p.kind !== 'heading');
  const seqNo = sequenceNumber(doc, shot.sequenceId);
  const [mode, setMode] = useState<Mode>(hasScript ? 'script' : 'keys');
  const area = useRef<HTMLTextAreaElement>(null);

  // Au clavier : le champ prend le focus, curseur à sa place.
  useLayoutEffect(() => {
    if (mode !== 'keys' || !area.current) return;
    area.current.focus({ preventScroll: true });
    area.current.setSelectionRange(caret, caret);
    // Au changement de mode seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const done = useCallback(() => {
    commitCell(shotId, 'action', text.trim(), picked.current);
    onClose();
  }, [onClose, shotId, text]);

  const source = doc.scenario ?? '';
  const take = (p: ScriptPiece) => {
    const snippet = passageInsertText(doc, source, p.start, p.end) || p.text;
    const r = insertAtCaret(text, caret, snippet);
    setText(r.text);
    setCaret(r.caret);
    picked.current.push({ start: p.start, end: p.end });
    setInserted((l) => [...l, snippet]);
  };
  const isOn = (p: ScriptPiece) => p.kind !== 'heading' && (text.includes(p.text) || inserted.some((x) => x.includes(p.text)));
  const marks = markRanges(text, [...inserted, ...pieces.filter((p) => p.kind === 'sentence' && text.includes(p.text)).map((p) => p.text)]);

  return (
    <Sheet label="Action" onDone={done} tall testId="sheet-action">
      <div className={s.write}>
        <Mirror text={text} marks={marks} caret={mode === 'script' ? caret : -1} />
        <textarea
          ref={area}
          value={text}
          aria-label="Action"
          placeholder="—"
          readOnly={mode === 'script'}
          inputMode={mode === 'script' ? 'none' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionEnd);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionEnd)}
          onPointerDown={() => mode === 'script' && setMode('keys')}
        />
      </div>
      {hasScript && (
        <>
          <div className={s.modes} role="tablist" aria-label="Écrire l’action">
            <button type="button" role="tab" aria-selected={mode === 'keys'} className={mode === 'keys' ? s.on : ''} onClick={() => setMode('keys')}>
              <Keyboard size={19} strokeWidth={1.3} /> Clavier
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'script'}
              className={mode === 'script' ? s.on : ''}
              onClick={() => {
                area.current?.blur();
                setMode('script');
              }}
              data-testid="action-from-script"
            >
              <FileText size={19} strokeWidth={1.3} /> Depuis le scénario
            </button>
          </div>
          {mode === 'script' && (
            <div className={s.script} data-testid="action-script">
              <Pieces pieces={pieces} seqNumber={seqNo} isOn={isOn} onTake={take} />
              {next.length > 0 && (
                <div className={s.next}>
                  <Pieces pieces={next} seqNumber={seqNo + 1} isOn={isOn} onTake={take} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Texte en miroir sous le champ : les passages pris au scénario surlignés, le curseur quand le clavier est rangé. */
function Mirror({ text, marks, caret }: { text: string; marks: Array<[number, number]>; caret: number }) {
  const out: ReactNode[] = [];
  let at = 0;
  const push = (from: number, to: number, mark: boolean) => {
    if (to <= from) return;
    if (caret >= from && caret < to) {
      push(from, caret, mark);
      out.push(<span key={`c${caret}`} className={s.caret} />);
      push(caret, to, mark);
      return;
    }
    out.push(mark ? <mark key={from}>{text.slice(from, to)}</mark> : <Fragment key={from}>{text.slice(from, to)}</Fragment>);
  };
  for (const [a, b] of marks) {
    push(at, a, false);
    push(a, b, true);
    at = b;
  }
  push(at, text.length, false);
  if (caret === text.length) out.push(<span key="cend" className={s.caret} />);
  return (
    <div className={s.mirror} aria-hidden="true">
      {out}
      {'\n'}
    </div>
  );
}

/** Le scénario d'une séquence : en-tête, phrases d'action à toucher, répliques entières. */
function Pieces({ pieces, seqNumber, isOn, onTake }: { pieces: ScriptPiece[]; seqNumber: number; isOn: (p: ScriptPiece) => boolean; onTake: (p: ScriptPiece) => void }) {
  const blocks: ReactNode[] = [];
  let para: ScriptPiece[] = [];
  const flush = () => {
    if (!para.length) return;
    const list = para;
    blocks.push(
      <p key={`p${list[0].start}`}>
        {list.map((p, i) => (
          <Fragment key={p.start}>
            {i > 0 && ' '}
            <Take on={isOn(p)} onTake={() => onTake(p)} testId="script-sentence">
              {p.text}
            </Take>
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  for (const p of pieces) {
    if (p.kind === 'sentence' && para.length && para[0].para !== p.para) flush();
    if (p.kind === 'sentence') {
      para.push(p);
      continue;
    }
    flush();
    if (p.kind === 'heading')
      blocks.push(
        <h4 key={`h${p.start}`}>
          {[String(seqNumber), ...headingParts(p.text)].map((part, k) => (
            <Fragment key={k}>
              {k > 0 && <span className={s.d}>·</span>}
              {part}
            </Fragment>
          ))}
        </h4>,
      );
    else
      blocks.push(
        <p key={`r${p.start}`}>
          <Take on={isOn(p)} onTake={() => onTake(p)} testId="script-reply">
            <span className={s.who}>{p.who}</span>
            {p.text}
          </Take>
        </p>,
      );
  }
  flush();
  return <>{blocks}</>;
}

/** Passage à toucher : il suit les lignes du paragraphe (un bouton ferait un bloc). */
function Take({ on, onTake, testId, children }: { on: boolean; onTake: () => void; testId: string; children: ReactNode }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={[s.take, on ? s.on : ''].join(' ')}
      aria-pressed={on}
      onClick={onTake}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTake())}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/** En-tête de scène en morceaux : « Int. Gare — Hall », « Jour ». */
function headingParts(heading: string): string[] {
  const h = parseHeading(heading);
  if (!h.location) return [heading];
  return [h.intExt ? `${h.intExt}. ${h.location}` : h.location, h.effect ?? ''].filter(Boolean);
}
