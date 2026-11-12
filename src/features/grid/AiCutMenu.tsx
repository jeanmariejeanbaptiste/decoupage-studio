import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { aiCutInstructions, applyCut, parseCutFile } from '../../domain/cutImport';
import type { ProjectDoc } from '../../domain/types';
import { pickFile } from '../../store/persistence';
import { mutateDoc, undo } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import s from './GridPage.module.css';

/**
 * Découpage fait ailleurs, mis au format par une IA externe : on copie les consignes (calculées sur les
 * colonnes du projet), l'IA rend un fichier .md, on l'importe ici.
 */
export function AiCutMenu({ doc }: { doc: ProjectDoc }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(aiCutInstructions(doc.project.settings.gridColumns));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      useUi.getState().toast({ message: 'Copie impossible dans ce navigateur.', tone: 'warn' });
    }
  };

  const importFile = async () => {
    setOpen(false);
    const f = await pickFile('.md,.markdown,.txt,text/markdown,text/plain', false);
    if (!f) return;
    try {
      const cut = parseCutFile(await f.text());
      let r = { sequences: 0, shots: 0, rejected: 0 };
      mutateDoc((d) => void (r = applyCut(d, cut)));
      useUi.getState().toast({
        message: `${r.sequences} séquence${r.sequences > 1 ? 's' : ''} et ${r.shots} plan${r.shots > 1 ? 's' : ''} ajoutés${r.rejected || cut.warnings.length ? ` (${r.rejected + cut.warnings.length} valeur${r.rejected + cut.warnings.length > 1 ? 's' : ''} ignorée${r.rejected + cut.warnings.length > 1 ? 's' : ''})` : ''}.`,
        actionLabel: 'Annuler',
        action: undo,
      });
    } catch (e) {
      useUi.getState().toast({ message: (e as Error).message, tone: 'warn' });
    }
  };

  return (
    <div className={s.menuWrap} ref={ref}>
      <Button variant="icon" icon={<Sparkles size={16} strokeWidth={1.25} />} aria-label="IA externe" title="Découpage par une IA externe" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="ai-cut" />
      {open && (
        <div className={s.menu} role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} data-testid="ai-cut-menu">
          <p className={s.menuTitle}>Découpage par une IA externe</p>
          <button type="button" role="menuitem" className={s.menuAction} onClick={() => void copy()} data-testid="ai-cut-copy">
            {copied ? 'Consignes copiées' : '1. Copier les consignes'}
          </button>
          <button type="button" role="menuitem" className={s.menuAction} onClick={() => void importFile()} data-testid="ai-cut-import">
            2. Importer sa réponse (.md)…
          </button>
        </div>
      )}
    </div>
  );
}
