import { useCallback, useEffect, useState } from 'react';
import { FileUp, Film, Plus, Trash2 } from 'lucide-react';
import { buildFiction } from '../../../seed/fiction';
import { buildRav3 } from '../../../seed/rav3';
import { navigate } from '../../app/router';
import { deleteProject, listProjects, type ProjectSummary } from '../../store/db';
import { openDoc, openFromFile, openStoredProject, rememberLastProject } from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
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
  const refresh = useCallback(() => void listProjects().then(setProjects), []);
  useEffect(refresh, [refresh]);

  const open = async (id: string) => {
    if (await openStoredProject(id)) navigate('grid');
  };
  const openDemo = async (which: 'rav3' | 'fiction') => {
    const doc = which === 'rav3' ? buildRav3() : buildFiction();
    await openDoc(doc);
    navigate('grid');
  };
  const remove = async (p: ProjectSummary) => {
    const res = await ask({
      title: `Supprimer « ${p.title} » ?`,
      body: 'Le projet sera effacé de ce navigateur. Pensez à l’enregistrer dans un fichier auparavant.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!res.ok) return;
    await deleteProject(p.id);
    if (useProjectStore.getState().doc?.project.id === p.id) {
      useProjectStore.getState().loadDoc(null);
      rememberLastProject(null);
    }
    refresh();
  };

  const n = projects?.length ?? 0;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">Accueil</p>
          <h1 className="page-title">
            {n === 0 ? 'Vos projets' : (
              <>
                Vos <em>{n}</em> projet{n > 1 ? 's' : ''}
              </>
            )}
          </h1>
        </div>
        <div className={s.actions}>
          <Button variant="outline" icon={<FileUp size={15} strokeWidth={1.25} />} onClick={async () => (await openFromFile()) && navigate('grid')}>
            Ouvrir un fichier…
          </Button>
          <Button variant="primary" icon={<Plus size={15} strokeWidth={1.5} />} onClick={() => setWizard(true)} data-testid="new-project">
            Nouveau projet
          </Button>
        </div>
      </header>

      {wizard && <NewProjectWizard onCancel={() => setWizard(false)} />}

      {projects && projects.length === 0 && !wizard && (
        <div className="card empty">
          <span className="hand">Aucun projet pour l’instant</span>
          <p>Créez votre premier découpage, ouvrez un fichier .decoupage, ou explorez une démonstration.</p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className={s.list} data-testid="project-list">
          {projects.map((p) => (
            <li key={p.id} className={['card', s.item].join(' ')}>
              <button type="button" className={s.open} onClick={() => open(p.id)}>
                <span className={s.title}>{p.title}</span>
                <span className={s.meta}>
                  {FORMAT_LABEL[p.format] ?? p.format} · {p.version} · {p.sequences} séquence{p.sequences > 1 ? 's' : ''} · {p.shots} plan{p.shots > 1 ? 's' : ''}
                </span>
                <span className={s.date}>modifié le {dateFmt.format(new Date(p.updatedAt))}</span>
              </button>
              <Button variant="icon" aria-label={`Supprimer ${p.title}`} title="Supprimer" onClick={() => remove(p)} icon={<Trash2 size={15} strokeWidth={1.25} />} />
            </li>
          ))}
        </ul>
      )}

      <section className={s.demos}>
        <h2 className={s.h2}>Démonstrations</h2>
        <div className={s.demoGrid}>
          <button type="button" className={['card', s.demo].join(' ')} onClick={() => openDemo('rav3')} data-testid="demo-rav3">
            <Film size={18} strokeWidth={1.25} />
            <span className={s.title}>RAV3</span>
            <span className={s.meta}>Clip · TC musical · 7 séquences, 53 plans — l’export de référence</span>
          </button>
          <button type="button" className={['card', s.demo].join(' ')} onClick={() => openDemo('fiction')} data-testid="demo-fiction">
            <Film size={18} strokeWidth={1.25} />
            <span className={s.title}>La Consigne</span>
            <span className={s.meta}>Fiction courte · minutage cumulatif automatique · dialogues</span>
          </button>
        </div>
      </section>
    </div>
  );
}
