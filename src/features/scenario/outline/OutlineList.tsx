import { DndContext, DragOverlay } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import type { OutlineItem, OutlineMeasures, OutlinePart, OutlineSequence } from '../../../domain/outline';
import type { ProjectDoc } from '../../../domain/types';
import { useCommitDraft } from '../ResearchPanels';
import { addPart, deleteEntry, deletePart, renamePart, writeSequence } from './outlineActions';
import { clock } from './outlineModel';
import { setActive, setEditing, setInsertAfter, useOutlineUi } from './outlineUi';
import { QuickAdd } from './QuickAdd';
import { Attrs, focusRow, HeadingEditor, PhraseField, RowMenu } from './RowParts';
import { useOutlineDnd, usePartDrop, useSeqDnd } from './useOutlineDnd';
import s from './OutlineView.module.css';

export interface RowContext {
  doc: ProjectDoc;
  readOnly: boolean;
  measures: OutlineMeasures;
  marks: Map<number, 'new' | 'changed'> | null;
  markFrom?: string;
  count: number;
}

/** Numéro de la séquence : double-clic (ou ⌘Entrée) ouvre le texte à son en-tête. */
export function SeqNumber({ it, ctx }: { it: OutlineSequence; ctx: RowContext }) {
  const mark = ctx.marks?.get(it.n - 1);
  return (
    <span
      className={s.n}
      title={`${ctx.readOnly ? 'Lire' : 'Écrire'} la séquence (⌘↵)`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        writeSequence(it.n);
      }}
    >
      {mark && (
        <i className={s.rev} title={mark === 'new' ? `Nouvelle depuis ${ctx.markFrom}` : `Modifiée depuis ${ctx.markFrom}`} data-testid="revision-mark">
          *
        </i>
      )}
      {it.n}
    </span>
  );
}

function SequenceRow({ it, ctx, mark, dragging }: { it: OutlineSequence; ctx: RowContext; mark: 'before' | 'after' | null; dragging: boolean }) {
  const active = useOutlineUi((u) => u.active === it.n);
  const editing = useOutlineUi((u) => (u.editing && 'n' in u.editing && u.editing.n === it.n ? u.editing.field : null));
  const dnd = useSeqDnd(it.n, ctx.readOnly);
  const m = ctx.measures.byN.get(it.n);
  const { readOnly } = ctx;
  return (
    <li
      ref={dnd.setRow}
      className={[s.row, readOnly ? s.rowRead : '', active ? s.rowOn : '', dragging ? s.dragging : ''].join(' ')}
      data-outline-n={it.n}
      data-drop={mark ?? undefined}
      tabIndex={active ? 0 : -1}
      aria-current={active || undefined}
      onFocus={(e) => e.target === e.currentTarget && setActive(it.n)}
      onMouseDown={() => setActive(it.n)}
      data-testid="outline-row"
    >
      {!readOnly && (
        <span ref={dnd.setHandle} className={s.handle} {...dnd.handleProps} aria-label={`Déplacer la séquence ${it.n}`} role="button" data-testid="outline-handle">
          <GripVertical size={14} strokeWidth={1.25} />
        </span>
      )}
      <SeqNumber it={it} ctx={ctx} />
      <div className={s.content}>
        {editing === 'heading' && !readOnly ? (
          <HeadingEditor it={it} doc={ctx.doc} />
        ) : readOnly ? (
          <span className={s.heading}>{it.heading}</span>
        ) : (
          <button type="button" className={s.heading} onClick={() => setEditing({ n: it.n, field: 'heading' })} data-testid="outline-heading">
            {it.heading}
          </button>
        )}
        {editing === 'phrase' && !readOnly ? (
          <PhraseField it={it} count={ctx.count} />
        ) : readOnly ? (
          it.phrase && <p className={s.phrase}>{it.phrase}</p>
        ) : (
          <p
            className={s.phrase}
            onClick={() => {
              setActive(it.n);
              setEditing({ n: it.n, field: 'phrase' });
            }}
            data-testid="outline-phrase"
          >
            {it.phrase || ' '}
          </p>
        )}
        <Attrs it={it} readOnly={readOnly} />
      </div>
      <span className={s.measures}>
        {m && <span>p. {m.page}</span>}
        {m && <span>{clock(m.sec)}</span>}
      </span>
      {!readOnly && (
        <RowMenu
          label={`Séquence ${it.n}`}
          items={[
            { label: 'Écrire la séquence', run: () => writeSequence(it.n) },
            { label: 'Insérer une séquence après', run: () => setInsertAfter(it.n), testId: 'outline-insert-after' },
            { label: 'Insérer une partie avant', run: () => addPart(it.n), testId: 'outline-insert-part' },
            'sep',
            { label: 'Supprimer la séquence', run: () => void deleteEntry(ctx.doc, it.n), testId: 'outline-delete' },
          ]}
        />
      )}
    </li>
  );
}

function PartTitle({ part, index, readOnly }: { part: OutlinePart; index: number; readOnly: boolean }) {
  const editing = useOutlineUi((u) => !!u.editing && 'part' in u.editing && u.editing.part === index);
  const [draft, setDraft, commit] = useCommitDraft(part.title, (v) => v.trim() && renamePart(index, v), readOnly);
  if (readOnly) return <span className={s.partTitle}>{part.title}</span>;
  if (!editing)
    return (
      <button type="button" className={s.partTitle} onClick={() => setEditing({ part: index, field: 'part' })} data-testid="outline-part-title">
        {part.title}
      </button>
    );
  return (
    <input
      ref={(el) => {
        if (el && document.activeElement !== el) {
          el.focus();
          el.select();
        }
      }}
      className={s.partInput}
      value={draft}
      size={Math.max(8, draft.length + 1)}
      aria-label="Titre de la partie"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        commit();
        setEditing(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          setEditing(null);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(part.title);
          setEditing(null);
        }
      }}
      data-testid="outline-part-input"
    />
  );
}

function PartRow({ part, index, readOnly, marked }: { part: OutlinePart; index: number; readOnly: boolean; marked: boolean }) {
  const setDrop = usePartDrop(index, readOnly);
  return (
    <li ref={setDrop} className={[s.part, readOnly ? s.rowRead : ''].join(' ')} data-drop={marked ? 'after' : undefined} data-testid="outline-part">
      <PartTitle part={part} index={index} readOnly={readOnly} />
      <span className={s.partRule} aria-hidden="true" />
      {!readOnly && <RowMenu label={`Partie ${part.title}`} items={[{ label: 'Supprimer la partie', run: () => deletePart(index), testId: 'outline-delete-part' }]} />}
    </li>
  );
}

/** Vue Liste : lignes empilées, intertitres, ligne d'ajout ouverte sous une séquence. */
export function OutlineList({ items, ctx }: { items: readonly OutlineItem[]; ctx: RowContext }) {
  const dnd = useOutlineDnd(items);
  const insertAfter = useOutlineUi((u) => u.insertAfter);
  let partIndex = -1;
  const dragged = dnd.dragging !== null ? items.find((x): x is OutlineSequence => x.kind === 'sequence' && x.n === dnd.dragging) : undefined;
  return (
    <DndContext {...dnd.ctx}>
      <ol className={s.list} aria-label="Séquences" data-testid="outline-list">
        {items.map((x) => {
          if (x.kind === 'part') {
            partIndex++;
            return <PartRow key={`part-${x.start}`} part={x} index={partIndex} readOnly={ctx.readOnly} marked={dnd.partMarked(partIndex)} />;
          }
          return [
            <SequenceRow key={`seq-${x.n}`} it={x} ctx={ctx} mark={dnd.markFor(x.n)} dragging={dnd.dragging === x.n} />,
            insertAfter === x.n && !ctx.readOnly ? (
              <li key={`insert-${x.n}`} className={s.insertRow}>
                <QuickAdd
                  doc={ctx.doc}
                  after={x.n}
                  autoFocus
                  onClose={() => {
                    setInsertAfter(null);
                    focusRow(useOutlineUi.getState().active ?? x.n);
                  }}
                />
              </li>
            ) : null,
          ];
        })}
      </ol>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className={s.ghost}>
            <span className={s.n}>{dragged.n}</span>
            <span className={s.ghostHeading}>{dragged.heading}</span>
            {dragged.phrase && <span className={s.ghostPhrase}>{dragged.phrase}</span>}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
