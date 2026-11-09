import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, MessageSquare, PenLine, QrCode, Users, X } from 'lucide-react';
import { QrScreen } from './QrScreen';
import { navigate, useLocation } from '../../app/router';
import { joinSession, kickGuest, leaveSession, shareLink, startHosting, stopHosting, updateShareSettings, useShare, type ShareMode } from '../../store/share';
import { useDoc } from '../../store/projectStore';
import { preloadGoogle } from '../../store/cloud';
import { syncReview } from '../../store/review';
import { ReviewSection } from '../review/Review';
import { Button } from '../../ui/Button';
import s from './Share.module.css';

const copy = async (text: string) => {
  await navigator.clipboard.writeText(text).catch(() => undefined);
};

/** Choix « modifier / relire (commenter) / lire seulement ». */
function ModeSwitch({ name, value, onChange }: { name: string; value: ShareMode; onChange: (m: ShareMode) => void }) {
  return (
    <div className={s.seg} role="radiogroup" aria-label="Les invités peuvent">
      <label className={value === 'edit' ? s.on : ''}>
        <input type="radio" name={name} checked={value === 'edit'} onChange={() => onChange('edit')} />
        <PenLine size={14} strokeWidth={1.25} /> Modifier
      </label>
      <label className={value === 'review' ? s.on : ''}>
        <input type="radio" name={name} checked={value === 'review'} onChange={() => onChange('review')} />
        <MessageSquare size={14} strokeWidth={1.25} /> Commenter
      </label>
      <label className={value === 'read' ? s.on : ''}>
        <input type="radio" name={name} checked={value === 'read'} onChange={() => onChange('read')} />
        <Eye size={14} strokeWidth={1.25} /> Lire seulement
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
  const [qr, setQr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || qr) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, qr]);
  if (!doc || st.role === 'guest') return null;
  const hosting = st.role === 'host' && st.status !== 'opening';
  const copyAs = (key: string, text: string) => {
    void copy(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };
  const link = st.room ? shareLink(st.room) : '';
  return (
    <div className={s.wrap} ref={ref}>
      <button
        type="button"
        className={s.trigger}
        // Connexion Google prête avant le clic sur « Publier » (la fenêtre de Google doit s'ouvrir au clic).
        onPointerEnter={() => void preloadGoogle().catch(() => undefined)}
        onClick={() => {
          if (!open) void syncReview();
          setOpen(!open);
        }}
        aria-expanded={open}
        data-testid="share-button"
      >
        {hosting ? <i className={s.liveDot} aria-hidden="true" /> : <Users size={15} strokeWidth={1.25} />}
        {hosting ? `Partagé${st.guests.length ? ` · ${st.guests.length}` : ''}` : 'Partager'}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="Partager le projet" data-testid="share-panel">
          {!hosting ? (
            <>
              <ModeSwitch name="share-mode" value={mode} onChange={setMode} />
              <KeepSwitch checked={keep} onChange={setKeep} />
              {st.status === 'error' && <p className={s.error}>{st.error}</p>}
              <Button variant="primary" className={s.block} disabled={st.status === 'opening'} onClick={() => void startHosting({ mode, keep })} data-testid="share-start">
                {st.status === 'opening' ? 'Ouverture…' : 'Ouvrir le partage'}
              </Button>
              <p className={s.note}>Le partage reste ouvert tant que cette page est ouverte.</p>
              <ReviewSection doc={doc} />
            </>
          ) : (
            <>
              <div className={s.secret}>
                <div className={s.field}>
                  <span>Lien</span>
                  <code data-testid="share-link">{link}</code>
                  <button type="button" onClick={() => copyAs('link', link)} aria-label="Copier le lien" title="Copier">
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
              <div className={s.actions}>
                <Button size="sm" icon={copied === 'both' ? <Check size={14} /> : <Copy size={14} strokeWidth={1.25} />} onClick={() => copyAs('both', `${link}\nMot de passe : ${st.password}`)}>
                  {copied === 'both' ? 'Copiés' : 'Copier lien et mot de passe'}
                </Button>
                <Button size="sm" icon={<QrCode size={14} strokeWidth={1.25} />} onClick={() => setQr(true)} data-testid="share-qr">
                  QR code
                </Button>
              </div>
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
              <Button variant="outline" className={s.block} onClick={stopHosting} data-testid="share-stop">
                Fermer le partage
              </Button>
              <ReviewSection doc={doc} />
            </>
          )}
        </div>
      )}
      {qr && hosting && st.password && <QrScreen link={link} password={st.password} onClose={() => setQr(false)} />}
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
  if (st.role !== 'guest' || st.status !== 'joined') return null;
  return (
    <div className={s.banner} role="status" data-testid="guest-banner">
      <span>
        Projet partagé par <b>{st.hostName}</b> · {st.mode === 'read' ? 'lecture seule' : st.mode === 'review' ? 'relecture' : 'modification'}
        {st.guests.length > 1 ? ` · ${st.guests.length} personnes connectées` : ''}
        {st.keep ? '' : ' · rien n’est enregistré sur cet ordinateur'}
      </span>
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
