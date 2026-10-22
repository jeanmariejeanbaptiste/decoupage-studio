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
    body = (
      <g>
        <rect x={W / 2 - 22} y={30} width={44} height={30} rx={3} className="fi-object" />
        <path d={`M ${W / 2 - 40} ${H} C ${W / 2 - 30} 66, ${W / 2 - 18} 62, ${W / 2 - 6} 64`} className="fi-line" />
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
