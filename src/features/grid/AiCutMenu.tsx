import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { aiCutInstructions, applyCut, parseCutFile } from '../../domain/cutImport';
import type { ProjectDoc } from '../../domain/types';
import { pickFile } from '../../store/persistence';
import { mutateDoc, undo } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
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
    if (f) await apply(await f.text());
  };

  /** Réponse copiée depuis la conversation (bouton « Copier » du bloc de code) : collée d'un clic. */
  const paste = async () => {
    setOpen(false);
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      useUi.getState().toast({ message: 'Le navigateur refuse la lecture du presse-papiers : importez le fichier .md.', tone: 'warn' });
      return;
    }
    await apply(text);
  };

  const apply = async (text: string) => {
    try {
      const cut = parseCutFile(text);
      // Réponse non conforme aux consignes : chaque écart est montré, ligne par ligne, avant l'import.
      if (cut.warnings.length) {
        const n = cut.warnings.length;
        const shown = cut.warnings.slice(0, 8).join('\n') + (n > 8 ? `\n… et ${n - 8} autre${n - 8 > 1 ? 's' : ''}.` : '');
        const r = await ask({ title: `${n} écart${n > 1 ? 's' : ''} aux consignes`, body: shown, confirmLabel: 'Importer quand même' });
        if (!r.ok) return;
      }
      let r = { sequences: 0, merged: 0, shots: 0, rejected: 0 };
      mutateDoc((d) => void (r = applyCut(d, cut)));
      const pl = (k: number, w: string) => `${k} ${w}${k > 1 ? 's' : ''}`;
      const parts = [r.sequences ? `${pl(r.sequences, 'séquence')} ${r.sequences > 1 ? 'nouvelles' : 'nouvelle'}` : '', r.merged ? `${pl(r.merged, 'séquence')} ${r.merged > 1 ? 'complétées' : 'complétée'}` : ''].filter(Boolean);
      useUi.getState().toast({
        message: `${pl(r.shots, 'plan')} ${r.shots > 1 ? 'ajoutés' : 'ajouté'}${parts.length ? ` (${parts.join(', ')})` : ''}${r.rejected ? ` ; ${pl(r.rejected, 'valeur')} illisible${r.rejected > 1 ? 's' : ''} laissée${r.rejected > 1 ? 's' : ''} vide${r.rejected > 1 ? 's' : ''}` : ''}.`,
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
          <button type="button" role="menuitem" className={s.menuAction} onClick={() => void paste()} data-testid="ai-cut-paste">
            2. Coller sa réponse
          </button>
          <button type="button" role="menuitem" className={s.menuAction} onClick={() => void importFile()} data-testid="ai-cut-import">
            ou importer son fichier .md…
          </button>
        </div>
      )}
    </div>
  );
}
