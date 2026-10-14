import type { ReactNode } from 'react';
import s from './Hand.module.css';

/** Annotation manuscrite (Caveat, rouille), soulignée à main levée. */
export function Hand({ children, underline = false, className }: { children: ReactNode; underline?: boolean; className?: string }) {
  return (
    <span className={[s.hand, className ?? ''].join(' ')}>
      {children}
      {underline && (
        <svg className={s.line} viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
          <path d="M1 4 C 18 1.5, 34 5.5, 52 3.2 S 84 1.8, 99 3.6" />
        </svg>
      )}
    </span>
  );
}
