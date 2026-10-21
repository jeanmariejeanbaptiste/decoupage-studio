import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { ExportTheme, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import s from './GridExportPanel.module.css';

export type GridExportFormat = 'pdf' | 'images' | 'excel';
type Orientation = 'landscape' | 'portrait';

const THEMES: Array<{ key: ExportTheme; label: string; swatch: string }> = [
  { key: 'mauve', label: 'Mauve', swatch: '#c98bb4' },
  { key: 'papier', label: 'Papier', swatch: '#fbf8f2' },
  { key: 'sobre', label: 'Sobre', swatch: '#ffffff' },
];

/** Menu d'export propre au découpage : format, orientation, thème, économie d'encre. */
export function GridExportPanel({ doc, disabled, onExport }: { doc: ProjectDoc; disabled?: boolean; onExport: (format: GridExportFormat, orientation: Orientation) => void }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<GridExportFormat>('pdf');
  const ref = useRef<HTMLDivElement>(null);
  const st = doc.project.settings;
  const orientation: Orientation = st.exportOrientation ?? 'landscape';
  const set = (patch: Partial<typeof st>) => mutateDoc((d) => void Object.assign(d.project.settings, patch));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const paged = format !== 'excel';

  return (
    <div className={s.wrap} ref={ref}>
      <Button variant="primary" icon={<Download size={15} strokeWidth={1.25} />} disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)} title="Exporter le découpage" data-testid="grid-export">
        Exporter
      </Button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Exporter le découpage" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} data-testid="grid-export-panel">
          <p className={s.title}>Exporter le découpage</p>
          <fieldset className={s.row}>
            <legend>Format</legend>
            {(
              [
                ['pdf', 'PDF'],
                ['images', 'Images A4'],
                ['excel', 'Excel'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={format === k ? s.on : ''}>
                <input type="radio" name="fmt" checked={format === k} onChange={() => setFormat(k)} />
                {label}
              </label>
            ))}
          </fieldset>
          {paged && (
            <>
              <fieldset className={s.row}>
                <legend>Orientation</legend>
                {(
                  [
                    ['landscape', 'Paysage'],
                    ['portrait', 'Portrait'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className={orientation === k ? s.on : ''}>
                    <input type="radio" name="ori" checked={orientation === k} onChange={() => set({ exportOrientation: k })} />
                    {label}
                  </label>
                ))}
              </fieldset>
              <fieldset className={s.row}>
                <legend>Thème</legend>
                {THEMES.map((t) => (
                  <label key={t.key} className={st.exportTheme === t.key ? s.on : ''}>
                    <input type="radio" name="theme" checked={st.exportTheme === t.key} onChange={() => set({ exportTheme: t.key })} />
                    <span className={s.swatch} style={{ background: t.swatch }} />
                    {t.label}
                  </label>
                ))}
              </fieldset>
              <label className={s.check}>
                <input type="checkbox" checked={!!st.exportInkSaver} onChange={(e) => set({ exportInkSaver: e.target.checked })} data-testid="grid-export-ink" />
                Économie d’encre (fond blanc, sans aplats de couleur)
              </label>
            </>
          )}
          <p className={s.hint}>
            {format === 'pdf'
              ? 'Ouvre l’aperçu d’impression : choisissez « Enregistrer en PDF ».'
              : format === 'images'
                ? 'Une image A4 exacte par page ; plusieurs pages arrivent dans un dossier compressé numéroté.'
                : 'Classeur avec fusions, couleurs et onglet Registre.'}
          </p>
          <Button
            variant="primary"
            onClick={() => {
              setOpen(false);
              onExport(format, orientation);
            }}
            data-testid="grid-export-go"
          >
            Exporter
          </Button>
        </div>
      )}
    </div>
  );
}
