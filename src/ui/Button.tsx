import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import s from './Button.module.css';

type Variant = 'primary' | 'outline' | 'ghost' | 'icon' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'ghost', icon, size = 'md', className, children, ...rest },
  ref,
) {
  const cls = [s.btn, s[variant], size === 'sm' ? s.sm : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button ref={ref} type="button" className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
});
