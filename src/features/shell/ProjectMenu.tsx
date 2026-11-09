import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import { applyFormat } from '../../domain/factory';
import type { ProjectDoc, ProjectFormat } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { openFromFile } from '../../store/persistence';
import { useDraft } from '../../ui/useDraft';
import s from './ProjectMenu.module.css';

const FORMATS: ReadonlyArray<[ProjectFormat, string]> = [
  ['fiction', 'Fiction'],
  ['clip', 'Clip'],
  ['institutionnel', 'Institutionnel'],
];

function Field({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft, flush] = useDraft(value, onCommit);
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
          <Field label="Titre" value={p.title} onCommit={(v) => v.trim() && mutateDoc((d) => void (d.project.title = v.trim()))} />
          <div className={s.pair}>
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
        </div>
      )}
    </div>
  );
}
