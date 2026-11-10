import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Eraser, GitCompare, MessageSquare, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { scenesOf } from '../../domain/fountain';
import { useUi } from '../../store/uiStore';
import { commentsOf, shownComments } from '../../domain/comments';
import { openCommentsPanel } from '../comments/commentsUi';
import { activeVersion, clearScenario, comparableVersions, clearedOf, restoreScenario, createVersion, deleteVersion, ensureVersions, isPublishedVersion, nextVersionName, renameVersion, switchVersion, versionHeir, versionSequences } from '../../domain/versions';
import type { ProjectDoc } from '../../domain/types';
import { flushEditors } from '../../store/persistence';
import { mutateDoc, undo } from '../../store/projectStore';
import { useDriveReview, useReadOnly } from '../../store/share';
import { ask } from '../../ui/dialogStore';
import { openCompare } from './compareUi';
import s from './VersionSwitcher.module.css';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/**
 * Versions du film, communes au scénario et au découpage : on passe de l'une à l'autre, on en crée une
 * (copie de la courante : tout ce qui y reste garde sa préparation). Les autres pages suivent la courante.
 */
export function VersionSwitcher({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const drive = useDriveReview();
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

  // Comparer : deux versions au moins (invités et relecteurs compris, parmi les versions publiées : on consulte, rien ne change).
  const comparable = comparableVersions(doc, readOnly).length > 1;
  const compareIcon = comparable ? (
    <button type="button" className={s.compare} onClick={() => openCompare(doc, readOnly)} aria-label="Comparer les versions" title="Comparer les versions" data-view data-testid="version-compare">
      <GitCompare size={14} strokeWidth={1.4} aria-hidden="true" />
    </button>
  ) : null;
  // Relecture en ligne : la version publiée, qui ouvre la liste de ses commentaires (sans les commandes de version).
  if (drive) {
    const all = doc.comments?.length ? shownComments(doc) : [];
    const n = all.filter((x) => !x.c.resolved).length;
    return (
      <span className={s.wrap}>
        <button
          type="button"
          className={s.trigger}
          onClick={() => openCommentsPanel(current.id)}
          // Lecture seule : un bouton qui sert à regarder reste visible.
          data-view
          aria-label={`Commentaires de ${current.name}`}
          title={all.length ? `${n} à traiter, ${all.length} en tout` : 'Commentaires'}
          data-testid="version-switcher"
        >
          <span data-testid="version-name">{current.name}</span>
          <MessageSquare size={12} strokeWidth={1.4} aria-hidden="true" />
          {n > 0 && <span className={s.count}>{n}</span>}
        </button>
        {compareIcon}
      </span>
    );
  }
  // Invité : la version partagée s'affiche, sans menu (un simple libellé, pas un bouton).
  if (readOnly)
    return (
      <span className={s.wrap}>
        <span className={s.label} data-testid="version-switcher">
          {current.name}
        </span>
        {compareIcon}
      </span>
    );

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
        // Le menu s'ouvre vers la droite quand il manquerait de place à gauche (barre étroite, bouton à gauche).
        <div className={s.menu} role="menu" aria-label="Versions" style={(ref.current?.getBoundingClientRect().right ?? 1000) < 340 + 240 ? { left: 0, right: 'auto' } : undefined}>
          <ul>
            {list.map((v) => {
              const on = v.id === current.id;
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
                        {dateFmt.format(new Date(v.createdAt))} · {versionSequences(doc, v)} séq.
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
                      {/* Toujours rendu (caché pour la courante) : les colonnes restent fixes d'une ligne à l'autre. */}
                      <button
                        type="button"
                        aria-label={on ? undefined : `Supprimer ${v.name}`}
                        aria-hidden={on || undefined}
                        disabled={on || isPublishedVersion(doc, v.id)}
                        title={!on && isPublishedVersion(doc, v.id) ? 'Publiée pour la relecture' : undefined}
                        tabIndex={on ? -1 : undefined}
                        className={on ? s.placeholder : undefined}
                        onClick={async () => {
                          const n = (doc.comments ?? []).filter((c) => c.versionId === v.id).length;
                          const heir = list.find((x) => x.id === versionHeir(doc, v.id))?.name;
                          const notes = n && heir ? ` ${n > 1 ? `Ses ${n} commentaires passent` : 'Son commentaire passe'} à ${heir}.` : '';
                          const r = await ask({ title: `Supprimer la version ${v.name} ?`, body: `Son scénario et son découpage disparaissent ; les autres versions et la préparation restent (annulable avec ⌘Z).${notes}`, confirmLabel: 'Supprimer', danger: true });
                          if (r.ok) mutateDoc((d) => deleteVersion(d, v.id));
                        }}
                      >
                        <X size={12} strokeWidth={1.4} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {comparable && (
            <button
              type="button"
              className={s.add}
              onClick={() => {
                setOpen(false);
                openCompare(doc, readOnly);
              }}
              data-testid="version-compare"
            >
              <GitCompare size={13} strokeWidth={1.5} /> Comparer les versions…
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              className={[s.add, comparable ? s.flat : ''].join(' ')}
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
          {!readOnly && <ClearScenario doc={doc} name={current.name} onDone={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}

/**
 * Effacer le texte du scénario (cette version ou toutes), avec un garde-fou qui ne gêne pas : une
 * seule confirmation qui dit ce qui part et ce qui reste ; le texte est mis de côté et se rétablit
 * ici même, ou par ⌘Z.
 */
function ClearScenario({ doc, name, onDone }: { doc: ProjectDoc; name: string; onDone: () => void }) {
  const cleared = clearedOf(doc);
  if (cleared)
    return (
      <button
        type="button"
        className={s.add}
        onClick={() => {
          mutateDoc((d) => void restoreScenario(d));
          onDone();
        }}
        data-testid="scenario-restore"
      >
        <RotateCcw size={13} strokeWidth={1.5} /> Rétablir le scénario effacé
      </button>
    );
  const here = (doc.scenario ?? '').trim();
  const others = (doc.versions ?? []).filter((v) => v.slice?.scenario?.trim()).length;
  if (!here && !others) return null;
  return (
    <button
      type="button"
      className={[s.add, s.quiet].join(' ')}
      onClick={async () => {
        onDone();
        flushEditors();
        const n = scenesOf(doc.scenario ?? '').length;
        const r = await ask({
          title: here ? `Effacer le scénario de ${name} ?` : 'Effacer le scénario des autres versions ?',
          body: `${here ? `${n} séquence${n > 1 ? 's' : ''} dans ${name}. ` : ''}Le découpage, ses plans et la préparation restent. Le texte est mis de côté : « Rétablir le scénario effacé », dans ce menu.`,
          confirmLabel: here ? `Effacer ${name}` : 'Effacer',
          altLabel: here && others ? 'Toutes les versions' : undefined,
          danger: true,
        });
        if (!r.ok && !r.alt) return;
        const scope = r.alt || !here ? 'all' : 'current';
        mutateDoc((d) => clearScenario(d, scope));
        useUi.getState().toast({ message: scope === 'all' ? 'Scénario effacé dans toutes les versions.' : `Scénario de ${name} effacé.`, actionLabel: 'Annuler', action: undo });
      }}
      data-testid="scenario-clear"
    >
      <Eraser size={13} strokeWidth={1.5} /> Effacer le scénario…
    </button>
  );
}
