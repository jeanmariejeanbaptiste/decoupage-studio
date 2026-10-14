import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { useDialog } from './dialogStore';
import s from './Modal.module.css';

/** Boîte de confirmation unique de l'application. */
export function DialogHost() {
  const current = useDialog((d) => d.current);
  const close = useDialog((d) => d.close);
  const [checked, setChecked] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<Element | null>(null);

  useEffect(() => {
    if (!current) return;
    previous.current = document.activeElement;
    setChecked(false);
    okRef.current?.focus();
    return () => {
      (previous.current as HTMLElement | null)?.focus?.();
    };
  }, [current]);

  if (!current) return null;
  return (
    <div className={s.backdrop} onMouseDown={() => close(false, false)}>
      <div
        className={s.modal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') close(false, false);
        }}
      >
        <h2 id="dlg-title" className={s.title}>{current.title}</h2>
        {current.body && <p className={s.body}>{current.body}</p>}
        {current.checkbox && (
          <label className={s.check}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {current.checkbox}
          </label>
        )}
        <div className={s.actions}>
          <Button variant="ghost" onClick={() => close(false, checked)}>{current.cancelLabel ?? 'Annuler'}</Button>
          <Button ref={okRef} variant={current.danger ? 'danger' : 'primary'} onClick={() => close(true, checked)}>
            {current.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
