import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, PenLine, Users, X } from 'lucide-react';
import { navigate, useLocation } from '../../app/router';
import { joinSession, kickGuest, leaveSession, shareLink, startHosting, stopHosting, updateShareSettings, useShare, type ShareMode } from '../../store/share';
import { useDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import s from './Share.module.css';

const copy = async (text: string) => {
  await navigator.clipboard.writeText(text).catch(() => undefined);
};

/** Choix « modifier / lire seulement » : pastille de verre qui glisse d'une option à l'autre. */
function ModeSwitch({ name, value, onChange }: { name: string; value: ShareMode; onChange: (m: ShareMode) => void }) {
  return (
    <div className={s.modes} role="radiogroup" aria-label="Les invités peuvent" data-mode={value}>
      <span className={s.thumb} aria-hidden="true" />
      <label className={value === 'edit' ? s.modeOn : ''}>
        <input type="radio" name={name} checked={value === 'edit'} onChange={() => onChange('edit')} />
        <PenLine size={14} strokeWidth={1.4} /> Modifier
      </label>
      <label className={value === 'read' ? s.modeOn : ''}>
        <input type="radio" name={name} checked={value === 'read'} onChange={() => onChange('read')} />
        <Eye size={14} strokeWidth={1.4} /> Lire seulement
      </label>
    </div>
  );
}

/** Interrupteur « Ils gardent une copie ». */
function KeepSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={s.switchRow}>
      <span>Ils gardent une copie du projet</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i className={s.switch} aria-hidden="true" />
    </label>
  );
}

/** Bouton « Partager » de la barre du haut : ouvre, règle et ferme le partage du projet. */
export function ShareButton() {
  const doc = useDoc();
  const st = useShare();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ShareMode>('edit');
  const [keep, setKeep] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!doc || st.role === 'guest') return null;
  const hosting = st.role === 'host' && st.status !== 'opening';
  const copyAs = (key: string, text: string) => {
    void copy(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };
  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={[s.trigger, hosting ? s.live : ''].join(' ')} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="share-button">
        {hosting ? <i className={s.liveDot} aria-hidden="true" /> : <Users size={15} strokeWidth={1.4} />}
        {hosting ? `Partagé${st.guests.length ? ` · ${st.guests.length}` : ''}` : 'Partager'}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Partager le projet" data-testid="share-panel">
          <div className={s.glow} aria-hidden="true" />
          <div className={s.grain} aria-hidden="true" />
          <header className={s.head}>
            <i className={[s.orb, hosting ? s.orbLive : ''].join(' ')} aria-hidden="true" />
            <div>
              <p className={s.title}>{hosting ? 'Partage ouvert' : 'Travailler à plusieurs'}</p>
              <p className={s.kicker}>{hosting ? `${st.guests.length} connecté${st.guests.length > 1 ? 's' : ''}` : 'Un lien, un mot de passe'}</p>
            </div>
          </header>

          {!hosting ? (
            <>
              <ModeSwitch name="share-mode" value={mode} onChange={setMode} />
              <KeepSwitch checked={keep} onChange={setKeep} />
              {st.status === 'error' && <p className={s.error}>{st.error}</p>}
              <button type="button" className={s.cta} disabled={st.status === 'opening'} onClick={() => void startHosting({ mode, keep })} data-testid="share-start">
                {st.status === 'opening' ? 'Ouverture…' : 'Ouvrir le partage'}
              </button>
              <p className={s.note}>Le partage reste ouvert tant que cette page est ouverte.</p>
            </>
          ) : (
            <>
              <div className={s.secret}>
                <div className={s.field}>
                  <span>Lien</span>
                  <code data-testid="share-link">{shareLink(st.room!)}</code>
                  <button type="button" onClick={() => copyAs('link', shareLink(st.room!))} aria-label="Copier le lien" title="Copier">
                    {copied === 'link' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <div className={s.field}>
                  <span>Mot de passe</span>
                  <code data-testid="share-password">{st.password}</code>
                  <button type="button" onClick={() => copyAs('pass', st.password!)} aria-label="Copier le mot de passe" title="Copier">
                    {copied === 'pass' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
              <button type="button" className={s.ghost} onClick={() => copyAs('both', `${shareLink(st.room!)}\nMot de passe : ${st.password}`)}>
                {copied === 'both' ? <Check size={14} /> : <Copy size={14} />} {copied === 'both' ? 'Copiés' : 'Copier lien et mot de passe'}
              </button>
              <ModeSwitch name="share-mode-live" value={st.mode} onChange={(m) => updateShareSettings({ mode: m })} />
              <KeepSwitch checked={st.keep} onChange={(v) => updateShareSettings({ keep: v })} />
              <ul className={s.guests} data-testid="share-guests">
                {st.guests.length === 0 && <li className={s.muted}>Personne pour l’instant</li>}
                {st.guests.map((g) => (
                  <li key={g.id}>
                    <i className={s.avatar} aria-hidden="true">{g.name.charAt(0).toUpperCase()}</i>
                    <span>{g.name}</span>
                    <button type="button" onClick={() => kickGuest(g.id)} aria-label={`Exclure ${g.name}`} title="Exclure">
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className={s.stop} onClick={stopHosting} data-testid="share-stop">
                Fermer le partage
              </button>
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
