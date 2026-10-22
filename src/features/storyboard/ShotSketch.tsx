import { useId, useMemo, type ReactNode } from 'react';
import { formatAperture } from '../../domain/focal';
import { backdropFor, buildThumbScene, isPersonSubject, type ObjectKind, type Prim, type ThumbScene } from '../../domain/thumbnail';
import type { ProjectDoc, Shot } from '../../domain/types';

/**
 * Vignette provisoire d'un plan sans image : personnage vectoriel vu par une caméra virtuelle réglée
 * d'après le découpage (valeur, angle, mouvement, focale, capteur, ouverture, INT/EXT et lieu).
 */
export function ShotSketch({ doc, shot, ratio }: { doc: ProjectDoc; shot: Shot; ratio: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const st = doc.project.settings;
  const seq = doc.sequences[shot.sequenceId];
  const decor = seq?.decorId ? doc.decors[seq.decorId] : undefined;
  // Le flou d'arrière-plan ne s'applique que si la colonne Ouverture est affichée dans le découpage.
  const dof = st.gridColumns.includes('aperture') ? shot.aperture : undefined;
  const names = useMemo(() => Object.values(doc.characters).map((c) => c.name), [doc.characters]);
  const scene = useMemo(
    () =>
      buildThumbScene({
        value: shot.value,
        angle: shot.angle,
        movement: shot.movement,
        focal: shot.focal.from,
        aperture: dof,
        crop: st.cropFactor || 1,
        ratio,
        subject: shot.subject,
        person: isPersonSubject(shot.subject, names),
        backdrop: backdropFor(seq?.intExt ?? decor?.intExt, `${decor?.name ?? ''} ${seq?.label ?? ''}`),
        seed: shot.id,
      }),
    [shot.value, shot.angle, shot.movement, shot.focal.from, dof, st.cropFactor, ratio, shot.subject, names, seq?.intExt, seq?.label, decor?.intExt, decor?.name, shot.id],
  );
  const { w, h } = scene;
  const interior = !scene.back.some((p) => p.cls === 'building' || p.cls === 'hill');
  const street = scene.back.some((p) => p.cls === 'building');
  const sky = Math.max(0, Math.min(h, scene.horizon));
  const subject = (
    <>
      {scene.subject.map(draw)}
      {scene.object && <ObjectShape {...scene.object} />}
    </>
  );
  const m = scene.motion;
  const mb = w * 0.025;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="shot-sketch" aria-hidden="true" preserveAspectRatio="xMidYMid slice" data-testid="shot-sketch">
      <defs>
        {scene.blur > 0.15 && (
          <filter id={`b${uid}`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={scene.blur} />
          </filter>
        )}
        {m && (
          <filter id={`m${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={m.kind === 'h' ? `${mb} 0` : m.kind === 'v' ? `0 ${mb}` : `${mb / 3}`} />
          </filter>
        )}
      </defs>
      <g transform={scene.roll ? `rotate(${scene.roll} ${w / 2} ${h / 2}) scale(1.2)` : undefined} style={scene.roll ? { transformOrigin: 'center' } : undefined}>
        <rect x={-w} y={-h} width={3 * w} height={h + sky} className={interior ? 'ss-wall' : 'ss-sky'} />
        <rect x={-w} y={sky} width={3 * w} height={2 * h} className={interior ? 'ss-floor' : street ? 'ss-road' : 'ss-grass'} />
        <g filter={scene.blur > 0.15 ? `url(#b${uid})` : undefined} data-blur={scene.blur.toFixed(2)}>
          {scene.back.map(draw)}
        </g>
        {m && <MotionGhosts m={m} w={w} h={h} filter={`url(#m${uid})`}>{subject}</MotionGhosts>}
        {subject}
        {m && <SpeedLines m={m} w={w} h={h} />}
      </g>
      {shot.focal.from !== undefined && <FovBadge w={w} fov={scene.fovH} mm={shot.focal.from} aperture={dof} />}
    </svg>
  );
}

function draw(p: Prim, k: number): ReactNode {
  if (p.t === 'ellipse') return <ellipse key={k} cx={p.cx} cy={p.cy} rx={Math.max(0.05, p.rx)} ry={Math.max(0.05, p.ry)} className={`ss-${p.cls}`} />;
  if (p.t === 'capsule') return <line key={k} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} strokeWidth={Math.max(0.1, p.w)} strokeLinecap="round" className={`ss-c ss-${p.cls}`} />;
  return <path key={k} d={p.d} className={`ss-${p.cls}`} />;
}

/** Copies estompées du sujet dans le sens du mouvement : flou de bougé. */
function MotionGhosts({ m, w, h, filter, children }: { m: NonNullable<ThumbScene['motion']>; w: number; h: number; filter: string; children: ReactNode }) {
  const steps = [1, 2];
  return (
    <g filter={filter} opacity={0.5}>
      {steps.map((k) => {
        const d = (k * w * 0.035) * -m.dir;
        const t =
          m.kind === 'h'
            ? `translate(${d} 0)`
            : m.kind === 'v'
              ? `translate(0 ${d})`
              : m.kind === 'radial'
                ? `translate(${w / 2} ${h / 2}) scale(${1 - 0.05 * k * m.dir}) translate(${-w / 2} ${-h / 2})`
                : `translate(${k % 2 ? w * 0.012 : -w * 0.01} ${k % 2 ? -h * 0.01 : h * 0.012})`;
        return (
          <g key={k} transform={t} opacity={0.55 / k}>
            {children}
          </g>
        );
      })}
    </g>
  );
}

function SpeedLines({ m, w, h }: { m: NonNullable<ThumbScene['motion']>; w: number; h: number }) {
  if (m.kind === 'shake') return null;
  const lines: string[] = [];
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.5) / 5;
    if (m.kind === 'h') {
      const x = m.dir > 0 ? w * 0.04 : w * 0.96;
      lines.push(`M${x} ${h * (0.15 + 0.7 * t)} l${m.dir * w * (0.05 + 0.03 * (k % 2))} 0`);
    } else if (m.kind === 'v') {
      const y = m.dir > 0 ? h * 0.05 : h * 0.95;
      lines.push(`M${w * (0.1 + 0.8 * t)} ${y} l0 ${m.dir * h * (0.06 + 0.03 * (k % 2))}`);
    } else {
      const a = t * Math.PI * 2 + 0.3;
      const r0 = Math.min(w, h) * 0.42;
      lines.push(`M${w / 2 + Math.cos(a) * r0} ${h / 2 + Math.sin(a) * r0} l${Math.cos(a) * w * 0.05 * m.dir} ${Math.sin(a) * w * 0.05 * m.dir}`);
    }
  }
  return <path d={lines.join(' ')} className="ss-speed" />;
}

function FovBadge({ w, fov, mm, aperture }: { w: number; fov: number; mm: number; aperture?: number }) {
  const r = 6;
  const a = (Math.min(170, fov) * Math.PI) / 360;
  return (
    <g className="ss-badge">
      <text x={w - 4} y={9} textAnchor="end" className="ss-mm">
        {mm}
        {aperture ? ` · ${formatAperture(aperture)}` : ''}
      </text>
      <path d={`M 0 0 L ${-r * Math.sin(a)} ${r * Math.cos(a)} A ${r} ${r} 0 0 0 ${r * Math.sin(a)} ${r * Math.cos(a)} Z`} className="ss-fov" transform={`translate(${w - 10} 12)`} />
    </g>
  );
}

/** Objets d'insert, dessinés dans un repère de 100 unités centré sur l'objet. */
function ObjectShape({ kind, cx, cy, size, squash }: { kind: ObjectKind; cx: number; cy: number; size: number; squash: number }) {
  const k = size / 100;
  const body: Record<ObjectKind, ReactNode> = {
    pot: (
      <>
        <path d="M0 10 C0 -10 -6 -26 -4 -40 M2 4 C10 -10 22 -18 30 -24" className="ss-stem" />
        <ellipse cx={-14} cy={-12} rx={12} ry={5} transform="rotate(-30 -14 -12)" className="ss-leaf" />
        <ellipse cx={30} cy={-26} rx={9} ry={4} transform="rotate(-40 30 -26)" className="ss-leaf" />
        {[0, 72, 144, 216, 288].map((a) => (
          <circle key={a} cx={-4 + 8 * Math.cos((a * Math.PI) / 180)} cy={-44 + 8 * Math.sin((a * Math.PI) / 180)} r={6} className="ss-petal" />
        ))}
        <circle cx={-4} cy={-44} r={4.5} className="ss-heart" />
        <rect x={-26} y={8} width={52} height={10} rx={2} className="ss-obj" />
        <path d="M-22 18 L22 18 L16 50 L-16 50 Z" className="ss-obj" />
      </>
    ),
    mug: (
      <>
        <path d="M-22 -20 L22 -20 L19 34 Q0 40 -19 34 Z" className="ss-obj" />
        <ellipse cx={0} cy={-20} rx={22} ry={6} className="ss-objDark" />
        <path d="M21 -8 Q40 -6 36 10 Q33 22 19 20" className="ss-objLine" />
        <path d="M-6 -32 q-6 -8 0 -16 M6 -34 q-6 -8 0 -16" className="ss-steam" />
      </>
    ),
    book: (
      <>
        <path d="M-44 -26 L0 -18 L44 -26 L44 30 L0 38 L-44 30 Z" className="ss-obj" />
        <path d="M0 -18 L0 38" className="ss-objLine" />
        <path d="M-36 -12 L-8 -7 M-36 -2 L-8 3 M-36 8 L-8 13 M8 -7 L36 -12 M8 3 L36 -2 M8 13 L36 8" className="ss-text" />
      </>
    ),
    phone: (
      <>
        <rect x={-20} y={-40} width={40} height={80} rx={7} className="ss-objDark" />
        <rect x={-16} y={-32} width={32} height={62} rx={2} className="ss-screen" />
        <path d="M-10 -20 L10 -20 M-10 -12 L6 -12 M-10 -4 L10 -4" className="ss-text" />
      </>
    ),
    poster: (
      <>
        <rect x={-34} y={-46} width={68} height={92} className="ss-obj" />
        <circle cx={0} cy={-14} r={13} className="ss-objDark" />
        <path d="M-20 22 Q0 0 20 22 Z" className="ss-objDark" />
        <path d="M-24 32 L24 32 M-18 39 L18 39" className="ss-text" />
      </>
    ),
    hand: (
      <>
        <path d="M-30 46 L-24 4 Q-26 -6 -18 -8 L-16 -34 Q-15 -40 -10 -40 Q-5 -40 -5 -34 L-4 -10 L-2 -42 Q-1 -48 4 -48 Q9 -48 9 -42 L9 -10 L12 -36 Q13 -41 18 -41 Q22 -40 22 -35 L20 -6 L24 -26 Q26 -30 30 -29 Q33 -27 32 -22 L26 14 Q22 34 10 46 Z" className="ss-skinObj" />
        <path d="M-4 -10 L-4 0 M9 -10 L8 0 M20 -6 L18 2" className="ss-objLine" />
      </>
    ),
    key: (
      <>
        <circle cx={-26} cy={0} r={16} className="ss-obj" />
        <circle cx={-26} cy={0} r={6} className="ss-hole" />
        <path d="M-10 -4 L40 -4 L40 4 L30 4 L30 12 L24 12 L24 4 L-10 4 Z" className="ss-obj" />
      </>
    ),
    glass: (
      <>
        <path d="M-20 -40 L20 -40 L16 0 Q0 10 -16 0 Z" className="ss-glass" />
        <path d="M-18 -18 L18 -18 L16 0 Q0 10 -16 0 Z" className="ss-wine" />
        <path d="M0 6 L0 36 M-16 40 L16 40" className="ss-objLine" />
      </>
    ),
    letter: (
      <>
        <rect x={-42} y={-28} width={84} height={56} className="ss-obj" />
        <path d="M-42 -28 L0 6 L42 -28" className="ss-objLine" />
      </>
    ),
    lamp: (
      <>
        <path d="M-24 -10 L24 -10 L14 -42 L-14 -42 Z" className="ss-obj" />
        <path d="M0 -10 L0 34" className="ss-objLine" />
        <ellipse cx={0} cy={38} rx={20} ry={5} className="ss-objDark" />
        <path d="M-22 -6 L-34 20 M22 -6 L34 20 M0 -6 L0 4" className="ss-ray" />
      </>
    ),
    car: (
      <>
        <path d="M-48 14 L-46 -2 L-30 -6 L-18 -22 L18 -22 L32 -6 L48 -2 L48 14 Z" className="ss-obj" />
        <path d="M-14 -18 L-4 -18 L-4 -6 L-24 -6 Z M2 -18 L14 -18 L26 -6 L2 -6 Z" className="ss-screen" />
        <circle cx={-28} cy={14} r={9} className="ss-objDark" />
        <circle cx={28} cy={14} r={9} className="ss-objDark" />
      </>
    ),
    eye: (
      <>
        <path d="M-46 0 Q0 -36 46 0 Q0 30 -46 0 Z" className="ss-eyeWhite" />
        <circle cx={0} cy={-1} r={15} className="ss-iris" />
        <circle cx={0} cy={-1} r={7} className="ss-pupil" />
        <circle cx={4} cy={-5} r={2.5} className="ss-glint" />
        <path d="M-46 0 Q0 -36 46 0" className="ss-lid" />
        <path d="M-30 -14 l-4 -9 M-18 -19 l-2 -10 M-4 -21 l0 -10 M10 -20 l2 -10 M24 -16 l4 -9" className="ss-lash" />
      </>
    ),
  };
  return (
    <g transform={`translate(${cx} ${cy}) scale(${k} ${k * squash})`} className="ss-object" data-object={kind}>
      {body[kind]}
    </g>
  );
}
