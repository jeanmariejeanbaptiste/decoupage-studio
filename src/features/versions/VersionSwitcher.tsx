import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, MessageSquare, Pencil, Plus, X } from 'lucide-react';
import { commentsOf, shownComments } from '../../domain/comments';
import { openCommentsPanel } from '../comments/commentsUi';
import { activeVersion, compareVersions, createVersion, deleteVersion, ensureVersions, nextVersionName, renameVersion, switchVersion, versionScenes } from '../../domain/versions';
import type { ProjectDoc } from '../../domain/types';
import { flushEditors } from '../../store/persistence';
import { mutateDoc } from '../../store/projectStore';
import { useReadOnly } from '../../store/share';
import { ask } from '../../ui/dialogStore';
import s from './VersionSwitcher.module.css';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/**
 * Versions du film, communes au scénario et au découpage : on passe de l'une à l'autre, on en crée une
 * (copie de la courante : tout ce qui y reste garde sa préparation). Les autres pages suivent la courante.
 */
export function VersionSwitcher({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const list = doc.versions?.length ? doc.versions : [{ id: '', name: doc.project.version || 'V1', createdAt: doc.project.createdAt }];
  const current = (doc.versions?.length ? activeVersion(doc) : list[0]) ?? list[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Invité : la version partagée s'affiche, sans menu.
  if (readOnly) return <span className={s.trigger} data-testid="version-switcher">{current.name}</span>;

  const go = (id: string) => {
    flushEditors();
    mutateDoc((d) => switchVersion(d, id));
    setOpen(false);
  };

  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={s.trigger} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Version du scénario et du découpage" data-testid="version-switcher">
        {current.name}
        <ChevronDown size={13} strokeWidth={1.4} aria-hidden="true" />
      </button>
      {open && (
        <div className={s.menu} role="menu" aria-label="Versions">
          <ul>
            {list.map((v) => {
              const on = v.id === current.id;
              const diff = !on && v.id ? compareVersions(doc, v.id) : null;
              return (
                <li key={v.id || 'v'} className={on ? s.on : ''} data-testid="version-item">
                  {editing === v.id ? (
                    <input
                      autoFocus
                      defaultValue={v.name}
                      aria-label="Nom de la version"
                      onBlur={(e) => {
                        const name = e.target.value;
                        setEditing(null);
                        mutateDoc((d) => {
                          ensureVersions(d);
                          renameVersion(d, v.id || d.activeVersionId!, name);
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <button type="button" className={s.pick} role="menuitemradio" aria-checked={on} onClick={() => !on && go(v.id)}>
                      <span className={s.check}>{on && <Check size={13} strokeWidth={1.6} />}</span>
                      <b>{v.name}</b>
                      <span className={s.meta}>
                        {dateFmt.format(new Date(v.createdAt))} · {versionScenes(doc, v)} séq.
                        {diff && (diff.added.length || diff.removed.length || diff.changed.length) ? (
                          <em title={`Par rapport à ${current.name} : ${diff.removed.length} séquence(s) en plus, ${diff.added.length} en moins, ${diff.changed.length} différente(s)`}>
                            {[diff.removed.length ? `+${diff.removed.length}` : '', diff.added.length ? `−${diff.added.length}` : '', diff.changed.length ? `${diff.changed.length} modif.` : ''].filter(Boolean).join(' · ').replace(/^/, ' · ')}
                          </em>
                        ) : null}
                      </span>
                    </button>
                  )}
                  {(() => {
                    // Commentaires de la version : un compteur discret, seulement s'il y en a.
                    // Version courante : les commentaires repris des précédentes comptent aussi.
                    const own = doc.comments?.length ? commentsOf(doc, v.id || undefined) : [];
                    const carried = on && doc.comments?.length ? shownComments(doc).filter((x) => x.from).map((x) => x.c) : [];
                    const n = [...own, ...carried].filter((c) => !c.resolved).length;
                    const total = own.length + carried.length;
                    return total > 0 && !readOnly ? (
                      <button
                        type="button"
                        className={s.notes}
                        onClick={() => {
                          setOpen(false);
                          openCommentsPanel(v.id);
                        }}
                        aria-label={`Commentaires de ${v.name}`}
                        title={`${n} à traiter, ${total} en tout`}
                        data-testid="version-comments"
                      >
                        <MessageSquare size={12} strokeWidth={1.4} />
                        {n || ''}
                      </button>
                    ) : null;
                  })()}
                  {!readOnly && editing !== v.id && (
                    <span className={s.acts}>
                      <button type="button" aria-label={`Renommer ${v.name}`} onClick={() => setEditing(v.id)}>
                        <Pencil size={12} strokeWidth={1.4} />
                      </button>
                      {!on && (
                        <button
                          type="button"
                          aria-label={`Supprimer ${v.name}`}
                          onClick={async () => {
                            const r = await ask({ title: `Supprimer la version ${v.name} ?`, body: 'Son scénario et son découpage disparaissent ; les autres versions et la préparation restent (annulable avec ⌘Z).', confirmLabel: 'Supprimer', danger: true });
                            if (r.ok) mutateDoc((d) => deleteVersion(d, v.id));
                          }}
                        >
                          <X size={12} strokeWidth={1.4} />
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {!readOnly && (
            <button
              type="button"
              className={s.add}
              onClick={() => {
                flushEditors();
                mutateDoc((d) => void createVersion(d));
                setOpen(false);
              }}
              data-testid="version-new"
            >
              <Plus size={13} strokeWidth={1.5} /> Nouvelle version ({nextVersionName(list.map((v) => v.name))})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
