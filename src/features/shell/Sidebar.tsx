import { Check, Settings } from 'lucide-react';
import type { Route } from '../../app/router';
import { navigate } from '../../app/router';
import { Hand } from '../../ui/Hand';
import { PREP_STEPS } from './steps';
import s from './Sidebar.module.css';

interface Props {
  projectTitle: string;
  activeRoute: Route;
  validated: readonly number[];
  progress: Readonly<Record<number, number>>;
  extraLinks?: ReadonlyArray<{ label: string; route: Route; count?: number }>;
}

export function Sidebar({ projectTitle, activeRoute, validated, progress, extraLinks = [] }: Props) {
  const nValid = validated.length;
  const total = PREP_STEPS.length;
  return (
    <aside className={s.sidebar} aria-label="Processus de préparation">
      <div className={s.head}>
        <h2 className={s.project}>{projectTitle}</h2>
        <Hand>
          {nValid} étape{nValid > 1 ? 's' : ''} validée{nValid > 1 ? 's' : ''} sur {total}
        </Hand>
        <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={nValid}>
          <span style={{ width: `${(nValid / total) * 100}%` }} />
        </div>
      </div>

      <nav className={s.nav}>
        <p className={s.section}>Processus de préparation</p>
        <ol className={s.steps}>
          {PREP_STEPS.map((step) => {
            const done = validated.includes(step.n);
            const active = activeRoute === step.route;
            const pct = progress[step.n];
            return (
              <li key={step.n}>
                <button
                  type="button"
                  className={[s.step, active ? s.active : '', step.available ? '' : s.soon].join(' ')}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(step.route)}
                >
                  <span className={[s.num, done ? s.done : ''].join(' ')} aria-hidden="true">
                    {done ? <Check size={12} strokeWidth={2} /> : step.n}
                  </span>
                  <span className={s.label}>{step.label}</span>
                  {step.available ? (
                    <em className={s.pct}>{pct !== undefined ? `${Math.round(pct)} %` : ''}</em>
                  ) : (
                    <span className={s.soonTag}>bientôt</span>
                  )}
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
        <button type="button" className={s.settings} onClick={() => navigate('settings')}>
          <Settings size={15} strokeWidth={1.25} /> Paramètres
        </button>
        <dl className={s.keys}>
          <div><dt>⌘K</dt><dd>commandes</dd></div>
          <div><dt>⌘↵</dt><dd>nouveau plan</dd></div>
          <div><dt>⌘Z</dt><dd>annuler</dd></div>
          <div><dt>?</dt><dd>raccourcis</dd></div>
        </dl>
      </div>
    </aside>
  );
}
