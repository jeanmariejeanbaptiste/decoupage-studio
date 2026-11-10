import { useState, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { filterSteps } from './outlineModel';
import { menuKeys, Popover } from './Popover';
import p from './Popover.module.css';

/** Étape de Truby : liste numérotée des 22, filtrable en tapant, étapes clés en 500, « Aucune » en dernier. */
export function StepMenu({ anchor, value, onPick, onClose }: { anchor: RefObject<HTMLElement>; value?: number | string; onPick: (n: number | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const steps = filterSteps(q);
  const pick = (n: number | null) => {
    onClose();
    onPick(n);
    anchor.current?.focus();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} label="Étape" testId="outline-step-menu">
      <input
        className={p.filter}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Étape"
        aria-label="Filtrer les étapes"
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && steps.length) {
            e.preventDefault();
            pick(steps[0].n);
          } else menuKeys(e);
        }}
      />
      <div role="menu" aria-label="Étapes">
        {steps.map((st) => (
          <button
            key={st.n}
            type="button"
            role="menuitemradio"
            aria-checked={Number(value) === st.n}
            className={p.item}
            data-item
            onClick={() => pick(st.n)}
            onKeyDown={menuKeys}
          >
            <span className={p.num}>{st.n}</span>
            <span className={[p.label, st.key ? p.key : ''].join(' ')}>{st.label}</span>
          </button>
        ))}
        {!q.trim() && (
          <>
            <hr className={p.sep} />
            <button type="button" role="menuitemradio" aria-checked={value === undefined} className={p.item} data-item onClick={() => pick(null)} onKeyDown={menuKeys}>
              <span className={p.num} />
              <span className={p.label}>Aucune</span>
            </button>
          </>
        )}
        {steps.length === 0 && <p className={p.empty}>Aucune étape</p>}
      </div>
    </Popover>
  );
}

/** Intrigue d'une séquence : la liste des intrigues, la courante cochée. */
export function PlotPicker({
  anchor,
  plots,
  value,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement>;
  plots: ReadonlyArray<{ key: string; name: string }>;
  value: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={240} label="Intrigue" testId="outline-plot-menu">
      <div role="menu" aria-label="Intrigues">
        {plots.map((pl) => (
          <button
            key={pl.key}
            type="button"
            role="menuitemradio"
            aria-checked={pl.key === value}
            className={p.item}
            data-item
            onClick={() => {
              onClose();
              if (pl.key !== value) onPick(pl.key);
              anchor.current?.focus();
            }}
            onKeyDown={menuKeys}
          >
            <span className={p.check}>{pl.key === value && <Check size={14} strokeWidth={1.25} aria-hidden="true" />}</span>
            <span className={p.label}>{pl.name}</span>
            <span className={p.num}>{pl.key}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

/** Menu d'actions (⋯) : une liste de libellés. */
export function ActionMenu({ anchor, items, onClose, label }: { anchor: RefObject<HTMLElement>; items: ReadonlyArray<{ label: string; run: () => void; testId?: string } | 'sep'>; onClose: () => void; label: string }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={240} align="end" label={label} testId="outline-row-menu">
      <div role="menu" aria-label={label}>
        {items.map((it, i) =>
          it === 'sep' ? (
            <hr key={`sep-${i}`} className={p.sep} />
          ) : (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={p.item}
              data-item
              data-testid={it.testId}
              onClick={() => {
                onClose();
                it.run();
              }}
              onKeyDown={menuKeys}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}
