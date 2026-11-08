/**
 * Icônes de la palette du plan au sol, au trait comme celles de l'interface (24 × 24, trait fin) :
 * un vrai projecteur de cinéma, une caméra à bobines, des rails de travelling.
 */
const svg = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/** Projecteur Fresnel : ailettes, boîtier, bague de lentille, volets ouverts, pied. */
export function FresnelIcon() {
  return (
    <svg {...svg}>
      <path d="M5.6 6.5V5.1M8.2 6.5V5.1M10.8 6.5V5.1" />
      <rect x="2.5" y="6.5" width="11" height="9" rx="1.8" />
      <path d="M13.5 7.7h1.8v6.6h-1.8" />
      <path d="M15.3 7.7 20.5 4.5M15.3 14.3 20.5 17.5" />
      <path d="M8 15.5V19M5 21.3 8 19l3 2.3" />
    </svg>
  );
}

/** Caméra de cinéma : deux bobines, boîtier, pare-soleil. */
export function CineCameraIcon() {
  return (
    <svg {...svg}>
      <circle cx="6.3" cy="6.6" r="3.1" />
      <circle cx="12.7" cy="6.6" r="3.1" />
      <rect x="2.5" y="10" width="13.5" height="8.5" rx="1.4" />
      <path d="M16 12.6 21.5 10v11l-5.5-2.6" />
    </svg>
  );
}

/** Rails de travelling : deux rails et leurs traverses. */
export function RailsIcon() {
  return (
    <svg {...svg}>
      <path d="M2 9h20M2 15h20M5 7.5v9M10 7.5v9M14 7.5v9M19 7.5v9" />
    </svg>
  );
}
