import { useEffect, useRef, useState } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { preloadGoogle, signIn, signOut, syncAll, useCloud } from '../../store/cloud';
import { Button } from '../../ui/Button';
import s from './Account.module.css';

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Compte Google (synchronisation des projets dans Drive). N'apparaît que si l'application a un
 * identifiant Google configuré. La connexion part directement du clic (exigence de Safari).
 */
export function AccountButton({ className }: { className?: string }) {
  const { enabled, user, connected, status, lastSync, error } = useCloud();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  if (!enabled) return null;

  if (!user)
    return (
      <button
        type="button"
        className={[s.signIn, className].join(' ')}
        // Le script de Google se charge à l'approche du pointeur : le clic ouvre aussitôt la fenêtre de connexion.
        onPointerEnter={() => void preloadGoogle().catch(() => undefined)}
        onFocus={() => void preloadGoogle().catch(() => undefined)}
        onClick={() => signIn()}
        title="Retrouver vos projets sur tous vos ordinateurs (Google Drive)"
        data-testid="account-signin"
      >
        <Cloud size={15} strokeWidth={1.3} /> Se connecter
      </button>
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
          <div className={s.actions}>
            {connected ? (
              <Button size="sm" variant="outline" icon={<RefreshCw size={13} strokeWidth={1.4} />} disabled={status === 'syncing'} onClick={() => void syncAll()}>
                Synchroniser
              </Button>
            ) : (
              <Button size="sm" variant="outline" icon={<Cloud size={13} strokeWidth={1.4} />} onClick={() => signIn()}>
                Se reconnecter
              </Button>
            )}
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
