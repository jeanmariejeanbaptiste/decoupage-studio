import { useLayoutEffect, useMemo, useRef } from 'react';
import { blocksFromSource } from '../../../domain/screenplay';
import { scriptOutline } from '../../../domain/scriptLayout';
import type { ProjectDoc } from '../../../domain/types';
import { mutateDoc } from '../../../store/projectStore';
import { useReadOnly } from '../../../store/share';
import { useCommitDraft } from '../ResearchPanels';
import s from './OutlineView.module.css';

type Research = NonNullable<ProjectDoc['research']>;

/** Champ du film (logline, synopsis) : sans cadre, hauteur à la mesure du texte, validé en quittant le champ. */
function FilmField({ field, label, className, value, readOnly }: { field: 'logline' | 'synopsis'; label: string; className: string; value: string; readOnly: boolean }) {
  const [draft, setDraft, commit] = useCommitDraft(value, (v) => mutateDoc((d) => void Object.assign((d.research ??= {}) as Research, { [field]: v.trim() || undefined })), readOnly);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={draft}
      readOnly={readOnly}
      placeholder={readOnly ? '' : label}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      data-testid={`outline-${field}`}
    />
  );
}

/**
 * Séquencier (contenu provisoire) : la logline et le synopsis du film, puis la liste des séquences du
 * texte, en lecture. Chaque ligne porte `data-outline-n` : la page s'en sert pour `?seq=N`.
 */
export function OutlineView({ doc }: { doc: ProjectDoc }) {
  const readOnly = useReadOnly();
  const items = useMemo(() => scriptOutline(blocksFromSource(doc.scenario ?? '').blocks).items, [doc.scenario]);
  const r = doc.research ?? {};
  return (
    <div className={s.view} data-testid="outline-view">
      <header className={s.film}>
        <FilmField field="logline" label="Logline" className={s.logline} value={r.logline ?? ''} readOnly={readOnly} />
        <FilmField field="synopsis" label="Synopsis" className={s.synopsis} value={r.synopsis ?? ''} readOnly={readOnly} />
      </header>
      {items.length > 0 && (
        <ol className={s.list} aria-label="Séquences">
          {items.map((o) => (
            <li key={o.id} className={s.row} data-outline-n={o.n}>
              <span className={s.n}>{o.n}</span>
              <span className={s.heading}>{o.text || 'Sans titre'}</span>
              <span className={s.page}>p. {o.page}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
