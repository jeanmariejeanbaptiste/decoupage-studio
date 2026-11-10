import s from './TextToggle.module.css';

/**
 * Bascule en mots (vues, rapports) de la ligne d'outils : l'actif en encre, souligné ; les autres en gris.
 * ← / → passent d'un choix à l'autre.
 */
export function TextToggle<T extends string>({
  label,
  items,
  value,
  onChange,
  testId,
}: {
  label: string;
  items: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (v: T) => void;
  /** Préfixe des testid : `${testId}-${clé}`. */
  testId?: string;
}) {
  return (
    <div
      className={s.toggle}
      role="radiogroup"
      aria-label={label}
      data-view
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const i = items.findIndex(([k]) => k === value);
        const next = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length][0];
        onChange(next);
        requestAnimationFrame(() => e.currentTarget?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      }}
    >
      {items.map(([k, text]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          tabIndex={value === k ? 0 : -1}
          className={value === k ? s.on : ''}
          data-label={text}
          onClick={() => onChange(k)}
          data-testid={testId ? `${testId}-${k}` : undefined}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
