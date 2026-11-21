import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { qrPath } from './qr';
import s from './Share.module.css';

/** QR code du lien, en plein écran (à montrer à l'équipe), avec le mot de passe en grand s'il y en a un. */
export function QrScreen({ link, password, label = 'QR code du partage', onClose }: { link: string; password?: string; label?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Les parents passent une fonction neuve à chaque rendu (l'arrivée d'un invité en provoque un) :
  // le plein écran ne doit pas se refermer pour autant.
  const close = useRef(onClose);
  close.current = onClose;
  const { size, path } = useMemo(() => qrPath(link), [link]);
  useEffect(() => {
    const el = ref.current;
    let entered = false;
    // Vrai plein écran quand le navigateur le permet ; sinon, l'écran recouvre la fenêtre.
    el?.requestFullscreen?.().then(() => (entered = true)).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    const onFs = () => entered && !document.fullscreenElement && close.current();
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    el?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  return createPortal(
    <div ref={ref} className={s.qrScreen} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} data-testid="share-qr-screen">
      <button type="button" className={s.qrClose} onClick={onClose} aria-label="Fermer">
        <X size={22} strokeWidth={1.25} />
      </button>
      <svg className={s.qrCode} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code : ${link}`}>
        <rect width={size} height={size} fill="#fff" />
        <path d={path} fill="#000" />
      </svg>
      {password && (
        <p className={s.qrPass}>
          <span>Mot de passe</span>
          <b data-testid="share-qr-password">{password}</b>
        </p>
      )}
      <p className={s.qrLink}>{link}</p>
    </div>,
    document.body,
  );
}
