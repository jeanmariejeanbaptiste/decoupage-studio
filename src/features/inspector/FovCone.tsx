/** Schéma en cône de l'angle de champ horizontal (vue de dessus). */
export function FovCone({ degrees, secondary, size = 120 }: { degrees: number; secondary?: number; size?: number }) {
  const cx = size / 2;
  const cy = size - 10;
  const r = size - 22;
  const path = (deg: number) => {
    const a = Math.min(170, deg) * (Math.PI / 180) * 0.5;
    const x1 = cx - Math.sin(a) * r;
    const y1 = cy - Math.cos(a) * r;
    const x2 = cx + Math.sin(a) * r;
    return `M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y1.toFixed(1)} Z`;
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Angle de champ horizontal ${degrees.toFixed(1)} degrés`}>
      <path d={path(degrees)} fill="var(--tint)" stroke="var(--rust)" strokeWidth="1.25" />
      {secondary !== undefined && <path d={path(secondary)} fill="none" stroke="var(--navy)" strokeWidth="1" strokeDasharray="3 3" />}
      <rect x={cx - 7} y={cy - 3} width="14" height="9" rx="1.5" fill="var(--ink)" />
      <text x={cx} y={14} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="16" fill="var(--rust)">
        {degrees.toFixed(0)}°
      </text>
    </svg>
  );
}
