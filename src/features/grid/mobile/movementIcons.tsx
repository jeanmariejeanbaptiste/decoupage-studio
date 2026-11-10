import type { ReactNode } from 'react';

/** Caméra vue de dessus (boîtier et champ), posée en (x, y). */
const cam = (y: number, fov = 7, x = 20) => (
  <>
    <rect x={x - 4} y={y} width="8" height="7" rx="1.6" />
    <path d={`M${x - 2.4} ${y} L${x - 7} ${y - fov} M${x + 2.4} ${y} L${x + 7} ${y - fov}`} />
  </>
);

/** Pictogrammes des mouvements, au trait (40 × 40), d'après la feuille Mouvement des maquettes. */
const ICONS: Record<string, ReactNode> = {
  fixe: (
    <>
      {cam(13, 8)}
      <path d="M20 20.5 L13 32 M20 20.5 L27 32 M20 20.5 L20 33" />
    </>
  ),
  pano: (
    <>
      {cam(22)}
      <path d="M7.6 20.4 A14 14 0 0 1 32.4 20.4" />
      <path d="M32.6 16.8 L32.4 20.4 L29.3 18.6" />
    </>
  ),
  tilt: (
    <>
      <rect x="9" y="16.5" width="10" height="7" rx="1.6" />
      <path d="M19 18.4 L24 15 M19 21.6 L24 25" />
      <path d="M26.4 8.3 A21 21 0 0 1 26.4 31.7" />
      <path d="M29.7 30.2 L26.4 31.7 L26.6 28.1" />
    </>
  ),
  trav_avant: (
    <>
      {cam(18, 8)}
      <path d="M8 32 L8 8" />
      <path d="M6.1 11.1 L8 8 L9.9 11.1" />
      <path d="M32 32 L32 8" />
      <path d="M30.1 11.1 L32 8 L33.9 11.1" />
    </>
  ),
  trav_arriere: (
    <>
      {cam(18, 8)}
      <path d="M8 8 L8 32" />
      <path d="M9.9 28.9 L8 32 L6.1 28.9" />
      <path d="M32 8 L32 32" />
      <path d="M33.9 28.9 L32 32 L30.1 28.9" />
    </>
  ),
  trav_lateral: (
    <>
      {cam(13)}
      <path d="M7 30 L33 30" />
      <path d="M29.9 28.1 L33 30 L29.9 31.9" />
      <path d="M7 34 H33" opacity=".45" />
    </>
  ),
  trav_circulaire: (
    <>
      <circle className="f" cx="20" cy="18" r="2.2" />
      <path d="M26.1 29.5 A13 13 0 1 0 13.9 29.5" />
      <path d="M12.1 26.4 L13.9 29.5 L10.3 29.7" />
      <rect x="16" y="33" width="8" height="7" rx="1.6" />
    </>
  ),
  trav_vertical: (
    <>
      <rect x="16" y="16.5" width="10" height="7" rx="1.6" />
      <path d="M26 18.4 L32 15 M26 21.6 L32 25" />
      <path d="M9 20 L9 7" />
      <path d="M7.1 10.1 L9 7 L10.9 10.1" />
      <path d="M9 20 L9 33" />
      <path d="M10.9 29.9 L9 33 L7.1 29.9" />
    </>
  ),
  zoom_avant: (
    <>
      <rect x="6" y="9" width="28" height="22" rx="1.6" />
      <rect x="15" y="16" width="10" height="8" rx="1" opacity=".55" />
      <path d="M8.5 11.5 L13.2 14.8" />
      <path d="M11.8 11.5 L13.2 14.8 L9.6 14.6" />
      <path d="M31.5 11.5 L26.8 14.8" />
      <path d="M30.4 14.6 L26.8 14.8 L28.2 11.5" />
      <path d="M8.5 28.5 L13.2 25.2" />
      <path d="M9.6 25.4 L13.2 25.2 L11.8 28.5" />
      <path d="M31.5 28.5 L26.8 25.2" />
      <path d="M28.2 28.5 L26.8 25.2 L30.4 25.4" />
    </>
  ),
  zoom_arriere: (
    <>
      <rect x="6" y="9" width="28" height="22" rx="1.6" opacity=".55" />
      <rect x="15" y="16" width="10" height="8" rx="1" />
      <path d="M13.2 14.8 L8.2 11.3" />
      <path d="M9.6 14.6 L8.2 11.3 L11.8 11.5" />
      <path d="M26.8 14.8 L31.8 11.3" />
      <path d="M28.2 11.5 L31.8 11.3 L30.4 14.6" />
      <path d="M13.2 25.2 L8.2 28.7" />
      <path d="M11.8 28.5 L8.2 28.7 L9.6 25.4" />
      <path d="M26.8 25.2 L31.8 28.7" />
      <path d="M30.4 25.4 L31.8 28.7 L28.2 28.5" />
    </>
  ),
  suivi: (
    <>
      <circle className="f" cx="20" cy="12" r="2.4" />
      <path d="M20 8 L20 3.5" />
      <path d="M18.1 6.6 L20 3.5 L21.9 6.6" />
      {cam(27)}
      <path d="M20 17 V19" opacity=".5" />
    </>
  ),
  epaule: (
    <>
      {cam(13, 8)}
      <path d="M7 30 q3.25 -4 6.5 0 t6.5 0 t6.5 0 t6.5 0" />
    </>
  ),
  steadicam: (
    <>
      {cam(9, 6)}
      <path d="M20 16 V30" />
      <rect x="16" y="30" width="8" height="3.4" rx="1" />
      <path d="M20 23 H31 M31 19 V27" />
    </>
  ),
  drone: (
    <>
      <rect x="16.5" y="16.5" width="7" height="7" rx="1.6" />
      <path d="M16.5 16.5 L12.2 12.2 M23.5 16.5 L27.8 12.2 M16.5 23.5 L12.2 27.8 M23.5 23.5 L27.8 27.8" />
      <circle cx="9.6" cy="9.6" r="4.3" />
      <circle cx="30.4" cy="9.6" r="4.3" />
      <circle cx="9.6" cy="30.4" r="4.3" />
      <circle cx="30.4" cy="30.4" r="4.3" />
    </>
  ),
  grue: (
    <>
      <path d="M6 34 H16 M11 34 V25" />
      <path d="M5 29 L28 13" />
      <rect x="2.6" y="27.4" width="4.6" height="4.6" rx="1" transform="rotate(-35 4.9 29.7)" />
      <rect x="24.5" y="13" width="8" height="6" rx="1.4" />
      <path d="M32.5 14.6 L37 11.6 M32.5 17.4 L37 20.4" />
    </>
  ),
};

/** Sens d'un mouvement : le pictogramme de base, retourné ou renversé. */
const FLIP: Record<string, string> = {
  pano_gauche: 'scale(-1 1)',
  trav_lateral_gauche: 'scale(-1 1)',
  tilt_down: 'scale(1 -1)',
  boom_down: 'scale(1 -1)',
};

export function MovementIcon({ tile, way, className }: { tile: string; way?: string; className?: string }) {
  const icon = ICONS[tile];
  if (!icon) return null;
  const flip = way ? FLIP[way] : undefined;
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      {flip ? <g transform={`translate(20 20) ${flip} translate(-20 -20)`}>{icon}</g> : icon}
    </svg>
  );
}
