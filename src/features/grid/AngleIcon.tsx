// Petites têtes au trait (16 px) pour les angles de prise de vue : même
// ovale partout, seuls les repères changent (yeux, nez, oreille, nuque…).
// Toujours ce que voit la caméra.

const HEAD = <ellipse cx="8" cy="8" rx="4.4" ry="5.4" />;
const EYES = <path d="M6.2 7.6h.01M9.8 7.6h.01" />;

const ICONS: Record<string, JSX.Element> = {
  face: (
    <>
      {HEAD}
      {EYES}
      <path d="M8 8.6v1.6" />
    </>
  ),
  trois_quarts_face: (
    <>
      {HEAD}
      <path d="M5 7.6h.01M8.4 7.6h.01" />
      <path d="M6.6 8 5.4 10.3h1.1" />
      <path d="M10.6 7.2c1 .1 1 2.5 0 2.7" />
    </>
  ),
  profil_gauche: (
    <>
      {HEAD}
      <path d="M3.8 7 2.3 9.8l1.7.3" />
      <path d="M5.3 7.4h.01" />
      <path d="M9 6.8c1.1 0 1.1 2.8 0 2.8" />
    </>
  ),
  profil_droit: (
    <>
      {HEAD}
      <path d="M12.2 7l1.5 2.8-1.7.3" />
      <path d="M10.7 7.4h.01" />
      <path d="M7 6.8c-1.1 0-1.1 2.8 0 2.8" />
    </>
  ),
  trois_quarts_dos: (
    <>
      {HEAD}
      <path d="M3.9 9.2c-.9 1.2-.6 2.6.5 3.4" />
      <path d="M5.6 7c-1 .1-1 2.6 0 2.8" />
      <path d="M6.6 11.9q2.2.9 4.2-.3" />
    </>
  ),
  dos: (
    <>
      {HEAD}
      <path d="M3.6 6.8c-1 .1-1 2.7 0 2.9M12.4 6.8c1 .1 1 2.7 0 2.9" />
      <path d="M5.8 11.8q2.2 1 4.4 0" />
    </>
  ),
  hauteur_regard: (
    <>
      {HEAD}
      {EYES}
      <path d="M8 8.6v1.6" />
      <path d="M.8 7.6h2.2M13 7.6h2.2" />
    </>
  ),
  plongee: (
    <>
      {HEAD}
      <path d="M3.8 6.6q4.2 2.6 8.4 0" />
      <path d="M8 4.8h.01" />
      <path d="M6.2 10h.01M9.8 10h.01" />
      <path d="M8 10.8v.9" />
    </>
  ),
  contre_plongee: (
    <>
      {HEAD}
      <path d="M6.2 5.2h.01M9.8 5.2h.01" />
      <path d="M7.3 7.2h1.4" />
      <path d="M4.1 10.6q3.9-2.4 7.8 0" />
    </>
  ),
  top_shot: (
    <>
      <circle cx="8" cy="8.8" r="4.6" />
      <path d="M7 4.3 8 2.3l1 2" />
      <path d="M3.4 8c-.9.2-.9 1.5 0 1.7M12.6 8c.9.2.9 1.5 0 1.7" />
      <path d="M8 8.8h.01" />
    </>
  ),
  low_angle: (
    <>
      <ellipse cx="8" cy="7.4" rx="4.4" ry="5.4" />
      <path d="M6.4 3.8h.01M9.6 3.8h.01" />
      <path d="M7.4 5.2h1.2" />
      <path d="M3.8 8.4q4.2-3.2 8.4 0" />
      <path d="M1 14.8h14" />
    </>
  ),
  subjectif: (
    <>
      <path d="M1.6 8c2.6-3.9 10.2-3.9 12.8 0-2.6 3.9-10.2 3.9-12.8 0Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
};

export function AngleIcon({ k, size = 16 }: { k: string; size?: number }): JSX.Element | null {
  if (!Object.prototype.hasOwnProperty.call(ICONS, k)) return null;
  const icon = ICONS[k];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon}
    </svg>
  );
}
