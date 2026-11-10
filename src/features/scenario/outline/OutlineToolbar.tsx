import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { outlineSequences, plotsInUse, plotsOf } from '../../../domain/outline';
import type { ProjectDoc } from '../../../domain/types';
import { useReadOnly } from '../../../store/share';
import { useIsMobile } from '../../../ui/useIsMobile';
import { TextToggle } from '../TextToggle';
import { addPlot, removePlot, renamePlot } from './outlineActions';
import { plotKeys } from './outlineModel';
import { setOutlineMode, togglePlot, useOutlineUi, type OutlineMode } from './outlineUi';
import { menuKeys, Popover } from './Popover';
import p from './Popover.module.css';
import s from './OutlineToolbar.module.css';

export { savedOutlineMode, type OutlineMode } from './outlineUi';

const MODES: ReadonlyArray<readonly [OutlineMode, string]> = [
  ['list', 'Liste'],
  ['plots', 'Par intrigue'],
];

/** Nom d'une intrigue édité sur place : Entrée ou sortie du champ valident, Échap annule. */
function PlotName({ name, onDone }: { name: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(name);
  const done = useRef(false);
  const end = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      className={s.rename}
      value={v}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      aria-label="Nom de l’intrigue"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => end(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          end(v);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          end(null);
        }
      }}
      data-testid="plot-rename-input"
    />
  );
}

/** Menu Intrigues : filtre (cases), renommer, supprimer une intrigue inutilisée, en créer une. Invité : filtre seul. */
function PlotsMenu({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const hidden = useOutlineUi((u) => u.hidden);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const declared = plotsOf(doc);
  const seqs = useMemo(() => outlineSequences(doc.scenario ?? ''), [doc.scenario]);
  const keys = plotKeys(declared, seqs);
  const used = useMemo(() => (open ? plotsInUse(doc) : new Set<string>()), [open, doc]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of seqs) m.set(x.plot, (m.get(x.plot) ?? 0) + 1);
    return m;
  }, [seqs]);
  const name = (k: string) => declared.find((x) => x.key === k)?.name ?? `Intrigue ${k}`;
  const filtered = keys.some((k) => hidden.includes(k));
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={[s.menuBtn, filtered ? s.menuBtnOn : ''].join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="outline-plots"
      >
        Intrigues
        <ChevronDown size={14} strokeWidth={1.25} aria-hidden="true" />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => (setOpen(false), setRenaming(null))} width={300} label="Intrigues" testId="outline-plots-menu">
          {keys.map((k) => {
            const n = counts.get(k) ?? 0;
            const removable = !readOnly && !used.has(k) && keys.length > 1 && declared.some((x) => x.key === k);
            return (
              <div key={k} className={s.line} data-testid={`plot-line-${k}`}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={!hidden.includes(k)}
                  className={s.check}
                  onClick={() => togglePlot(k)}
                  onKeyDown={menuKeys}
                  data-item
                  aria-label={`Afficher ${name(k)}`}
                  data-testid={`plot-check-${k}`}
                >
                  <span className={s.box}>{!hidden.includes(k) && <Check size={12} strokeWidth={1.5} aria-hidden="true" />}</span>
                  <span className={s.letter}>{k}</span>
                  {renaming !== k && <span className={s.name}>{name(k)}</span>}
                </button>
                {renaming === k && (
                  <PlotName
                    name={name(k)}
                    onDone={(v) => {
                      setRenaming(null);
                      if (v !== null) renamePlot(k, v);
                    }}
                  />
                )}
                {!readOnly && renaming !== k && (
                  <button type="button" className={s.tool} aria-label={`Renommer ${name(k)}`} title="Renommer" onClick={() => setRenaming(k)} data-testid={`plot-rename-${k}`}>
                    <Pencil size={14} strokeWidth={1.25} />
                  </button>
                )}
                {removable ? (
                  <button type="button" className={s.tool} aria-label={`Supprimer ${name(k)}`} title="Supprimer" onClick={() => removePlot(k)} data-testid={`plot-delete-${k}`}>
                    <Trash2 size={14} strokeWidth={1.25} />
                  </button>
                ) : (
                  <span className={s.count} title={`${n} séquence${n > 1 ? 's' : ''}`}>
                    {n}
                  </span>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <>
              <hr className={p.sep} />
              <button
                type="button"
                className={p.item}
                data-item
                onKeyDown={menuKeys}
                disabled={keys.length >= 26}
                onClick={() => {
                  const k = addPlot();
                  if (k) setRenaming(k);
                }}
                data-testid="plot-new"
              >
                <Plus size={14} strokeWidth={1.25} aria-hidden="true" />
                Nouvelle intrigue
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

/** Outils du Séquencier (ligne 2 de la page) : Liste / Par intrigue (ordinateur seulement), puis Intrigues ▾. */
export function OutlineToolbar({ doc }: { doc: ProjectDoc }) {
  const mode = useOutlineUi((u) => u.mode);
  const phone = useIsMobile();
  return (
    <span className={s.bar} key={doc.project.id}>
      {!phone && <TextToggle label="Affichage du séquencier" items={MODES} value={mode} onChange={setOutlineMode} testId="outline-mode" />}
      <PlotsMenu doc={doc} />
    </span>
  );
}
