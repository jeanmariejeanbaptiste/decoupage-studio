import { horizontalFov } from '../../domain/focal';
import { SHOT_VALUES, matchVocab } from '../../domain/vocabulary';

/**
 * Part visible de la silhouette (hauteur 0 = sommet du crâne, 100 = pieds) pour chaque valeur de cadre :
 * [haut, bas] de la fenêtre, en unités de silhouette.
 */
const WINDOW: Record<string, [number, number]> = {
  general: [-160, 230],
  ensemble: [-50, 130],
  moyen: [-6, 104],
  italien: [-4, 78],
  americain: [-4, 68],
  taille: [-3, 56],
  rapproche: [-3, 36],
  gros_plan: [-3, 27],
  tres_gros_plan: [4, 12],
};

/** Pictogramme d'une case vide : la valeur de cadre (silhouette cadrée) et l'angle de champ de la focale. */
export function FramingIcon({ value, focal, ratio }: { value: string; focal?: number; ratio: number }) {
  const key = matchVocab(value, SHOT_VALUES)?.key;
  const H = 90;
  const W = Math.round(H * ratio);
  const fov = focal ? horizontalFov(focal) : undefined;
  let body;
  if (key === 'insert') {
    // Insert : un objet en gros plan, ici un pot de fleur.
    const cx = W / 2;
    const petals = [0, 72, 144, 216, 288].map((a) => [cx - 3 + 6 * Math.cos((a * Math.PI) / 180), 24 + 6 * Math.sin((a * Math.PI) / 180)]);
    body = (
      <g>
        <path d={`M ${cx} 58 C ${cx} 48, ${cx - 4} 38, ${cx - 3} 28`} className="fi-line" />
        <path d={`M ${cx + 1} 56 C ${cx + 6} 46, ${cx + 14} 40, ${cx + 18} 36`} className="fi-line" />
        <ellipse cx={cx - 9} cy={47} rx={8} ry={3.2} transform={`rotate(-30 ${cx - 9} 47)`} className="fi-object" />
        <ellipse cx={cx + 19} cy={34} rx={6} ry={2.6} transform={`rotate(-40 ${cx + 19} 34)`} className="fi-object" />
        {petals.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={4} className="fi-object" />
        ))}
        <circle cx={cx - 3} cy={24} r={3.2} className="fi-object" style={{ fill: 'var(--paper)' }} />
        <rect x={cx - 19} y={58} width={38} height={7} rx={1.5} className="fi-object" />
        <path d={`M ${cx - 16} 65 L ${cx + 16} 65 L ${cx + 12} 88 L ${cx - 12} 88 Z`} className="fi-object" />
      </g>
    );
  } else if (key && WINDOW[key]) {
    const [top, bottom] = WINDOW[key];
    const k = H / (bottom - top);
    const cx = W / 2;
    const y = (v: number) => (v - top) * k;
    const s = (v: number) => v * k;
    body = (
      <g>
        {key === 'general' || key === 'ensemble' ? <line x1={0} x2={W} y1={y(100)} y2={y(100)} className="fi-line" /> : null}
        <circle cx={cx} cy={y(8)} r={s(7.5)} className="fi-figure" />
        <path
          d={`M ${cx - s(13)} ${y(22)} Q ${cx} ${y(15)} ${cx + s(13)} ${y(22)} L ${cx + s(10)} ${y(55)} L ${cx + s(8)} ${y(100)} L ${cx + s(2)} ${y(100)} L ${cx} ${y(60)} L ${cx - s(2)} ${y(100)} L ${cx - s(8)} ${y(100)} L ${cx - s(10)} ${y(55)} Z`}
          className="fi-figure"
        />
        {(key === 'tres_gros_plan' || key === 'gros_plan') && (
          <>
            <circle cx={cx - s(2.6)} cy={y(7.4)} r={s(0.9)} className="fi-eye" />
            <circle cx={cx + s(2.6)} cy={y(7.4)} r={s(0.9)} className="fi-eye" />
          </>
        )}
      </g>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="framing-icon" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {body ?? <text x={W / 2} y={H / 2 + 4} textAnchor="middle" className="fi-text">?</text>}
      {fov !== undefined && (
        <g transform={`translate(${W - 14} 30)`}>
          <path d={`M 0 0 L ${-12 * Math.sin((fov * Math.PI) / 360)} ${-12 * Math.cos((fov * Math.PI) / 360)} A 12 12 0 0 1 ${12 * Math.sin((fov * Math.PI) / 360)} ${-12 * Math.cos((fov * Math.PI) / 360)} Z`} className="fi-fov" />
          <text x={0} y={-15} textAnchor="middle" className="fi-mm">
            {focal}
          </text>
        </g>
      )}
    </svg>
  );
}
