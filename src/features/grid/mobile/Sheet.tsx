import { useEffect, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import s from './Sheet.module.css';

export { s as sheetStyles };

/**
 * Feuille du bas : le voile, la poignée, le nom du champ et ✓. Toucher le voile, ✓ ou Échap la
 * referme en validant (une seule annulation pour tout ce qui a été changé dans la feuille).
 */
export function Sheet({ label, onDone, tall, children, testId }: { label: string; onDone: () => void; tall?: boolean; children: ReactNode; testId?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onDone]);
  useKeyboardInset();
  return (
    <>
      <div className={s.scrim} onClick={onDone} aria-hidden="true" />
      <div className={[s.panel, tall ? s.tall : ''].join(' ')} role="dialog" aria-modal="true" aria-label={label} data-sheet data-testid={testId}>
        <div className={s.grip} aria-hidden="true" />
        <div className={s.head}>
          <h2>{label}</h2>
          <button type="button" className={s.done} onClick={onDone} aria-label="Valider" data-testid="sheet-done">
            <Check size={22} strokeWidth={1.4} />
          </button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </>
  );
}

/** Clavier à l'écran (Safari) : la feuille remonte au-dessus de lui. */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const on = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb', `${Math.round(inset)}px`);
    };
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
      root.style.removeProperty('--kb');
    };
  }, []);
}
