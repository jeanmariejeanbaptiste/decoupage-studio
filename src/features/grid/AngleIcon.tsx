// Têtes au trait pour les angles de prise de vue, toujours vues depuis la caméra.
// La masse des cheveux (aplat léger) porte l'orientation : frange en face, arrière
// du crâne de profil, tête couverte de dos, sommet et raie en plongée, liseré en
// contre-plongée. Les épaules disent la hauteur : buste à hauteur d'homme, anneau
// vu d'en haut en plongée, ellipse autour de la tête en top shot, cou qui s'évase
// en contre-plongée, sol et flèche en low angle. Grille 24 × 24, trait 1,5.

const HAIR = { fill: 'currentColor', fillOpacity: 0.4, stroke: 'none' } as const;
const DOT = { strokeWidth: 2.2 } as const;
const EDGE = { strokeWidth: 1 } as const;

/** Cou et épaules communs aux vues de buste (gauche et droite du cou en x). */
function bust(l = 10, r = 14, top = 16.1): JSX.Element {
  return <path d={`M${l} ${top}V18.1c-3.3.3-5.9 2-6.4 5.1M${r} ${top}V18.1c3.3.3 5.9 2 6.4 5.1`} />;
}

// Face : silhouette (masse des cheveux plus large que le visage) et frange en biais.
const FACE = (
  <>
    <path {...HAIR} d="M6.4 9.4C5.6 5.2 8.2 2 12 2s6.4 3.2 5.6 7.4c-.4-1.8-1.2-3-2.4-3.6-1.8 1.4-4.6 2.2-8.8 3.6Z" />
    <path d="M6.4 9.4C5.6 5.2 8.2 2 12 2s6.4 3.2 5.6 7.4C17.6 13.8 15.2 16.8 12 16.8S6.4 13.8 6.4 9.4Z" />
    <path {...EDGE} d="M17.6 9.4c-.4-1.8-1.2-3-2.4-3.6-1.8 1.4-4.6 2.2-8.8 3.6" />
    <path d="M6.4 10.6c-.9-.3-1.3 1.9 0 2.2M17.6 10.6c.9-.3 1.3 1.9 0 2.2" />
    <path {...DOT} d="M9.8 11.2h.01M14.2 11.2h.01" />
    <path d="M10.9 14.2q1.1.5 2.2 0" />
    {bust()}
  </>
);

// Profil tourné vers la gauche ; le droit en est le miroir.
const PROFILE_LEFT = (
  <>
    <path {...HAIR} d="M7.2 5.4C8.4 3.2 9.8 2.3 11.6 2.2c3.6-.2 6.4 2.2 7 6 .4 3.2-.6 6.6-3 8.4-.4-1.2-.8-2.6-1.2-3.8l-1.8-4.2C11.4 6.6 9.4 5.6 7.2 5.4Z" />
    <path d="M15.6 16.6c2.4-1.8 3.4-5.2 3-8.4-.6-3.8-3.4-6.2-7-6C8.6 2.4 6.6 4.8 6.6 8v.8l-1.8 3 1.8.6-.2 1.2.5.6-.3.8c.2 1.2 1.2 1.6 2.6 1.4" />
    <path {...EDGE} d="M7.2 5.4c2.2.2 4.2 1.2 5.4 3.2M14.4 12.8c.4 1.2.8 2.6 1.2 3.8" />
    <ellipse cx="13.6" cy="10.8" rx="1.2" ry="1.8" />
    <path {...DOT} d="M8.6 9.6h.01" />
    <path d="M9.2 16.4l.4 2.2c-2 .6-3 2.4-3.2 4.6M15.6 16.6l-.4 1.8c2.4.6 3.8 2.4 4.2 4.8" />
  </>
);

const ICONS: Record<string, JSX.Element> = {
  face: FACE,
  trois_quarts_face: (
    <>
      <path {...HAIR} d="M7.6 6.2C8.6 3.4 11 2 13.4 2c3.6 0 5.8 2.8 5.4 7-.2 2.8-1 5-2.4 6.6-.8-.6-1.4-1.6-1.8-2.6L13 9.4C11.6 7.6 9.8 6.6 7.6 6.2Z" />
      <path d="M7.6 6.2C8.6 3.4 11 2 13.4 2c3.6 0 5.8 2.8 5.4 7-.2 2.8-1 5-2.4 6.6M7.6 6.2C7 7.4 6.9 8.6 7.2 9.6l-1.3 2.6 1.3.6c0 1.8.6 3.2 2.2 4 .6.3 1.2.4 1.8.5" />
      <path {...EDGE} d="M7.6 6.2c2.2.4 4 1.4 5.4 3.2" />
      <path d="M14.4 9.8c1.2-.6 2.2.2 2.1 1.4-.1 1.3-1 1.9-2 1.6" />
      <path {...DOT} d="M8.6 10.6h.01M11 10.6h.01" />
      <path d="M9.2 14.6h1.2" />
      <path d="M11.2 16.9v1.3c-3.4.2-6 2-6.6 5M16.4 15.6l-.2 2.6c2.6.4 4.4 2.2 4.8 5" />
    </>
  ),
  profil_gauche: PROFILE_LEFT,
  profil_droit: <g transform="matrix(-1 0 0 1 24 0)">{PROFILE_LEFT}</g>,
  trois_quarts_dos: (
    <>
      <path {...HAIR} d="M13.2 2c3.4 0 5.6 3 5.4 7.2-.2 3.8-2.2 6.8-5.2 7.4-.8-.1-1.6-.4-2.2-.8.6-1.4.8-2.8.4-4L9.6 8.8C9 8 8.4 7 8.2 5.9 9.2 3.6 11 2 13.2 2Z" />
      <path d="M13.2 2c3.4 0 5.6 3 5.4 7.2-.2 3.8-2.2 6.8-5.2 7.4M13.2 2C10.4 2 8.6 4 7.8 6.6c-.9 2-1.5 4.4-1.1 6.2.4 1.6 1.8 2.6 3.5 2.8" />
      <path {...EDGE} d="M8.2 5.9c.2 1.1.8 2.1 1.4 2.9M11.6 11.8c.4 1.2.2 2.6-.4 4" />
      <ellipse cx="10.6" cy="10.4" rx="1.1" ry="1.7" />
      <path d="M10.6 15.8v2.3c-3.3.3-5.9 2-6.4 5.1M15 16.1v2c3.3.3 5.9 2 6.4 5.1" />
    </>
  ),
  dos: (
    <>
      <path {...HAIR} d="M6 9.4C5.4 5.2 8.2 2 12 2s6.6 3.2 6 7.4c-.2 3.6-2 6.4-3.6 7.2H9.6C8 15.8 6.2 13 6 9.4Z" />
      <path d="M6 9.4C5.4 5.2 8.2 2 12 2s6.6 3.2 6 7.4c-.2 3.6-2 6.4-3.6 7.2H9.6C8 15.8 6.2 13 6 9.4Z" />
      <path d="M6 10.2c-.9-.2-1.2 2 .2 2.4M18 10.2c.9-.2 1.2 2-.2 2.4" />
      <path d="M9.8 18.4q2.2 1.2 4.4 0" />
      {bust(9.8, 14.2, 16.6)}
    </>
  ),
  hauteur_regard: (
    <>
      {FACE}
      <path d="M.9 11.2h3.3M19.8 11.2h3.3" />
    </>
  ),
  plongee: (
    <>
      <path {...HAIR} d="M5.6 11.6C5 6 8 2 12 2s7 4 6.4 9.6c-2.4 1.8-10.4 1.8-12.8 0Z" />
      <path d="M12 2c4.2 0 6.8 3.4 6.6 8-.2 4.4-3 7.4-6.6 7.4S5.6 14.4 5.4 10C5.2 5.4 7.8 2 12 2Z" />
      <path {...EDGE} d="M5.6 11.6c2.4 1.8 10.4 1.8 12.8 0M12.6 4.4c-.6 2.2-1.6 4-3.4 5.4" />
      <path d="M5.5 9.6c-1-.2-1.3 2 0 2.4M18.5 9.6c1-.2 1.3 2 0 2.4" />
      <path {...DOT} d="M9.8 14.6h.01M14.2 14.6h.01" />
      <path d="M6.06 13.26A10.2 4.6 0 1 0 17.94 13.26" />
    </>
  ),
  contre_plongee: (
    <>
      <path {...HAIR} d="M7.5 7.2C8 4.6 9.6 3.2 12 3.2s4 1.4 4.5 4C15.1 6.2 13.6 5.6 12 5.6s-3.1.6-4.5 1.6Z" />
      <path d="M12 3.2c-2.6 0-4.2 1.6-4.6 4-.4 2.2-1 4.2-.8 6 .4 2.2 2.8 4 5.4 4s5-1.8 5.4-4c.2-1.8-.4-3.8-.8-6-.4-2.4-2-4-4.6-4Z" />
      <path d="M9 8.2h1.6M13.4 8.2h1.6" />
      <path d="M11 11.2 12 9.4l1 1.8" />
      <path {...DOT} strokeWidth={1.8} d="M11.2 12.2h.01M12.8 12.2h.01" />
      <path d="M10.8 14.2q1.2-.3 2.4 0" />
      <path d="M7.2 14.8 6.8 18c-1.8.8-3.4 2.4-3.8 5M16.8 14.8l.4 3.2c1.8.8 3.4 2.4 3.8 5" />
    </>
  ),
  top_shot: (
    <>
      <path d="M7.6 9.2C4.4 9.8 1.8 11.4 1.8 13.4c0 2.8 4.6 5 10.2 5s10.2-2.2 10.2-5c0-2-2.6-3.6-5.8-4.2" />
      <circle {...HAIR} cx="12" cy="10.4" r="4.6" />
      <circle cx="12" cy="10.4" r="4.6" />
      <path {...EDGE} d="M13 6.4c-.2 1.8-.8 3.2-2.4 4.4" />
      <path d="M11.1 15l.9 1.7.9-1.7" />
    </>
  ),
  low_angle: (
    <>
      <path {...HAIR} d="M8.5 5C8.9 3.2 10.2 2.2 12 2.2s3.1 1 3.5 2.8c-1.2-.7-2.3-1-3.5-1s-2.3.3-3.5 1Z" />
      <path d="M12 2.2c-2 0-3.2 1.2-3.6 3-.6 2.2-2.8 3.8-2.6 6.2.2 2.2 3 4 6.2 4s6-1.8 6.2-4c.2-2.4-2-4-2.6-6.2-.4-1.8-1.6-3-3.6-3Z" />
      <path d="M9.8 6h1.2M13 6h1.2" />
      <path d="M11.1 9.4 12 7.8l.9 1.6" />
      <path {...DOT} strokeWidth={1.8} d="M11.2 10.4h.01M12.8 10.4h.01" />
      <path d="M10.8 12.6q1.2-.4 2.4 0" />
      <path d="M12 21v-3.4M10.4 19.2 12 17.6l1.6 1.6M2.4 22.4h19.2" />
    </>
  ),
  subjectif: (
    <>
      <path d="M2 7V3h4M18 3h4v4M22 17v4h-4M6 21H2v-4" />
      <path d="M5 12c2-3.6 12-3.6 14 0-2 3.6-12 3.6-14 0Z" />
      <circle {...HAIR} cx="12" cy="12" r="2.6" />
      <path {...DOT} d="M12 12h.01" />
    </>
  ),
};

export function AngleIcon({ k, size = 16 }: { k: string; size?: number }): JSX.Element | null {
  if (!Object.prototype.hasOwnProperty.call(ICONS, k)) return null;
  const icon = ICONS[k];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon}
    </svg>
  );
}
