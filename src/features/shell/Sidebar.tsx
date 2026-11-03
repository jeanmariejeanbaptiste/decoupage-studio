import { useCanCopy, useReadOnly } from '../../store/share';
import { useShortcutLabel } from '../../store/shortcuts';
import { Settings } from 'lucide-react';
import type { Route } from '../../app/router';
import { navigate } from '../../app/router';
import { PREP_STEPS } from './steps';
import s from './Sidebar.module.css';

interface Props {
  projectTitle: string;
  activeRoute: Route;
  extraLinks?: ReadonlyArray<{ label: string; route: Route; count?: number }>;
}

export function Sidebar({ projectTitle, activeRoute, extraLinks = [] }: Props) {
  const readOnly = useReadOnly();
  // Invité sans droit de copie : rien à exporter.
  const canCopy = useCanCopy();
  const keys = { palette: useShortcutLabel('palette'), newShot: useShortcutLabel('newShot'), undo: useShortcutLabel('undo'), help: useShortcutLabel('help') };
  return (
    <aside className={[s.sidebar, 'no-print'].join(' ')} aria-label="Processus de préparation">
      <div className={s.head}>
        <h2 className={s.project}>{projectTitle}</h2>
      </div>

      <nav className={s.nav}>
        <p className={s.section}>Processus de préparation</p>
        <ol className={s.steps}>
          {PREP_STEPS.filter((step) => canCopy || step.route !== 'export').map((step) => {
            const active = activeRoute === step.route;
            return (
              <li key={step.n}>
                <button
                  type="button"
                  className={[s.step, active ? s.active : '', step.available ? '' : s.soon].join(' ')}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(step.route)}
                >
                  <span className={s.num} aria-hidden="true">
                    {step.n}
                  </span>
                  <span className={s.label}>{step.label}</span>
                  {!step.available && <span className={s.soonTag}>bientôt</span>}
                </button>
              </li>
            );
          })}
        </ol>

        {extraLinks.length > 0 && (
          <>
            <p className={s.section}>Base du projet</p>
            <ul className={s.steps}>
              {extraLinks.map((l) => (
                <li key={l.route}>
                  <button
                    type="button"
                    className={[s.step, activeRoute === l.route ? s.active : ''].join(' ')}
                    aria-current={activeRoute === l.route ? 'page' : undefined}
                    onClick={() => navigate(l.route)}
                  >
                    <span className={s.dot} aria-hidden="true" />
                    <span className={s.label}>{l.label}</span>
                    {l.count !== undefined && <em className={s.pct}>{l.count}</em>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>

      <div className={s.foot}>
        {!readOnly && (
          <button type="button" className={s.settings} onClick={() => navigate('settings')}>
            <Settings size={15} strokeWidth={1.25} /> Paramètres
          </button>
        )}
        <dl className={s.keys}>
          <div><dt>{keys.palette}</dt><dd>commandes</dd></div>
          {!readOnly && <div><dt>{keys.newShot}</dt><dd>nouveau plan</dd></div>}
          {!readOnly && <div><dt>{keys.undo}</dt><dd>annuler</dd></div>}
          <div><dt>{keys.help}</dt><dd>raccourcis</dd></div>
        </dl>
      </div>
    </aside>
  );
}
