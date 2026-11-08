import { useEffect } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { navigate, useLocation } from '../../app/router';
import type { ExportTheme, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { ExportTable } from './ExportTable';
import s from './PrintPage.module.css';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function cssString(s: string) {
  return `"${s.replace(/["\\]/g, '\\$&')}"`;
}

/** Vue d'impression dédiée (§8.3) : `window.print()` produit le PDF. */
export function PrintPage({ doc }: { doc: ProjectDoc }) {
  const { params } = useLocation();
  const settings = doc.project.settings;
  const theme: ExportTheme = 'sobre';
  const paper = settings.exportPaper;
  const footer = settings.exportFooter;
  const footerText = `${doc.project.title} · ${doc.project.version} · ${dateFmt.format(new Date())}`;

  useEffect(() => {
    document.documentElement.dataset.print = settings.exportInkSaver ? 'eco' : theme;
    return () => {
      delete document.documentElement.dataset.print;
    };
  }, [theme, settings.exportInkSaver]);

  const auto = params.get('auto') === '1';
  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    // Attend que la pagination soit calculée avant d'ouvrir l'impression ; une seule fois : l'adresse
    // perd « auto=1 » (revenir en arrière ou changer un réglage ne relance pas l'impression).
    const start = Date.now();
    const wait = () => {
      if (cancelled) return;
      if (document.querySelector('[data-testid="print-page"]') || Date.now() - start > 4000) {
        const q = new URLSearchParams(params);
        q.delete('auto');
        const rest = q.toString();
        window.history.replaceState(null, '', `#/print${rest ? `?${rest}` : ''}`);
        window.print();
      } else requestAnimationFrame(wait);
    };
    void document.fonts.ready.then(wait);
    return () => {
      cancelled = true;
    };
  }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageBg = '#ffffff';
  const orientation = settings.exportOrientation ?? 'landscape';
  const pageCss = `@page { size: ${paper} ${orientation}; margin: 0 0 ${footer ? '10mm' : '0'} 0; background: ${pageBg};${
    footer
      ? ` @bottom-center { content: ${cssString(footerText + ' · page ')} counter(page) " / " counter(pages); font-family: 'Inter Variable', sans-serif; font-weight: 600; font-size: 8pt; color: #000; }`
      : ''
  } }`;

  return (
    <div className={s.root} data-theme-export={theme}>
      <style>{pageCss}</style>
      <div className={[s.bar, 'no-print'].join(' ')}>
        <Button icon={<ArrowLeft size={15} strokeWidth={1.25} />} onClick={() => navigate('export')}>
          Retour
        </Button>
        <div className={s.group} role="radiogroup" aria-label="Format de page">
          {(['A4', 'A3'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={paper === p}
              className={[s.seg, paper === p ? s.on : ''].join(' ')}
              onClick={() =>
                mutateDoc((d) => {
                  d.project.settings.exportPaper = p;
                })
              }
            >
              {p}
            </button>
          ))}
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={footer}
            onChange={(e) =>
              mutateDoc((d) => {
                d.project.settings.exportFooter = e.target.checked;
              })
            }
          />
          Pied de page
        </label>
        <Button variant="primary" icon={<Printer size={15} strokeWidth={1.25} />} onClick={() => window.print()} data-testid="print-now">
          Imprimer / PDF
        </Button>
      </div>
      <div
        className={[s.paper, s[`paper_${paper}`]].join(' ')}
        style={orientation === 'portrait' ? { width: paper === 'A4' ? '210mm' : '297mm', minHeight: paper === 'A4' ? '297mm' : '420mm' } : undefined}
        data-testid="print-sheet"
      >
        <ExportTable doc={doc} theme={theme} paper={paper} footer={footer} orientation={orientation} />
      </div>
      {footer && <p className={[s.screenFooter, 'no-print'].join(' ')}>{footerText} · page 1 / n</p>}
    </div>
  );
}
