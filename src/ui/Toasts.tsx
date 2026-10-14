import { X } from 'lucide-react';
import { useUi } from '../store/uiStore';
import s from './Toasts.module.css';

export function Toasts() {
  const toasts = useUi((u) => u.toasts);
  const dismiss = useUi((u) => u.dismissToast);
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={[s.toast, t.tone === 'warn' ? s.warn : ''].join(' ')} data-testid="toast">
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className={s.action}
              onClick={() => {
                t.action?.();
                dismiss(t.id);
              }}
            >
              {t.actionLabel ?? 'OK'}
            </button>
          )}
          <button type="button" className={s.close} aria-label="Fermer" onClick={() => dismiss(t.id)}>
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
