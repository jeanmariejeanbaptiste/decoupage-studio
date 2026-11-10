import { useRef, useState, type CSSProperties } from 'react';
import { DndContext } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import type { OutlineItem, OutlinePart, OutlineSequence } from '../../../domain/outline';
import { stepLabel } from '../../../domain/truby';
import { setPlot } from './outlineActions';
import { clock, weaveColumns } from './outlineModel';
import { PlotPicker } from './OutlineMenus';
import { setActive, useOutlineUi } from './outlineUi';
import { SeqNumber, type RowContext } from './OutlineList';
import { useOutlineDnd, usePartDrop, useSeqDnd } from './useOutlineDnd';
import s from './OutlineWeave.module.css';

/** Case de l'intrigue d'une séquence : la phrase, l'étape dessous ; un clic ouvre le menu Intrigue. */
function PlotCell({ it, ctx }: { it: OutlineSequence; ctx: RowContext }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const body = (
    <>
      <span className={s.phrase}>{it.phrase || '—'}</span>
      {it.step !== undefined && <span className={s.step}>{stepLabel(it.step)}</span>}
    </>
  );
  if (ctx.readOnly) return <div className={s.cell}>{body}</div>;
  return (
    <div className={s.cell}>
      <button
        ref={ref}
        type="button"
        className={s.cellBtn}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Intrigue de la séquence ${it.n}`}
        onClick={() => {
          setActive(it.n);
          setOpen(!open);
        }}
        data-testid="weave-phrase"
      >
        {body}
      </button>
      {open && <PlotPicker anchor={ref} plots={ctx.plots} value={it.plot} onClose={() => setOpen(false)} onPick={(k) => setPlot(it.n, k)} />}
    </div>
  );
}

function WeaveRow({ it, ctx, keys, mark }: { it: OutlineSequence; ctx: RowContext; keys: readonly string[]; mark: 'before' | 'after' | null }) {
  const active = useOutlineUi((u) => u.active === it.n);
  const dnd = useSeqDnd(it.n, ctx.readOnly);
  return (
    <div
      ref={dnd.setRow}
      role="row"
      className={[s.row, active ? s.rowOn : '', ctx.dimmed(it.plot) ? s.dim : ''].join(' ')}
      data-outline-n={it.n}
      data-drop={mark ?? undefined}
      tabIndex={active ? 0 : -1}
      aria-current={active || undefined}
      onFocus={(e) => e.target === e.currentTarget && setActive(it.n)}
      onMouseDown={() => setActive(it.n)}
      data-testid="weave-row"
    >
      {!ctx.readOnly && (
        <span ref={dnd.setHandle} className={[s.fixed, s.handle].join(' ')} {...dnd.handleProps} aria-label={`Déplacer la séquence ${it.n}`} role="button" data-testid="outline-handle">
          <GripVertical size={14} strokeWidth={1.25} />
        </span>
      )}
      <span className={[s.fixed, s.num].join(' ')}>
        <SeqNumber it={it} ctx={ctx} />
      </span>
      <span className={[s.fixed, s.seq].join(' ')} title={it.heading}>
        {it.heading}
      </span>
      {keys.map((k) => (
        <div key={k} role="cell" className={s.col} data-plot={k}>
          {it.plot === k && <PlotCell it={it} ctx={ctx} />}
        </div>
      ))}
    </div>
  );
}

function WeavePart({ part, index, readOnly, marked }: { part: OutlinePart; index: number; readOnly: boolean; marked: boolean }) {
  const setDrop = usePartDrop(index, readOnly);
  return (
    <div ref={setDrop} role="row" className={s.part} data-drop={marked ? 'after' : undefined}>
      <span className={s.partTitle}>{part.title}</span>
    </div>
  );
}

/**
 * Vue Par intrigue (le tissage) : une colonne par intrigue cochée, la phrase dans celle de sa séquence.
 * N° et Séquence restent figés ; le défilement horizontal reste dans la vue.
 */
export function OutlineWeave({ items, ctx, keys }: { items: readonly OutlineItem[]; ctx: RowContext; keys: readonly string[] }) {
  const dnd = useOutlineDnd(items);
  const seqs = items.filter((x): x is OutlineSequence => x.kind === 'sequence');
  const cols = weaveColumns(seqs, keys, ctx.measures);
  const name = (k: string) => ctx.plots.find((p) => p.key === k)?.name ?? `Intrigue ${k}`;
  const lead = ctx.readOnly ? 0 : 20;
  // Largeur au moins égale aux colonnes à leur minimum : au-delà de la vue, elle défile en elle-même.
  const style = {
    '--cols': `${lead ? `${lead}px ` : ''}40px 260px ${keys.map(() => 'minmax(220px, 1fr)').join(' ')}`,
    '--fixed2': `${lead}px`,
    minWidth: lead + 40 + 260 + keys.length * 220,
  } as CSSProperties;
  let partIndex = -1;
  return (
    <DndContext {...dnd.ctx}>
      <div className={s.scroller} data-testid="outline-weave">
        <div className={s.table} role="table" aria-label="Séquences par intrigue" style={style}>
          <div role="row" className={[s.row, s.head].join(' ')}>
            {!ctx.readOnly && <span className={[s.fixed, s.handle].join(' ')} />}
            <span className={[s.fixed, s.num, s.headLabel].join(' ')} role="columnheader">
              N°
            </span>
            <span className={[s.fixed, s.seq, s.headLabel].join(' ')} role="columnheader">
              Séquence
            </span>
            {cols.map((c) => (
              <div key={c.key} role="columnheader" className={s.col} data-testid={`weave-col-${c.key}`}>
                <span className={s.headLabel}>{name(c.key)}</span>
                <span className={s.headMeta}>
                  {c.count} · {clock(c.sec)}
                </span>
              </div>
            ))}
          </div>
          {items.map((x) => {
            if (x.kind === 'part') {
              partIndex++;
              return <WeavePart key={`part-${x.start}`} part={x} index={partIndex} readOnly={ctx.readOnly} marked={dnd.partMarked(partIndex)} />;
            }
            return <WeaveRow key={`seq-${x.n}`} it={x} ctx={ctx} keys={keys} mark={dnd.markFor(x.n)} />;
          })}
        </div>
      </div>
    </DndContext>
  );
}
