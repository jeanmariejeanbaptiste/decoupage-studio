import { useEffect, useRef, useState } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { preloadGoogle, signIn, signOut, studioSignIn, syncAll, useCloud } from '../../store/cloud';
import { Button } from '../../ui/Button';
import s from './Account.module.css';

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Compte de synchronisation : compte propre à l'outil (adresse et mot de passe), ou Google Drive si
 * l'application a un identifiant Google configuré (la connexion part alors du clic, exigence de Safari).
 */
export function AccountButton({ className }: { className?: string }) {
  const { enabled, user, connected, status, lastSync, error } = useCloud();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Connexion faite depuis le formulaire : il se referme.
  useEffect(() => setOpen(false), [user?.email]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!user)
    return (
      <div className={s.wrap} ref={ref}>
        <button
          type="button"
          className={[s.signIn, className].join(' ')}
          // Le script de Google se charge à l'approche du pointeur : le clic ouvre aussitôt sa fenêtre.
          onPointerEnter={() => enabled && void preloadGoogle().catch(() => undefined)}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Se connecter"
          title="Retrouver vos projets sur tous vos appareils"
          data-testid="account-signin"
        >
          <Cloud size={15} strokeWidth={1.3} aria-hidden="true" />
          <span className={s.label}>Se connecter</span>
        </button>
        {open && <SignInForm google={enabled} />}
      </div>
    );

  const initial = (user.name || user.email || '?').trim().charAt(0).toLocaleUpperCase('fr');
  const state = !connected ? 'Hors connexion' : status === 'syncing' ? 'Synchronisation…' : status === 'error' ? (error ?? 'Erreur de synchronisation') : lastSync ? `Synchronisé à ${time(lastSync)}` : 'Connecté';
  return (
    <div className={[s.wrap, className].join(' ')} ref={ref}>
      <button type="button" className={[s.avatar, status === 'syncing' ? s.busy : ''].join(' ')} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Compte ${user.email}`} title={state} data-testid="account">
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initial}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Compte">
          <p className={s.name}>{user.name || user.email}</p>
          {user.name && <p className={s.mail}>{user.email}</p>}
          <p className={s.state}>{state}</p>
          {user.provider === 'studio' && !connected && <SignInForm email={user.email} />}
          <div className={s.actions}>
            {connected ? (
              <Button size="sm" variant="outline" icon={<RefreshCw size={13} strokeWidth={1.4} />} disabled={status === 'syncing'} onClick={() => void syncAll()}>
                Synchroniser
              </Button>
            ) : user.provider !== 'studio' ? (
              <Button size="sm" variant="outline" icon={<Cloud size={13} strokeWidth={1.4} />} onClick={() => signIn()}>
                Se reconnecter
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              icon={<LogOut size={13} strokeWidth={1.4} />}
              onClick={() => {
                signOut();
                setOpen(false);
              }}
            >
              Se déconnecter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Adresse et mot de passe ; « Créer un compte » bascule le même formulaire. */
function SignInForm({ google, email: known }: { google?: boolean; email?: string }) {
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState(known ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await studioSignIn(email, password, create));
    setBusy(false);
  };
  const form = (
    <form className={s.form} onSubmit={(e) => void submit(e)} data-testid="account-form">
      {!known && (
        <label className={s.field}>
          Adresse e-mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus data-testid="account-email" />
        </label>
      )}
      <label className={s.field}>
        Mot de passe
        <input
          type="password"
          autoComplete={create ? 'new-password' : 'current-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={!!known}
          data-testid="account-password"
        />
      </label>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <Button size="sm" variant="primary" type="submit" disabled={busy} data-testid="account-submit">
        {create ? 'Créer le compte' : 'Se connecter'}
      </Button>
      {!known && (
        <button type="button" className={s.link} onClick={() => (setCreate(!create), setError(null))} data-testid="account-mode">
          {create ? 'J’ai déjà un compte' : 'Créer un compte'}
        </button>
      )}
      {google && !known && (
        <Button size="sm" variant="ghost" onClick={() => signIn()} onFocus={() => void preloadGoogle().catch(() => undefined)}>
          Continuer avec Google
        </Button>
      )}
    </form>
  );
  return known ? form : <div className={s.panel} role="dialog" aria-label="Connexion">{form}</div>;
}
