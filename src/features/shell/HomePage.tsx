import { removeProject, undoHome, useHomeHistory } from '../../store/homeHistory';
import { useCallback, useEffect, useState } from 'react';
import { FileUp, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { navigate } from '../../app/router';
import { listProjects, type ProjectSummary } from '../../store/db';
import { openFromFile, openStoredProject, rememberLastProject } from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { useUi } from '../../store/uiStore';
import { NewProjectWizard } from './NewProjectWizard';
import s from './HomePage.module.css';

const FORMAT_LABEL: Record<string, string> = {
  fiction: 'Fiction',
  clip: 'Clip',
  documentaire: 'Documentaire',
  institutionnel: 'Institutionnel',
  pub: 'Publicité',
};

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [wizard, setWizard] = useState(false);
  const rev = useHomeHistory((h) => h.rev);
  const refresh = useCallback(() => void listProjects().then(setProjects), []);
  useEffect(refresh, [refresh, rev]);

  const open = async (id: string) => {
    if (await openStoredProject(id)) navigate('grid');
  };
  // Suppression directe, annulable (⌘Z ou « Annuler ») et rétablissable (⌘⇧Z).
  const remove = async (p: ProjectSummary) => {
    await removeProject(p.id);
    if (useProjectStore.getState().doc?.project.id === p.id) {
      useProjectStore.getState().loadDoc(null);
      rememberLastProject(null);
    }
    useUi.getState().toast({ message: `Projet « ${p.title} » supprimé.`, actionLabel: 'Annuler', action: () => void undoHome() });
  };

  const n = projects?.length ?? 0;
  const theme = useUi((u) => u.theme);
  return (
    <div className={s.home} data-testid="home">
      <section className={s.hero}>
        <FilmEdge />
        <p className={s.mark} aria-hidden="true">
          <span />
          <span />
          <span />
        </p>
        <h1 className={s.brand}>
          <span className={s.word}>Découpage</span>
          <em className={s.word}>Studio</em>
        </h1>
        <p className={s.tagline}>Du scénario au plateau, plan par plan.</p>
        <div className={s.cta}>
          <Button variant="primary" icon={<Plus size={16} strokeWidth={1.5} />} onClick={() => setWizard(true)} data-testid="new-project">
            Nouveau projet
          </Button>
          <Button variant="outline" icon={<FileUp size={15} strokeWidth={1.25} />} onClick={async () => (await openFromFile()) && navigate('grid')}>
            Ouvrir un fichier…
          </Button>
        </div>
        <FrameArt />
        <footer className={s.foot}>
          <button type="button" onClick={() => useUi.getState().set({ theme: theme === 'papier' ? 'encre' : 'papier' })} aria-label={theme === 'encre' ? 'Thème papier' : 'Thème encre'}>
            {theme === 'encre' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'encre' ? 'papier' : 'encre'}
          </button>
          <span>Enregistré dans ce navigateur · fonctionne hors ligne</span>
        </footer>
      </section>

      <section className={s.projects} aria-label="Projets">
        <h2 className={s.h2}>
          Vos projets {n > 0 && <span className={s.count}>{n}</span>}
        </h2>
        {projects && projects.length === 0 && (
          <div className={s.empty}>
            <span className="hand">Aucun projet pour l’instant</span>
            <p>Commencez par un nouveau projet, ou ouvrez un fichier .decoupage.</p>
          </div>
        )}
        {projects && projects.length > 0 && (
          <ul className={s.list} data-testid="project-list">
            {projects.map((p, i) => (
              <li key={p.id} className={s.item} style={{ animationDelay: `${120 + i * 70}ms` }}>
                <button type="button" className={s.open} onClick={() => open(p.id)}>
                  <span className={s.strip} aria-hidden="true">
                    {Array.from({ length: Math.min(24, Math.max(1, p.sequences)) }, (_, k) => (
                      <i key={k} />
                    ))}
                  </span>
                  <span className={s.title}>{p.title}</span>
                  <span className={s.meta}>
                    {FORMAT_LABEL[p.format] ?? p.format} · {p.version} · {p.sequences} séquence{p.sequences > 1 ? 's' : ''} · {p.shots} plan{p.shots > 1 ? 's' : ''}
                  </span>
                  <span className={s.date}>modifié le {dateFmt.format(new Date(p.updatedAt))}</span>
                </button>
                <button type="button" className={s.del} aria-label={`Supprimer ${p.title}`} title="Supprimer" onClick={() => remove(p)}>
                  <Trash2 size={14} strokeWidth={1.4} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {wizard && (
        <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && setWizard(false)}>
          <NewProjectWizard onCancel={() => setWizard(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * Décor : trois cases de storyboard (plan large, plan moyen, gros plan) qui se tracent l'une après
 * l'autre, puis une tête de lecture qui passe lentement de case en case.
 */
function FrameArt() {
  return (
    <svg className={s.art} viewBox="0 0 492 96" aria-hidden="true">
      <g className={s.frames}>
        <rect x="1" y="1" width="154" height="87" rx="3" />
        <path d="M 1 66 L 40 44 L 64 58 L 104 30 L 155 62" />
        <circle cx="128" cy="22" r="7" />
        <rect x="169" y="1" width="154" height="87" rx="3" />
        <circle cx="246" cy="36" r="13" />
        <path d="M 214 88 Q 222 54 246 54 Q 270 54 278 88" />
        <rect x="337" y="1" width="154" height="87" rx="3" />
        <circle cx="414" cy="52" r="34" />
        <path d="M 402 46 h 6 M 420 46 h 6 M 406 66 Q 414 71 422 66" />
      </g>
      <rect className={s.playhead} x="1" y="1" width="154" height="87" rx="3" />
    </svg>
  );
}

/** Perforations de pellicule qui défilent le long de la séparation. */
function FilmEdge() {
  return (
    <div className={s.filmEdge} aria-hidden="true">
      <span />
    </div>
  );
}
