import { useEffect, useRef, useState } from 'react';
import { Copy, Users, X } from 'lucide-react';
import { navigate, useLocation } from '../../app/router';
import { joinSession, kickGuest, leaveSession, shareLink, startHosting, stopHosting, updateShareSettings, useShare, type ShareMode } from '../../store/share';
import { useDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import s from './Share.module.css';

const copy = async (text: string, what: string) => {
  await navigator.clipboard.writeText(text).catch(() => undefined);
  useUi.getState().toast({ message: `${what} copié.` });
};

/** Bouton « Partager » de la barre du haut : ouvre, règle et ferme le partage du projet. */
export function ShareButton() {
  const doc = useDoc();
  const st = useShare();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ShareMode>('edit');
  const [keep, setKeep] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!doc || st.role === 'guest') return null;
  const hosting = st.role === 'host';
  return (
    <div className={s.wrap} ref={ref}>
      <Button variant={hosting ? 'primary' : 'ghost'} size="sm" icon={<Users size={15} strokeWidth={1.4} />} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="share-button">
        {hosting ? `Partagé${st.guests.length ? ` · ${st.guests.length}` : ''}` : 'Partager'}
      </Button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Partager le projet" data-testid="share-panel">
          {!hosting || st.status === 'opening' ? (
            <>
              <p className={s.title}>Travailler à plusieurs</p>
              <fieldset className={s.seg}>
                <legend>Les invités peuvent</legend>
                <label className={mode === 'edit' ? s.on : ''}>
                  <input type="radio" name="share-mode" checked={mode === 'edit'} onChange={() => setMode('edit')} />
                  modifier
                </label>
                <label className={mode === 'read' ? s.on : ''}>
                  <input type="radio" name="share-mode" checked={mode === 'read'} onChange={() => setMode('read')} />
                  seulement lire
                </label>
              </fieldset>
              <label className={s.check}>
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                Ils gardent une copie du projet
              </label>
              {st.status === 'error' && <p className={s.error}>{st.error}</p>}
              <Button variant="primary" disabled={st.status === 'opening'} onClick={() => void startHosting({ mode, keep })} data-testid="share-start">
                {st.status === 'opening' ? 'Ouverture…' : 'Ouvrir le partage'}
              </Button>
              <p className={s.note}>Le partage reste ouvert tant que cette page est ouverte.</p>
            </>
          ) : (
            <>
              <p className={s.title}>Partage ouvert</p>
              <div className={s.field}>
                <span>Lien</span>
                <code data-testid="share-link">{shareLink(st.room!)}</code>
                <button type="button" onClick={() => void copy(shareLink(st.room!), 'Lien')} aria-label="Copier le lien">
                  <Copy size={13} />
                </button>
              </div>
              <div className={s.field}>
                <span>Mot de passe</span>
                <code data-testid="share-password">{st.password}</code>
                <button type="button" onClick={() => void copy(st.password!, 'Mot de passe')} aria-label="Copier le mot de passe">
                  <Copy size={13} />
                </button>
              </div>
              <Button size="sm" onClick={() => void copy(`${shareLink(st.room!)}\nMot de passe : ${st.password}`, 'Lien et mot de passe')}>
                Copier lien et mot de passe
              </Button>
              <fieldset className={s.seg}>
                <legend>Les invités peuvent</legend>
                <label className={st.mode === 'edit' ? s.on : ''}>
                  <input type="radio" name="share-mode-live" checked={st.mode === 'edit'} onChange={() => updateShareSettings({ mode: 'edit' })} />
                  modifier
                </label>
                <label className={st.mode === 'read' ? s.on : ''}>
                  <input type="radio" name="share-mode-live" checked={st.mode === 'read'} onChange={() => updateShareSettings({ mode: 'read' })} />
                  seulement lire
                </label>
              </fieldset>
              <label className={s.check}>
                <input type="checkbox" checked={st.keep} onChange={(e) => updateShareSettings({ keep: e.target.checked })} />
                Ils gardent une copie du projet
              </label>
              <p className={s.sub}>Connectés ({st.guests.length})</p>
              <ul className={s.guests} data-testid="share-guests">
                {st.guests.length === 0 && <li className={s.muted}>personne pour l’instant</li>}
                {st.guests.map((g) => (
                  <li key={g.id}>
                    {g.name}
                    <button type="button" onClick={() => kickGuest(g.id)} aria-label={`Exclure ${g.name}`} title="Exclure">
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <Button variant="danger" size="sm" onClick={stopHosting} data-testid="share-stop">
                Fermer le partage
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Page d'arrivée d'un invité : nom et mot de passe, puis le projet s'ouvre. */
export function JoinPage() {
  const { params } = useLocation();
  const room = params.get('room') ?? '';
  const st = useShare();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('ds-guest-name') ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const busy = st.status === 'joining';
  return (
    <div className="page">
      <form
        className={['card', s.join].join(' ')}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            localStorage.setItem('ds-guest-name', name);
          } catch {
            /* stockage indisponible */
          }
          if (await joinSession(room, password, name)) navigate('grid');
        }}
        data-testid="join-form"
      >
        <h1 className={s.joinTitle}>Rejoindre un projet partagé</h1>
        {!room && <p className={s.error}>Lien de partage incomplet.</p>}
        <label className={s.input}>
          <span>Votre nom</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required aria-label="Votre nom" />
        </label>
        <label className={s.input}>
          <span>Mot de passe</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" aria-label="Mot de passe" />
        </label>
        {st.status === 'error' && <p className={s.error}>{st.error}</p>}
        <Button type="submit" variant="primary" disabled={!room || busy} data-testid="join-go">
          {busy ? 'Connexion…' : 'Rejoindre'}
        </Button>
      </form>
    </div>
  );
}

/** Bandeau de l'invité : qui partage, quels droits, et quitter. */
export function GuestBanner() {
  const st = useShare();
  if (st.role !== 'guest' || (st.status !== 'joined' && st.status !== 'closed')) return null;
  return (
    <div className={[s.banner, st.status === 'closed' ? s.bannerOff : ''].join(' ')} role="status" data-testid="guest-banner">
      {st.status === 'closed' ? (
        <span>Partage fermé par l’hôte.{st.keep ? ' Votre copie est conservée.' : ''}</span>
      ) : (
        <span>
          Projet partagé par <b>{st.hostName}</b> · {st.mode === 'read' ? 'lecture seule' : 'modification'}
          {st.guests.length > 1 ? ` · ${st.guests.length} personnes connectées` : ''}
          {st.keep ? '' : ' · rien n’est enregistré sur cet ordinateur'}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          leaveSession();
          navigate('home');
        }}
        data-testid="guest-leave"
      >
        Quitter
      </button>
    </div>
  );
}
