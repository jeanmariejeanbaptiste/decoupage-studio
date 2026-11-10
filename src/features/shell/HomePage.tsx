import { removeProject, undoHome, useHomeHistory } from '../../store/homeHistory';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Copy, FileUp, Trash2 } from 'lucide-react';
import { navigate } from '../../app/router';
import { listProjects, liveReviewOf, type ProjectSummary } from '../../store/db';
import { openFromFile, openStoredProject, rememberLastProject } from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { NewProjectWizard } from './NewProjectWizard';
import { duplicateProject } from './duplicateProject';
import { switchTheme } from '../../ui/themeSwitch';
import s from './HomePage.module.css';
import { AccountButton } from './Account';
import { preloadGoogle, useCloud } from '../../store/cloud';
import { REVIEW_ENABLED } from '../../app/config';

const FORMAT_LABEL: Record<string, string> = {
  fiction: 'Fiction',
  clip: 'Clip',
  documentaire: 'Documentaire',
  institutionnel: 'Institutionnel',
  pub: 'Publicité',
};

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
/** « 10 nov. » dans l'année, « 10 nov. 2025 » au-delà. */
const formatDay = (iso: string) => {
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? dateFmt : dateYearFmt).format(d);
};
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Accueil, composé sur un axe central : en haut, l'objectif d'un projecteur dont le faisceau descend
 * sur le titre ; la poussière y flotte, le grain de la pellicule vibre ; autour, les repères
 * symétriques d'un viseur. Les projets sont posés en bas, comme des plaques de verre.
 */
export function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [wizard, setWizard] = useState(false);
  const rev = useHomeHistory((h) => h.rev);
  const theme = useUi((u) => u.theme);
  // Stockage du navigateur refusé (cookies bloqués, profil restreint) : dit une fois, à la place de la liste.
  const [unavailable, setUnavailable] = useState(false);
  const refresh = useCallback(
    () =>
      void listProjects().then(
        (list) => {
          setUnavailable(false);
          setProjects(list);
        },
        () => setUnavailable(true),
      ),
    [],
  );
  // Après une synchronisation Google Drive, des projets ont pu arriver d'un autre ordinateur.
  const synced = useCloud((c) => c.lastSync);
  useEffect(refresh, [refresh, rev, synced]);
  // Projet enregistré dans un autre onglet : la liste suit.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('ds-projects');
    channel.onmessage = refresh;
    return () => channel.close();
  }, [refresh]);
  // Relecture en ligne ouverte : la connexion Google prête pour fermer son lien si le projet est supprimé.
  const anyLive = !!projects?.some((p) => p.liveReview);
  useEffect(() => {
    if (anyLive && REVIEW_ENABLED) void preloadGoogle().catch(() => undefined);
  }, [anyLive]);

  const open = async (id: string) => {
    if (await openStoredProject(id)) navigate('grid');
  };
  // Suppression directe, annulable (⌘Z ou « Annuler ») et rétablissable (⌘⇧Z).
  const remove = async (p: ProjectSummary) => {
    // Projet encore ouvert : son état en mémoire fait foi (un enregistrement peut être en attente).
    const openDoc = useProjectStore.getState().doc;
    const live = openDoc?.project.id === p.id ? liveReviewOf(openDoc) : p.liveReview;
    try {
      await removeProject(p.id, live);
    } catch (e) {
      // Lien de relecture resté ouvert : le projet reste (on ne laisse pas un lien public sans moyen de l'arrêter).
      useUi.getState().toast({ message: `Projet « ${p.title} » gardé : ${(e as Error).message}` });
      return;
    }
    if (useProjectStore.getState().doc?.project.id === p.id) {
      useProjectStore.getState().loadDoc(null);
      rememberLastProject(null);
    }
    useUi
      .getState()
      .toast({
        message: `Projet « ${p.title} » supprimé.`,
        actionLabel: 'Annuler',
        action: () => void undoHome(p.id),
      });
  };

  // Fichier .decoupage déposé sur la page : ouvert comme par « Ouvrir un fichier… ».
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const file = [...e.dataTransfer.files].find((f) => /\.(decoupage|json)$/i.test(f.name));
    if (file && (await openFromFile(file))) navigate('grid');
  };

  const n = projects?.length ?? 0;
  return (
    <div
      className={s.home}
      data-tone={theme === 'encre' ? 'dark' : 'light'}
      data-testid="home"
      data-dropping={dropping || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => e.relatedTarget === null && setDropping(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <Projector />
      <div className={s.grain} aria-hidden="true" />
      <Viewfinder />

      <header className={s.top}>
        <Timecode />
        <span />
        <span className={s.topRight}>
        <AccountButton className={s.account} />
        <button
          type="button"
          className={s.toggle}
          onClick={(e) => switchTheme(e)}
          aria-label={theme === 'encre' ? 'Thème papier' : 'Thème encre'}
        >
          <span className={theme === 'papier' ? s.toggleOn : ''}>Jour</span>
          <span className={theme === 'encre' ? s.toggleOn : ''}>Nuit</span>
        </button>
        </span>
      </header>

      <main className={s.hero}>
        <h1 className={s.title}>
          <span className={s.titleB}>Découpage</span>
          <span className={s.titleA}>Studio</span>
        </h1>
        <div className={s.cta}>
          <button
            type="button"
            className={s.primary}
            onClick={() => setWizard(true)}
            data-testid="new-project"
          >
            Nouveau projet <ArrowRight size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className={s.ghost}
            onClick={async () => (await openFromFile()) && navigate('grid')}
          >
            <FileUp size={15} strokeWidth={1.3} /> Ouvrir un fichier…
          </button>
        </div>
      </main>

      <section className={s.shelf} aria-label="Projets">
        <p className={s.shelfHead}>
          <span className={s.rule} />
          <span>Vos projets</span>
          <span className={s.count}>{pad(n)}</span>
          <span className={s.rule} />
        </p>
        {unavailable && (
          <div className={s.empty} role="alert">
            <span>Le stockage du navigateur est indisponible : les projets ne peuvent pas être enregistrés ici.</span>
          </div>
        )}
        {!unavailable && projects && projects.length === 0 && (
          <div className={s.empty}>
            <strong>Aucun projet pour l’instant</strong>
            <span>Le premier commence par « Nouveau projet ».</span>
          </div>
        )}
        {!unavailable && projects && projects.length > 0 && (
          <ul className={s.list} data-testid="project-list">
            {projects.map((p, i) => (
              <li key={p.id} className={s.item} style={{ animationDelay: `${900 + i * 90}ms` }}>
                <button type="button" className={s.card} onClick={() => open(p.id)}>
                  <span className={s.cardTop}>
                    <span>{pad(i + 1)}</span>
                    <span>
                      {FORMAT_LABEL[p.format] ?? p.format} · {p.version}
                    </span>
                  </span>
                  <span className={s.cardTitle}>{p.title}</span>
                  <span className={s.cardMeta}>
                    {p.sequences} séq. · {p.shots} plan{p.shots > 1 ? 's' : ''} ·{' '}
                    {formatDay(p.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className={s.dup}
                  aria-label={`Dupliquer ${p.title}`}
                  title="Dupliquer"
                  onClick={() => void duplicateProject(p.id).then(refresh)}
                >
                  <Copy size={13} strokeWidth={1.4} />
                </button>
                <button
                  type="button"
                  className={s.del}
                  aria-label={`Supprimer ${p.title}`}
                  title="Supprimer"
                  onClick={() => remove(p)}
                >
                  <Trash2 size={13} strokeWidth={1.4} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {wizard && (
        <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && setWizard(false)} onKeyDown={(e) => e.key === 'Escape' && setWizard(false)}>
          <NewProjectWizard onCancel={() => setWizard(false)} />
        </div>
      )}
    </div>
  );
}

/** Faisceau de projecteur : il s'allume à l'arrivée, vacille à peine, la poussière y danse. */
function Projector() {
  return (
    <div className={s.projector} aria-hidden="true">
      <div className={s.beamBlur}>
        <div className={s.beam} />
        <div className={s.beamCore} />
      </div>
      <div className={s.lens} />
      <div className={s.dustBox}>
        {Array.from({ length: 16 }, (_, i) => (
          <i
            key={i}
            className={s.dust}
            style={{
              left: `${(i * 37) % 92}%`,
              top: `${(i * 53) % 96}%`,
              animationDelay: `${(i * 0.7) % 6}s`,
              animationDuration: `${9 + (i % 5) * 2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Repères de viseur aux quatre coins, et une règle de cadrage sur le bord gauche. */
function Viewfinder() {
  return (
    <div className={s.viewfinder} aria-hidden="true">
      <i className={s.cornerTL} />
      <i className={s.cornerTR} />
      <i className={s.cornerBL} />
      <i className={s.cornerBR} />
      {[s.rulerL, s.rulerR].map((side) => (
        <div key={side} className={[s.ruler, side].join(' ')}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>{i * 10}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Code temporel qui défile à 25 images par seconde depuis l'ouverture de la page. */
function Timecode() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const f = Math.floor(((performance.now() - t0) / 1000) * 25);
      const sec = Math.floor(f / 25);
      if (ref.current)
        ref.current.textContent = `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}:${pad(f % 25)}`;
    }, 40);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className={s.tc}>
      <i className={s.rec} /> TC <span ref={ref}>00:00:00:00</span>
    </span>
  );
}
