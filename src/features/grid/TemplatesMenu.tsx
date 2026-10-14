import { useEffect, useRef, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { templatesFor, applyTemplate } from '../../domain/templates';
import type { ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore, undo } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { currentShotId, rowOfShot } from './actions';
import s from './GridPage.module.css';

/** Insertion d'un modèle de séquence après la séquence courante (§14 P12). */
export function TemplatesMenu({ doc, variant = 'ghost' }: { doc: ProjectDoc; variant?: 'ghost' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const insert = (key: string, label: string) => {
    setOpen(false);
    const cur = currentShotId();
    const seqId = cur ? doc.shots[cur]?.sequenceId : undefined;
    const index = seqId ? doc.project.sequenceIds.indexOf(seqId) + 1 : undefined;
    const newSeq = mutateDoc((d) => applyTemplate(d, key, index));
    const after = useProjectStore.getState().doc;
    const first = newSeq && after ? after.sequences[newSeq]?.shotIds[0] : undefined;
    if (after && first) useUi.getState().setSelection({ row: rowOfShot(after, first), col: 'subject' });
    useUi.getState().toast({ message: `Modèle « ${label} » inséré.`, actionLabel: 'Annuler', action: undo });
  };

  return (
    <div className={s.menuWrap} ref={ref}>
      <Button variant={variant} icon={<LayoutTemplate size={15} strokeWidth={1.25} />} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="templates">
        Modèle
      </Button>
      {open && (
        <div className={[s.menu, s.wide].join(' ')} role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className={s.menuTitle}>Insérer un modèle de séquence</p>
          {templatesFor(doc.project.format).map((t) => (
            <button key={t.key} type="button" role="menuitem" className={s.tplItem} onClick={() => insert(t.key, t.label)}>
              <strong>
                {t.label}
                {t.formats.includes(doc.project.format) && <em>suggéré</em>}
              </strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
