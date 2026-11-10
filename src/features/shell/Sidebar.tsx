import { useCanCopy, useDriveReview, useReadOnly } from '../../store/share';
import { CalendarDays, ChartNoAxesGantt, ClipboardList, Clapperboard, Database, Download, Feather, ListChecks, Map, Package, ScrollText, Settings, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Route } from '../../app/router';
import { navigate } from '../../app/router';
import { PREP_STEPS, REVIEWED, STEP_GROUPS } from './steps';
import s from './Sidebar.module.css';

const ICON = { size: 16, strokeWidth: 1.25 } as const;
const STEP_ICONS: Partial<Record<Route, ReactNode>> = {
  intention: <Feather {...ICON} />,
  scenario: <ScrollText {...ICON} />,
  breakdown: <ListChecks {...ICON} />,
  grid: <Clapperboard {...ICON} />,
  floorplan: <Map {...ICON} />,
  equipment: <Package {...ICON} />,
  schedule: <ChartNoAxesGantt {...ICON} />,
  callsheet: <ClipboardList {...ICON} />,
  calendar: <CalendarDays {...ICON} />,
};

interface Props {
  activeRoute: Route;
  /** Menu replié en barre d'icônes (les libellés restent en infobulle et pour les lecteurs d'écran). */
  collapsed?: boolean;
  counts?: { registry?: number; checks?: number };
  /** Après un choix (téléphone : le tiroir se referme). */
  onNavigate?: () => void;
}

/** Menu latéral : les étapes dans l'ordre de la production, regroupées ; projet et paramètres en bas. */
export function Sidebar({ activeRoute, collapsed = false, counts = {}, onNavigate }: Props) {
  const readOnly = useReadOnly();
  // Invité sans droit de copie : rien à exporter.
  const canCopy = useCanCopy();
  // Relecture en ligne : seuls le scénario et le découpage sont publiés.
  const drive = useDriveReview();
  const shown = (route: Route) => !drive || REVIEWED.has(route);
  // Le storyboard est une vue du découpage technique ; la frise de production, une vue du calendrier.
  const current = activeRoute === 'storyboard' ? 'grid' : activeRoute === 'production' ? 'calendar' : activeRoute;
  const item = (route: Route, label: string, mark: ReactNode, count?: number, testId?: string) => {
    const active = current === route;
    return (
      <li key={route}>
        <button
          type="button"
          className={[s.step, active ? s.active : ''].join(' ')}
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? label : undefined}
          title={collapsed ? label : undefined}
          onClick={() => {
            navigate(route);
            onNavigate?.();
          }}
          data-testid={testId}
        >
          <span className={s.mark} aria-hidden="true">
            {mark}
          </span>
          <span className={s.label}>{label}</span>
          {count !== undefined && count > 0 && <em className={s.count}>{count}</em>}
        </button>
      </li>
    );
  };
  return (
    <aside className={[s.sidebar, collapsed ? s.collapsed : '', 'no-print'].join(' ')} aria-label="Étapes du projet" data-collapsed={collapsed || undefined}>
      <nav className={s.nav}>
        {STEP_GROUPS.map((g) => {
          const steps = g.steps.map((n) => PREP_STEPS.find((x) => x.n === n)!).filter((step) => shown(step.route));
          return steps.length ? (
            <div key={g.label} className={s.group}>
              <p className={s.section}>{g.label}</p>
              <ol className={s.steps}>{steps.map((step) => item(step.route, step.label, STEP_ICONS[step.route]))}</ol>
            </div>
          ) : null;
        })}
        {!drive && <div className={s.group}>
          <p className={s.section}>Projet</p>
          <ul className={s.steps}>
            {item('registry', 'Registre', <Database {...ICON} />, counts.registry)}
            {item('checks', 'Vérifications', <ShieldCheck {...ICON} />, counts.checks)}
            {canCopy && item('export', 'Exporter', <Download {...ICON} />)}
          </ul>
        </div>}
      </nav>

      <div className={s.foot}>
        <ul className={s.steps}>
          {!readOnly && item('settings', 'Paramètres', <Settings {...ICON} />)}
        </ul>
      </div>
    </aside>
  );
}
