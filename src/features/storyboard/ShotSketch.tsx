import { useMemo, type ReactNode } from 'react';
import { horizontalFov } from '../../domain/focal';
import { backdropFor, iconSpec, isPersonSubject, type IconSpec, type ObjectKind } from '../../domain/thumbnail';
import type { ProjectDoc, Shot } from '../../domain/types';

/**
 * Icône provisoire d'un plan sans image : quelques traits fins, sans couleur, qui combinent la valeur
 * de cadre, l'axe, la hauteur, le mouvement, la focale, l'ouverture, INT/EXT et le sujet.
 */
export function ShotSketch({ doc, shot, ratio }: { doc: ProjectDoc; shot: Shot; ratio: number }) {
  const st = doc.project.settings;
  const seq = doc.sequences[shot.sequenceId];
  const decor = seq?.decorId ? doc.decors[seq.decorId] : undefined;
  const spec = useMemo(
    () =>
      iconSpec({
        value: shot.value,
        angle: shot.angle,
        movement: shot.movement,
        focal: shot.focal.from,
        // L'ouverture n'agit que si sa colonne est affichée dans le découpage.
        aperture: st.gridColumns.includes('aperture') ? shot.aperture : undefined,
        subject: shot.subject,
        person: isPersonSubject(shot.subject, Object.values(doc.characters).map((c) => c.name)),
        backdrop: backdropFor(seq?.intExt ?? decor?.intExt, `${decor?.name ?? ''} ${seq?.label ?? ''}`),
        seed: shot.id,
      }),
    [shot, st.gridColumns, doc.characters, seq?.intExt, seq?.label, decor?.intExt, decor?.name],
  );
  const H = 90;
  const W = Math.round(H * ratio);
  const horizon = { eye: 0.42, high: 0.16, low: 0.8, top: -1 }[spec.height] * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="shot-icon" aria-hidden="true" preserveAspectRatio="xMidYMid meet" data-testid="shot-sketch">
      <g transform={spec.roll ? `rotate(-8 ${W / 2} ${H / 2})` : undefined}>
        <g className="si-back" opacity={1 - spec.soft * 0.65} strokeDasharray={spec.soft > 0.35 ? '1.5 2' : undefined}>
          {spec.object ? <line x1={0} x2={W} y1={H * 0.72} y2={H * 0.72} /> : spec.valueKey !== 'tres_gros_plan' && <Backdrop spec={spec} W={W} H={H} horizon={horizon} />}
        </g>
        {spec.object ? <ObjectIcon kind={spec.object} cx={W / 2} cy={H * 0.48} size={H * 0.7} high={spec.height === 'high' || spec.height === 'top'} /> : <Figure spec={spec} W={W} H={H} />}
      </g>
      {spec.move && <MoveIcon m={spec.move} W={W} H={H} />}
      {shot.focal.from !== undefined && <FovBadge W={W} fov={horizontalFov(shot.focal.from, st.cropFactor || 1)} mm={shot.focal.from} />}
    </svg>
  );
}

/** Sol en perspective (plus ouvert au grand-angle), puis le décor posé sur l'horizon. */
function Backdrop({ spec, W, H, horizon }: { spec: IconSpec; W: number; H: number; horizon: number }) {
  const out: ReactNode[] = [];
  const top = spec.height === 'top';
  if (!top && horizon > 0 && horizon < H) {
    out.push(<line key="h" x1={0} x2={W} y1={horizon} y2={horizon} />);
    const spread = W * (0.25 + spec.wide * 1.4);
    for (const k of [-1, 1]) out.push(<line key={`p${k}`} x1={W / 2 + k * W * 0.08} y1={horizon} x2={W / 2 + k * spread} y2={H} className="si-faint" />);
  }
  if (top) {
    // Vue du dessus : quadrillage du sol.
    for (let x = W / 6; x < W; x += W / 6) out.push(<line key={`x${x}`} x1={x} x2={x} y1={0} y2={H} className="si-faint" />);
    return <>{out}</>;
  }
  const v = spec.variant;
  const left = v % 2 === 0;
  const tightness = Math.max(0.35, Math.min(1, 40 / (spec.window[1] - spec.window[0])));
  const base = Math.min(H, horizon);
  if (spec.backdrop === 'interior') {
    const x = left ? W * 0.12 : W * 0.7;
    const w = W * 0.16 * tightness * 1.4;
    const h = H * 0.42 * tightness * 1.2;
    if (v % 3 === 0) out.push(<rect key="d" x={x} y={base - h} width={w} height={h} />);
    else out.push(<rect key="w" x={x} y={base - h * 1.15} width={w * 1.3} height={h * 0.6} />, <line key="w2" x1={x + w * 0.65} x2={x + w * 0.65} y1={base - h * 1.15} y2={base - h * 0.55} />);
  } else if (spec.backdrop === 'street') {
    let x = -W * 0.05;
    let k = 0;
    while (x < W) {
      const bw = W * (0.14 + ((v >> k) % 5) * 0.03);
      const bh = H * (0.28 + ((v >> (k + 3)) % 4) * 0.08);
      out.push(<rect key={`b${k}`} x={x} y={base - bh} width={bw} height={bh} />);
      out.push(<line key={`bw${k}`} x1={x + bw * 0.3} x2={x + bw * 0.3} y1={base - bh * 0.8} y2={base - bh * 0.6} className="si-faint" />);
      x += bw + W * 0.02;
      k++;
    }
  } else {
    out.push(<path key="hill" d={`M0 ${base - H * 0.06} Q ${W * 0.3} ${base - H * 0.2} ${W * 0.55} ${base - H * 0.05} T ${W} ${base - H * 0.1}`} />);
    const tx = left ? W * 0.18 : W * 0.8;
    const r = H * 0.08 * tightness * 1.5;
    out.push(<circle key="tc" cx={tx} cy={base - r * 2.6} r={r} />, <line key="tt" x1={tx} x2={tx} y1={base - r * 1.6} y2={base} />);
  }
  return <>{out}</>;
}

/**
 * Silhouette au trait, cadrée par la valeur : tête, épaules, buste et jambes en contour ; traits du
 * visage seulement de face ou de trois-quarts, et assez grands pour être lus.
 */
function Figure({ spec, W, H }: { spec: IconSpec; W: number; H: number }) {
  const [top, bottom] = spec.window;
  const k = H / (bottom - top);
  const cx = W / 2;
  const y = (v: number) => (v - top) * k;
  const s = (v: number) => v * k;
  const narrow = spec.axis === 'profil' ? 0.55 : spec.axis === 'tq' || spec.axis === 'tqdos' ? 0.82 : 1;
  const bw = (v: number) => s(v) * narrow;
  // Plongée : la tête paraît plus grande que le corps ; contre-plongée : l'inverse.
  const headR = s(7.5) * (spec.height === 'high' ? 1.12 : spec.height === 'low' ? 0.9 : 1);
  const body = `M ${cx - bw(13)} ${y(23)} Q ${cx} ${y(16)} ${cx + bw(13)} ${y(23)} L ${cx + bw(10.5)} ${y(55)} L ${cx + bw(8)} ${y(100)} M ${cx + bw(2)} ${y(100)} L ${cx} ${y(62)} L ${cx - bw(2)} ${y(100)} M ${cx - bw(8)} ${y(100)} L ${cx - bw(10.5)} ${y(55)} L ${cx - bw(13)} ${y(23)}`;
  const face = spec.axis === 'face' || spec.axis === 'tq' || spec.axis === 'profil';
  const off = spec.axis === 'tq' ? spec.side * headR * 0.3 : 0;
  const hy = y(8);
  if (spec.valueKey === 'tres_gros_plan') {
    // Très gros plan : les yeux.
    const eye = (ex: number) => (
      <g key={ex}>
        <path d={`M ${ex - W * 0.16} ${H / 2} Q ${ex} ${H * 0.22} ${ex + W * 0.16} ${H / 2} Q ${ex} ${H * 0.74} ${ex - W * 0.16} ${H / 2} Z`} />
        <circle cx={ex} cy={H / 2} r={H * 0.13} />
        <circle cx={ex} cy={H / 2} r={H * 0.05} className="si-dot" />
      </g>
    );
    return <g className="si-fig">{spec.axis === 'profil' ? eye(W / 2) : [eye(W * 0.28), eye(W * 0.72)]}</g>;
  }
  return (
    <g className="si-fig">
      <path d={body} />
      <line x1={cx - s(3)} x2={cx - s(3)} y1={y(14.5)} y2={y(18.5)} />
      <line x1={cx + s(3)} x2={cx + s(3)} y1={y(14.5)} y2={y(18.5)} />
      <circle cx={cx} cy={hy} r={headR} />
      {spec.axis === 'profil' && <path d={`M ${cx + spec.side * headR * 0.97} ${hy - headR * 0.2} L ${cx + spec.side * headR * 1.22} ${hy + headR * 0.12} L ${cx + spec.side * headR * 0.93} ${hy + headR * 0.32}`} />}
      {face && headR > 4 && (
        <>
          {spec.axis !== 'profil' && <circle cx={cx + off - headR * 0.35} cy={hy - headR * 0.08} r={headR * 0.07} className="si-dot" />}
          <circle cx={cx + (spec.axis === 'profil' ? spec.side * headR * 0.55 : off + headR * 0.35)} cy={hy - headR * 0.08} r={headR * 0.07} className="si-dot" />
          <path d={`M ${cx + off - headR * 0.22} ${hy + headR * 0.42} Q ${cx + off} ${hy + headR * 0.52} ${cx + off + headR * 0.22} ${hy + headR * 0.42}`} transform={spec.axis === 'profil' ? `translate(${spec.side * headR * 0.5} 0)` : undefined} />
        </>
      )}
      {(spec.axis === 'dos' || spec.axis === 'tqdos') && headR > 4 && <path d={`M ${cx - headR * 0.7} ${hy + headR * 0.45} Q ${cx} ${hy + headR * 0.75} ${cx + headR * 0.7} ${hy + headR * 0.45}`} className="si-faint" />}
    </g>
  );
}

/** Glyphe du mouvement de caméra, discret, en bas à gauche. */
function MoveIcon({ m, H }: { m: NonNullable<IconSpec['move']>; W: number; H: number }) {
  const x = 10;
  const y = H - 10;
  const d: Record<NonNullable<IconSpec['move']>, string> = {
    right: `M ${x - 6} ${y} L ${x + 6} ${y} M ${x + 3} ${y - 3} L ${x + 6} ${y} L ${x + 3} ${y + 3}`,
    left: `M ${x + 6} ${y} L ${x - 6} ${y} M ${x - 3} ${y - 3} L ${x - 6} ${y} L ${x - 3} ${y + 3}`,
    up: `M ${x} ${y + 6} L ${x} ${y - 6} M ${x - 3} ${y - 3} L ${x} ${y - 6} L ${x + 3} ${y - 3}`,
    down: `M ${x} ${y - 6} L ${x} ${y + 6} M ${x - 3} ${y + 3} L ${x} ${y + 6} L ${x + 3} ${y + 3}`,
    in: `M ${x - 6} ${y - 5} L ${x - 2} ${y - 1} M ${x + 6} ${y - 5} L ${x + 2} ${y - 1} M ${x - 6} ${y + 5} L ${x - 2} ${y + 1} M ${x + 6} ${y + 5} L ${x + 2} ${y + 1}`,
    out: `M ${x - 2} ${y - 1} L ${x - 6} ${y - 5} M ${x + 2} ${y - 1} L ${x + 6} ${y - 5} M ${x - 2} ${y + 1} L ${x - 6} ${y + 5} M ${x + 2} ${y + 1} L ${x + 6} ${y + 5}`,
    around: `M ${x - 6} ${y} A 6 3 0 1 0 ${x} ${y - 3} M ${x - 2} ${y - 5} L ${x} ${y - 3} L ${x - 2} ${y - 1}`,
    shake: `M ${x - 6} ${y} L ${x - 3} ${y - 3} L ${x} ${y + 3} L ${x + 3} ${y - 3} L ${x + 6} ${y}`,
  };
  return <path d={d[m]} className="si-move" />;
}

function FovBadge({ W, fov, mm }: { W: number; fov: number; mm: number }) {
  const r = 9;
  const a = (Math.min(170, fov) * Math.PI) / 360;
  return (
    <g transform={`translate(${W - 13} 22)`}>
      <path d={`M 0 0 L ${-r * Math.sin(a)} ${-r * Math.cos(a)} A ${r} ${r} 0 0 1 ${r * Math.sin(a)} ${-r * Math.cos(a)} Z`} className="si-fov" />
      <text x={0} y={-r - 3} textAnchor="middle" className="si-mm">
        {mm}
      </text>
    </g>
  );
}

/** Objets d'insert, au trait, dans un repère de 100 unités. */
function ObjectIcon({ kind, cx, cy, size, high }: { kind: ObjectKind; cx: number; cy: number; size: number; high: boolean }) {
  const d: Record<ObjectKind, string> = {
    pot: 'M-18 10 L18 10 L14 46 L-14 46 Z M-22 4 L22 4 L22 10 L-22 10 Z M0 4 C0 -14 -4 -24 -3 -34 M-3 -34 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M1 -4 C8 -14 16 -18 22 -22',
    mug: 'M-20 -18 L20 -18 L17 32 L-17 32 Z M20 -6 Q36 -4 32 10 Q29 20 18 18 M-6 -28 q-5 -7 0 -14 M6 -30 q-5 -7 0 -14',
    book: 'M-42 -24 L0 -16 L42 -24 L42 28 L0 36 L-42 28 Z M0 -16 L0 36',
    phone: 'M-18 -38 h36 a6 6 0 0 1 6 6 v64 a6 6 0 0 1 -6 6 h-36 a6 6 0 0 1 -6 -6 v-64 a6 6 0 0 1 6 -6 Z M-6 32 h12',
    poster: 'M-32 -44 h64 v88 h-64 Z M0 -12 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0 M-18 22 Q0 2 18 22',
    hand: 'M-26 44 L-21 4 Q-23 -6 -15 -8 L-14 -32 Q-13 -38 -8 -38 Q-3 -38 -3 -32 L-2 -10 L0 -40 Q1 -46 6 -46 Q11 -46 11 -40 L11 -10 L14 -34 Q15 -39 20 -39 Q24 -38 24 -33 L22 -6 L26 -24 Q28 -28 32 -27 Q35 -25 34 -20 L28 14 Q24 34 12 44',
    key: 'M-26 0 m-14 0 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0 M-12 -3 L38 -3 L38 3 L30 3 L30 11 L24 11 L24 3 L-12 3',
    glass: 'M-18 -38 L18 -38 L14 0 Q0 9 -14 0 Z M0 6 L0 34 M-14 38 L14 38',
    letter: 'M-40 -26 h80 v52 h-80 Z M-40 -26 L0 6 L40 -26',
    lamp: 'M-22 -10 L22 -10 L13 -40 L-13 -40 Z M0 -10 L0 32 M-16 36 L16 36',
    car: 'M-46 12 L-44 -2 L-28 -6 L-16 -20 L16 -20 L30 -6 L46 -2 L46 12 Z M-26 12 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M26 12 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
  };
  const k = size / 100;
  return <path d={d[kind]} transform={`translate(${cx} ${cy}) scale(${k} ${k * (high ? 0.8 : 1)})`} className="si-fig" data-object={kind} />;
}
