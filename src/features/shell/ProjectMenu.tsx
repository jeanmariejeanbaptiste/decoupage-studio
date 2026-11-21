import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, Home, Moon, Save, Sun } from 'lucide-react';
import { applyFormat } from '../../domain/factory';
import type { ProjectDoc, ProjectFormat } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { openFromFile, saveToFile } from '../../store/persistence';
import { navigate } from '../../app/router';
import { useCanCopy } from '../../store/share';
import { useUi } from '../../store/uiStore';
import { switchTheme } from '../../ui/themeSwitch';
import { useDraft } from '../../ui/useDraft';
import s from './ProjectMenu.module.css';

const FORMATS: ReadonlyArray<[ProjectFormat, string]> = [
  ['fiction', 'Fiction'],
  ['clip', 'Clip'],
  ['institutionnel', 'Institutionnel'],
];

function Field({ label, value, placeholder, required, onCommit }: { label: string; value: string; placeholder?: string; required?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft, rawFlush] = useDraft(value, onCommit);
  // Champ obligatoire vidé : on revient à la valeur du projet plutôt que d'afficher un champ vide.
  const flush = () => {
    if (required && !draft.trim()) setDraft(value);
    rawFlush();
  };
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            flush();
          }
        }}
      />
    </label>
  );
}

/** Le projet en tête de l'écran : son titre, et au clic ses informations (titre, version, équipe, format). */
export function ProjectMenu({ doc, readOnly }: { doc: ProjectDoc; readOnly?: boolean }) {
  const p = doc.project;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const theme = useUi((u) => u.theme);
  const canCopy = useCanCopy();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const label = (
    <>
      <span className={s.title}>{p.title || 'Sans titre'}</span>
    </>
  );
  if (readOnly) return <div className={s.static}>{label}</div>;

  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={s.trigger} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} title="Informations du projet" data-testid="project-menu">
        {label}
        <ChevronDown size={14} strokeWidth={1.4} aria-hidden="true" />
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Projet" data-testid="project-panel">
          <Field label="Titre" value={p.title} required onCommit={(v) => v.trim() && v.trim() !== p.title && mutateDoc((d) => void (d.project.title = v.trim()))} />
          <div className={s.field}>
            <span>Format</span>
            <div className={s.seg} role="radiogroup" aria-label="Format">
              {FORMATS.map(([v, l]) => (
                <label key={v} className={p.format === v ? s.on : ''}>
                  <input type="radio" name="project-format" checked={p.format === v} onChange={() => mutateDoc((d) => applyFormat(d, v))} />
                  {l}
                </label>
              ))}
            </div>
          </div>
          <Field label="Réalisation" value={p.director ?? ''} onCommit={(v) => mutateDoc((d) => void (d.project.director = v.trim() || undefined))} />
          <Field label="Image" value={p.dop ?? ''} placeholder="Directeur ou directrice de la photographie" onCommit={(v) => mutateDoc((d) => void (d.project.dop = v.trim() || undefined))} />
          <div className={s.foot}>
            <button
              type="button"
              className={s.link}
              onClick={() => {
                setOpen(false);
                void openFromFile();
              }}
            >
              <FolderOpen size={14} strokeWidth={1.3} aria-hidden="true" /> Ouvrir un fichier .decoupage…
            </button>
          </div>
          {/* Téléphone : ce que la barre du haut n'a plus la place de montrer. */}
          <div className={[s.foot, s.phoneOnly].join(' ')} data-testid="project-panel-phone">
            <button type="button" className={s.link} onClick={() => navigate('home')}>
              <Home size={14} strokeWidth={1.3} aria-hidden="true" /> Tous les projets
            </button>
            <button type="button" className={s.link} onClick={(e) => switchTheme(e)}>
              {theme === 'encre' ? <Sun size={14} strokeWidth={1.3} aria-hidden="true" /> : <Moon size={14} strokeWidth={1.3} aria-hidden="true" />}
              {theme === 'encre' ? 'Thème papier' : 'Thème encre'}
            </button>
            {canCopy && (
              <button
                type="button"
                className={s.link}
                onClick={() => {
                  setOpen(false);
                  void saveToFile();
                }}
              >
                <Save size={14} strokeWidth={1.3} aria-hidden="true" /> Enregistrer le fichier
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
