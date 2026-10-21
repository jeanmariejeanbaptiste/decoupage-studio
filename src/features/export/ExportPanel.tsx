import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import type { ExportTheme, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import type { Orientation } from './imageExport';
import s from './ExportPanel.module.css';

const THEMES: Array<{ key: ExportTheme; label: string; swatch: string }> = [
  { key: 'mauve', label: 'Mauve', swatch: '#c98bb4' },
  { key: 'papier', label: 'Papier', swatch: '#fbf8f2' },
  { key: 'sobre', label: 'Sobre', swatch: '#ffffff' },
];

export interface ExportChoice {
  format: string;
  orientation: Orientation;
  numbers: boolean;
  perPage?: number;
}

interface Props {
  doc: ProjectDoc;
  /** Clé des réglages mémorisés et préfixe des testid. */
  id: string;
  title: string;
  defaultOrientation?: Orientation;
  /** Formats en plus de PDF et Images A4 (Excel, CSV, Word…). */
  extra?: Array<{ key: string; label: string; hint: string }>;
  themed?: boolean;
  /** Choix du nombre d'éléments par feuille (storyboard). */
  perPage?: number[];
  disabled?: boolean;
  onExport: (choice: ExportChoice) => void | Promise<void>;
  children?: ReactNode;
}

/** Menu d'export d'une page : PDF généré par l'outil ou images A4, orientation, numérotation, style. */
export function ExportPanel({ doc, id, title, defaultOrientation = 'landscape', extra = [], themed, perPage, disabled, onExport, children }: Props) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const [format, setFormat] = useState('pdf');
  const ref = useRef<HTMLDivElement>(null);
  const st = doc.project.settings;
  const prefs = st.exportPrefs?.[id] ?? {};
  const orientation = prefs.orientation ?? defaultOrientation;
  const numbers = prefs.numbers ?? true;
  const per = prefs.perPage ?? perPage?.[1] ?? perPage?.[0];
  const setPrefs = (patch: typeof prefs) =>
    mutateDoc((d) => {
      const all = (d.project.settings.exportPrefs ??= {});
      all[id] = { ...all[id], ...patch };
    });
  const set = (patch: Partial<typeof st>) => mutateDoc((d) => void Object.assign(d.project.settings, patch));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const paged = format === 'pdf' || format === 'images';
  const formats = [
    { key: 'pdf', label: 'PDF', hint: 'PDF A4 prêt à imprimer, assemblé page par page par l’outil (sans passer par l’impression du navigateur).' },
    { key: 'images', label: 'Images A4', hint: 'Une image A4 exacte par page ; plusieurs pages arrivent dans un dossier compressé numéroté.' },
    ...extra,
  ];

  const seg = <T extends string | number>(name: string, legend: string, items: ReadonlyArray<readonly [T, ReactNode]>, value: T | undefined, pick: (v: T) => void) => (
    <fieldset className={s.row}>
      <legend>{legend}</legend>
      {items.map(([k, label]) => (
        <label key={String(k)} className={value === k ? s.on : ''}>
          <input type="radio" name={`${id}-${name}`} checked={value === k} onChange={() => pick(k)} />
          {label}
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className={s.wrap} ref={ref}>
      <Button variant="primary" icon={<Download size={15} strokeWidth={1.25} />} disabled={disabled} aria-expanded={open} onClick={() => {
          // Le panneau s'ouvre du côté où il a la place.
          setAlignLeft((ref.current?.getBoundingClientRect().right ?? 1000) - 350 < (document.getElementById('contenu')?.getBoundingClientRect().left ?? 0));
          setOpen(!open);
        }} title={title} data-testid={`${id}-export`}>
        Exporter
      </Button>
      {open && (
        <div className={[s.panel, alignLeft ? s.left : ''].join(' ')} role="dialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} data-testid={`${id}-export-panel`}>
          <p className={s.title}>{title}</p>
          {seg('fmt', 'Format', formats.map((f) => [f.key, f.label] as const), format, setFormat)}
          {paged && (
            <>
              {seg('ori', 'Format A4', [['landscape', 'Paysage'], ['portrait', 'Portrait']] as const, orientation, (o) => setPrefs({ orientation: o }))}
              {perPage && seg('per', 'Par feuille', perPage.map((n) => [n, String(n)] as const), per, (n) => setPrefs({ perPage: n }))}
              {themed && seg('theme', 'Thème', THEMES.map((t) => [t.key, <><span className={s.swatch} style={{ background: t.swatch }} />{t.label}</>] as const), st.exportTheme, (t) => set({ exportTheme: t }))}
              {themed && (
                <label className={s.check}>
                  <input type="checkbox" checked={!!st.exportInkSaver} onChange={(e) => set({ exportInkSaver: e.target.checked })} />
                  Économie d’encre (fond blanc, sans aplats)
                </label>
              )}
              <label className={s.check}>
                <input type="checkbox" checked={numbers} onChange={(e) => setPrefs({ numbers: e.target.checked })} data-testid={`${id}-export-numbers`} />
                Numéroter les pages (en bas à droite)
              </label>
              {children}
            </>
          )}
          <p className={s.hint}>{formats.find((f) => f.key === format)?.hint}</p>
          <Button
            variant="primary"
            onClick={() => {
              setOpen(false);
              void onExport({ format, orientation, numbers, perPage: per });
            }}
            data-testid={`${id}-export-go`}
          >
            Exporter
          </Button>
        </div>
      )}
    </div>
  );
}
