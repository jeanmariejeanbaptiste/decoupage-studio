import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { scriptToFdx } from '../../domain/fdx';
import { blocksFromSource, parseTitlePage } from '../../domain/screenplay';
import type { ProjectDoc } from '../../domain/types';
import { downloadBlob, flushEditors } from '../../store/persistence';
import { useUi } from '../../store/uiStore';
import { recoverStaleChunk } from '../../ui/staleChunk';
import { finish } from '../export/imageExport';
import s from './ScriptExportButton.module.css';

/** Une entrée du menu Exporter : un clic, un fichier, sans boîte de dialogue. */
export interface ExportItem {
  key: string;
  label: string;
  run: () => void | Promise<void>;
}
/**
 * Une section du menu Exporter. Ordre fixe, quelle que soit la sous-page : Scénario, Séquencier,
 * Statistiques ; une section sans objet (Statistiques hors de sa sous-page) n'est pas passée.
 */
export interface ExportSection {
  id: 'script' | 'outline' | 'stats';
  label: string;
  items: readonly ExportItem[];
}
const ORDER: readonly ExportSection['id'][] = ['script', 'outline', 'stats'];

/** Section « Scénario » : toujours A4 portrait, au gabarit du modèle (Courier Prime 12 pt). */
export function scriptExportSection(current: () => ProjectDoc, title: string): ExportSection {
  const source = () => current().scenario ?? '';
  const meta = () => {
    const tb = blocksFromSource(source()).blocks.find((b) => b.type === 'title');
    const tp = parseTitlePage(tb?.text ?? '');
    return { title: current().project.title || tp.Title || 'Scénario', author: tp.Author };
  };
  const lib = () => import('./scriptExport');
  return {
    id: 'script',
    label: 'Scénario',
    items: [
      { key: 'pdf', label: 'PDF', run: async () => downloadBlob(await (await lib()).scriptPdf(source(), meta()), `${title}.pdf`) },
      { key: 'word', label: 'Word', run: async () => downloadBlob(await (await lib()).scriptDocx(source(), meta()), `${title}.docx`) },
      {
        key: 'fdx',
        label: 'Final Draft',
        run: () => downloadBlob(new Blob([scriptToFdx(blocksFromSource(source()).blocks)], { type: 'application/xml;charset=utf-8' }), `${title}.fdx`),
      },
      { key: 'fountain', label: 'Fountain', run: () => downloadBlob(new Blob([source()], { type: 'text/plain;charset=utf-8' }), `${title}.fountain`) },
      {
        key: 'images',
        label: 'Images',
        run: async () => finish(await (await lib()).scriptCanvases(source()), `${title}-A4`, { format: 'images', orientation: 'portrait', numbers: false }),
      },
    ],
  };
}

/** « Exporter ▾ » : le seul bouton plein de la page, collé au bord droit ; un menu à sections fixes. */
export function ExportMenu({ sections }: { sections: readonly ExportSection[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Échap : le menu se ferme et le focus revient au bouton.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const shown = ORDER.map((id) => sections.find((x) => x.id === id)).filter((x): x is ExportSection => !!x && x.items.length > 0);
  const run = async (item: ExportItem) => {
    setOpen(false);
    // Saisie en attente appliquée d'abord ; une erreur s'affiche au lieu de disparaître.
    flushEditors();
    setBusy(true);
    try {
      await item.run();
    } catch (err) {
      if (!recoverStaleChunk(err)) useUi.getState().toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };
  // Flèches dans le menu : d'une entrée à l'autre, toutes sections confondues.
  const onKey = (e: React.KeyboardEvent) => {
    // Tab : on quitte le menu, qui se ferme ; le focus suit son cours depuis le bouton.
    if (e.key === 'Tab') {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div className={s.wrap} ref={ref} data-view>
      <button
        ref={trigger}
        type="button"
        className={s.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(!open)}
        data-testid="scenario-export"
      >
        {busy ? 'Export…' : 'Exporter'}
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div className={s.menu} role="menu" aria-label="Exporter" ref={menu} onKeyDown={onKey} data-testid="scenario-export-menu">
          {shown.map((sec) => (
            <div key={sec.id} role="group" aria-labelledby={`export-${sec.id}`} className={s.section}>
              <p id={`export-${sec.id}`} className={s.label}>
                {sec.label}
              </p>
              {sec.items.map((it) => (
                <button key={it.key} type="button" role="menuitem" className={s.item} onClick={() => void run(it)} data-testid={`export-${sec.id}-${it.key}`}>
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
