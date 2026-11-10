import { cropTransform, framesOf, setFrame } from '../../domain/keyframes';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, Box, Pencil, MousePointer2, Redo2, Trash2, Type, Undo2, X } from 'lucide-react';
import { aspectRatio } from '../../domain/aspect';
import { newId } from '../../domain/factory';
import { shotCode } from '../../domain/numbering';
import { ARROW3D_PRESETS, SKETCH_W, arrow3dFaces, arrowHead, shadeColor, type SketchItem } from '../../domain/sketch';
import type { ID, ProjectDoc } from '../../domain/types';
import { getBlob, putBlob } from '../../store/db';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
import { useBlobUrl } from '../../ui/useBlobUrl';
import s from './SketchEditor.module.css';

type Tool = 'pen' | 'arrow' | 'arrow3d' | 'text' | 'select';
type P = [number, number];
/** Noirs, gris et blanc seulement (charte de l'outil). */
const COLORS = ['#111318', '#4a4f57', '#8a9099', '#c4c8ce', '#ffffff'];

/** Dessin sur une case de storyboard : crayon, texte, flèches 2D et flèches en fausse 3D. */
export function SketchEditor({ doc, shotId, frame = 0, onClose }: { doc: ProjectDoc; shotId: ID; frame?: number; onClose: () => void }) {
  const shot = doc.shots[shotId];
  const sb = shot ? framesOf(shot)[frame] : undefined;
  const baseKey = sb?.sketch ? sb.baseKey : sb?.blobKey;
  // Cadrage de l'image d'origine, tel qu'affiché sur la carte : le dessin se pose exactement dessus.
  const baseFit = (sb?.sketch ? sb.baseFit : sb?.fit) ?? 'cover';
  const baseCrop = sb?.sketch ? sb.baseCrop : sb?.crop;
  const baseUrl = useBlobUrl(baseKey);
  const aspect = sb?.sketch && sb.sketchAspect ? sb.sketchAspect : aspectRatio(doc.project.settings.storyboardAspect);
  const H = Math.round(SKETCH_W / aspect);
  const [items, setItemsRaw] = useState<SketchItem[]>(sb?.sketch ?? []);
  // Historique propre au dessin : ⌘Z annule le dernier trait, pas une modification du projet.
  const past = useRef<SketchItem[][]>([]);
  const future = useRef<SketchItem[][]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dirty = useRef(false);
  const setItems = (next: SketchItem[] | ((l: SketchItem[]) => SketchItem[]), record = true) => {
    const value = typeof next === 'function' ? next(itemsRef.current) : next;
    if (value === itemsRef.current) return;
    if (record) {
      past.current.push(itemsRef.current);
      future.current = [];
    }
    dirty.current = true;
    itemsRef.current = value;
    setItemsRaw(value);
  };
  const undoStroke = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(itemsRef.current);
    setItems(prev, false);
  };
  const redoStroke = () => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push(itemsRef.current);
    setItems(nxt, false);
  };
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(5);
  const [preset, setPreset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<SketchItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [textDraft, setTextDraft] = useState<{ at: P; x: number; y: number; value: string } | null>(null);
  const commitText = () => {
    const t = textDraft?.value.trim();
    if (textDraft && t) setItems((l) => [...l, { id: newId(), kind: 'text', at: textDraft.at, text: t, color, size: 34 }]);
    setTextDraft(null);
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; from: P; orbit?: boolean } | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = selected;

  // Molette / trackpad sur une flèche 3D sélectionnée : glisser à deux doigts = orbite,
  // pincer = taille, Maj = rotation dans le plan, Alt = courbure.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const id = selRef.current;
      if (!id) return;
      setItems((l) => {
        const it = l.find((i) => i.id === id);
        if (it?.kind !== 'arrow3d') return l;
        e.preventDefault();
        const clamp = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
        const patch: Partial<typeof it> = e.ctrlKey
          ? { size: Math.max(40, Math.min(900, it.size * Math.exp(-e.deltaY * 0.01))) }
          : e.altKey
            ? { bend: Math.max(-200, Math.min(200, (it.bend ?? 0) + e.deltaY * 0.5)) }
            : e.shiftKey
              ? { roll: clamp(it.roll + (e.deltaY || e.deltaX) * 0.4) }
              : { yaw: clamp(it.yaw + e.deltaX * 0.4), pitch: clamp(it.pitch + e.deltaY * 0.4) };
        return l.map((i) => (i.id === id ? ({ ...i, ...patch } as SketchItem) : i));
      }, false);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const close = async () => {
    if (dirty.current) {
      const r = await ask({ title: 'Abandonner ce dessin ?', body: 'Les traits ajoutés depuis l’ouverture ne seront pas enregistrés.', confirmLabel: 'Abandonner' });
      if (!r.ok) return;
    }
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y') && !typing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'y' || e.key === 'Y' || e.shiftKey) redoStroke();
        else undoStroke();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (typing) return;
        if (selRef.current) setSelected(null);
        else void closeRef.current();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current && !typing) {
        const id = selRef.current;
        setItems((l) => l.filter((i) => i.id !== id));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pt = (e: { clientX: number; clientY: number }): P => {
    const m = svgRef.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [Math.round(p.x), Math.round(p.y)];
  };
  const sel = items.find((i) => i.id === selected);
  const update = (id: string, patch: Partial<SketchItem>) => setItems((l) => l.map((i) => (i.id === id ? ({ ...i, ...patch } as SketchItem) : i)));

  const down = (e: PointerEvent<SVGSVGElement>) => {
    const p = pt(e);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (tool === 'pen') setDraft({ id: newId(), kind: 'pen', points: [p], color, width });
    else if (tool === 'arrow') setDraft({ id: newId(), kind: 'arrow', from: p, to: p, color, width });
    else if (tool === 'arrow3d') {
      const pr = ARROW3D_PRESETS[preset];
      const it: SketchItem = { id: newId(), kind: 'arrow3d', at: p, size: 220, yaw: pr.yaw, pitch: pr.pitch, roll: pr.roll, color };
      setItems((l) => [...l, it]);
      setSelected(it.id);
      setTool('select');
    } else if (tool === 'text') {
      const m = svgRef.current!.getScreenCTM()!;
      const box = svgRef.current!.parentElement!.getBoundingClientRect();
      const sp = new DOMPoint(p[0], p[1]).matrixTransform(m);
      setTextDraft({ at: p, x: sp.x - box.left, y: sp.y - box.top, value: '' });
    } else {
      const orbit = (e.target as Element).closest('[data-orbit]')?.getAttribute('data-orbit');
      if (orbit) {
        past.current.push(itemsRef.current);
        future.current = [];
        drag.current = { id: orbit, from: p, orbit: true };
        return;
      }
      const hit = (e.target as Element).closest('[data-sketch]')?.getAttribute('data-sketch');
      setSelected(hit ?? null);
      if (hit) {
        past.current.push(itemsRef.current);
        future.current = [];
        drag.current = { id: hit, from: p, orbit: e.shiftKey && items.find((i) => i.id === hit)?.kind === 'arrow3d' };
      }
    }
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const p = pt(e);
    if (draft?.kind === 'pen') setDraft({ ...draft, points: [...draft.points, p] });
    else if (draft?.kind === 'arrow') setDraft({ ...draft, to: p });
    else if (drag.current) {
      const d = drag.current;
      const [dx, dy] = [p[0] - d.from[0], p[1] - d.from[1]];
      d.from = p;
      setItems(
        (l) =>
        l.map((i) => {
          if (i.id !== d.id) return i;
          // Orbite : glisser horizontalement fait tourner, verticalement incline.
          if (d.orbit && i.kind === 'arrow3d') return { ...i, yaw: i.yaw + dx * 0.6, pitch: Math.max(-89, Math.min(89, i.pitch + dy * 0.6)) };
          const t = ([x, y]: P): P => [x + dx, y + dy];
          if (i.kind === 'pen') return { ...i, points: i.points.map(t) };
          if (i.kind === 'arrow') return { ...i, from: t(i.from), to: t(i.to) };
          return { ...i, at: t(i.at) };
        }),
        false,
      );
    }
  };
  const up = () => {
    if (draft && (draft.kind !== 'arrow' || Math.hypot(draft.to[0] - draft.from[0], draft.to[1] - draft.from[1]) > 8)) setItems((l) => [...l, draft]);
    setDraft(null);
    drag.current = null;
  };

  const save = async () => {
    // Rien de changé : on referme sans réécrire l'image.
    if (!dirty.current) return onClose();
    // Tous les traits effacés : l'image d'origine revient telle quelle, ou la case redevient vide.
    if (!items.length) {
      const none = { baseKey: undefined, sketch: undefined, sketchAspect: undefined, baseCrop: undefined, baseFit: undefined };
      mutateDoc((d) => setFrame(d, shotId, frame, baseKey ? { ...none, blobKey: baseKey, crop: baseCrop, fit: sb?.sketch ? sb.baseFit : sb?.fit } : { ...none, blobKey: undefined, crop: undefined, fit: undefined }));
      return onClose();
    }
    setSaving(true);
    try {
      const W2 = SKETCH_W * 2;
      const H2 = H * 2;
      const canvas = document.createElement('canvas');
      canvas.width = W2;
      canvas.height = H2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W2, H2);
      // 1. L'image d'origine, peinte directement (Safari omet les images imbriquées dans un SVG).
      const blob = baseKey ? await getBlob(baseKey) : undefined;
      if (blob) {
        const img = await loadImage(URL.createObjectURL(blob), true);
        const c = baseCrop ?? { zoom: 1, x: 0, y: 0, rot: 0 };
        const k = (baseFit === 'contain' ? Math.min : Math.max)(W2 / img.naturalWidth, H2 / img.naturalHeight);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W2, H2);
        ctx.clip();
        ctx.translate(W2 / 2 + (c.x / 100) * W2, H2 / 2 + (c.y / 100) * H2);
        ctx.rotate((c.rot * Math.PI) / 180);
        ctx.scale(c.zoom, c.zoom);
        ctx.drawImage(img, (-img.naturalWidth * k) / 2, (-img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
        ctx.restore();
      }
      // 2. Les traits et flèches (SVG sans image ni texte).
      const svg = svgRef.current!.cloneNode(true) as SVGSVGElement;
      svg.querySelectorAll('.no-image, image, text, [data-base]').forEach((n) => n.remove());
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', String(W2));
      svg.setAttribute('height', String(H2));
      const strokes = await loadImage(URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })), true);
      ctx.drawImage(strokes, 0, 0, W2, H2);
      // 3. Les textes, avec la police de l'application.
      await document.fonts.ready;
      for (const it of items) {
        if (it.kind !== 'text') continue;
        ctx.font = `700 ${it.size * 2}px "Inter Variable", Inter, sans-serif`;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(it.text, it.at[0] * 2, it.at[1] * 2);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, it.at[0] * 2, it.at[1] * 2);
      }
      const png = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('Rendu impossible'))), 'image/png'));
      const key = await putBlob(doc.project.id, `dessin-${shotCode(doc, shotId)}.png`, png);
      // Le dessin enregistré intègre déjà le cadrage : la carte l'affiche tel quel.
      mutateDoc((d) => setFrame(d, shotId, frame, { blobKey: key, baseKey, sketch: items, baseCrop, baseFit, sketchAspect: aspect, crop: undefined, fit: undefined }));
      onClose();
    } catch {
      useUi.getState().toast({ message: 'Dessin non enregistré.', tone: 'warn' });
    } finally {
      setSaving(false);
    }
  };

  const tools: Array<[Tool, string, JSX.Element]> = [
    ['pen', 'Crayon', <Pencil key="p" size={15} />],
    ['arrow', 'Flèche', <ArrowUpRight key="a" size={15} />],
    ['arrow3d', 'Flèche 3D', <Box key="b" size={15} />],
    ['text', 'Texte', <Type key="t" size={15} />],
    ['select', 'Sélection', <MousePointer2 key="s" size={15} />],
  ];

  return (
    <div
      className={s.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Dessin du plan ${shotCode(doc, shotId)}`}
      data-testid="sketch-editor"
      // Rendu en portail : les gestes ne doivent pas remonter jusqu'à la carte (glisser-déposer du storyboard).
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className={s.sheet}>
        <header className={s.head}>
          <strong>
            Plan {shotCode(doc, shotId)}
            {framesOf(shot).length > 1 ? ` · keyframe ${frame + 1}` : ''}
          </strong>
          <div className={s.tools} role="toolbar">
            {tools.map(([k, label, icon]) => (
              <button key={k} type="button" className={tool === k ? s.on : ''} aria-pressed={tool === k} onClick={() => setTool(k)} data-testid={`sketch-${k}`}>
                {icon}
                {label}
              </button>
            ))}
          </div>
          <div className={s.colors}>
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Couleur ${c}`} className={color === c ? s.colorOn : ''} style={{ background: c }} onClick={() => (setColor(c), sel && update(sel.id, { color: c }))} />
            ))}
          </div>
          <label className={s.width}>
            Épaisseur
            <input type="range" min={2} max={18} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          </label>
          <Button variant="icon" aria-label="Annuler (⌘Z)" title="Annuler (⌘Z)" icon={<Undo2 size={16} />} onClick={undoStroke} />
          <Button variant="icon" aria-label="Rétablir (⇧⌘Z)" title="Rétablir (⇧⌘Z)" icon={<Redo2 size={16} />} onClick={redoStroke} />
          <Button variant="icon" aria-label="Fermer sans enregistrer" icon={<X size={18} />} onClick={() => void close()} />
        </header>
        {(tool === 'arrow3d' || sel?.kind === 'arrow3d') && (
          <div className={s.presets}>
            {sel?.kind === 'arrow3d' ? (
              <>
                <span>Flèche 3D</span>
                {(
                  [
                    ['yaw', 'Direction', -180, 180, 1, 0],
                    ['pitch', 'Inclinaison', -90, 90, 1, 0],
                    ['roll', 'Rotation', -180, 180, 1, 0],
                    ['size', 'Taille', 40, 900, 1, 220],
                    ['length', 'Longueur', 0.5, 3, 0.05, 1],
                    ['bend', 'Courbure', -200, 200, 1, 0],
                    ['persp', 'Perspective', 0, 1, 0.05, 0.5],
                  ] as const
                ).map(([k, label, min, max, step, def]) => (
                  <label key={k}>
                    {label}
                    <input type="range" min={min} max={max} step={step} value={(sel as Record<string, unknown>)[k] as number ?? def} onChange={(e) => update(sel.id, { [k]: Number(e.target.value) })} />
                  </label>
                ))}
              </>
            ) : (
              <>
                <span>Orientation de départ</span>
                {ARROW3D_PRESETS.map((p, i) => (
                  <button key={p.label} type="button" className={preset === i ? s.on : ''} onClick={() => setPreset(i)}>
                    <svg viewBox="-0.7 -0.6 1.4 1.2" width="34" height="28" aria-hidden="true">
                      <Arrow3D yaw={p.yaw} pitch={p.pitch} roll={p.roll} color="#4a4f57" size={1} at={[0, 0]} />
                    </svg>
                    {p.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        <div className={s.stage} style={{ position: 'relative' }}>
          {textDraft && (
            <input
              className={s.textInput}
              style={{ left: textDraft.x, top: textDraft.y - 18, color }}
              autoFocus
              value={textDraft.value}
              placeholder="Texte"
              aria-label="Texte à poser sur l’image"
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
                if (e.key === 'Escape') setTextDraft(null);
              }}
              onBlur={commitText}
            />
          )}
          <svg ref={svgRef} viewBox={`0 0 ${SKETCH_W} ${H}`} className={[s.canvas, tool !== 'select' ? s.drawing : ''].join(' ')} onPointerDown={down} onPointerMove={move} onPointerUp={up} data-testid="sketch-canvas">
            <rect width={SKETCH_W} height={H} fill="#ffffff" />
            {baseUrl && (
              <g data-base transform={cropTransform(baseCrop, SKETCH_W, H)}>
                <image href={baseUrl} width={SKETCH_W} height={H} preserveAspectRatio={baseFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'} />
              </g>
            )}
            {[...items, ...(draft ? [draft] : [])].map((i) => (
              <g key={i.id} data-sketch={i.id} className={i.id === selected ? s.sel : undefined}>
                <SketchShape item={i} />
              </g>
            ))}
            {sel && <SelectionBox item={sel} />}
            {sel?.kind === 'arrow3d' && (
              <g className="no-image" data-orbit={sel.id} style={{ cursor: 'grab' }}>
                <circle cx={sel.at[0]} cy={sel.at[1] - sel.size * 0.62} r={13} fill="#ffffff" stroke="#111318" strokeWidth={2} />
                <path d={`M ${sel.at[0] - 6} ${sel.at[1] - sel.size * 0.62 - 2} a 6 6 0 1 1 3 7`} fill="none" stroke="#111318" strokeWidth={2} />
              </g>
            )}
          </svg>
        </div>
        <footer className={s.foot}>
          {sel && (
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => (setItems((l) => l.filter((i) => i.id !== sel.id)), setSelected(null))}>
              Supprimer l’élément
            </Button>
          )}
          <span />
          <Button variant="ghost" onClick={() => (setItems([]), setSelected(null))} disabled={!items.length}>
            Tout effacer
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()} data-testid="sketch-save">
            Enregistrer
          </Button>
        </footer>
      </div>
    </div>
  );
}

function SketchShape({ item }: { item: SketchItem }) {
  switch (item.kind) {
    case 'pen':
      return <polyline points={item.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={item.color} strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" />;
    case 'arrow':
      return (
        <>
          <line x1={item.from[0]} y1={item.from[1]} x2={item.to[0]} y2={item.to[1]} stroke={item.color} strokeWidth={item.width} strokeLinecap="round" />
          <polygon points={arrowHead(item.from, item.to, 10 + item.width * 3).map((p) => p.join(',')).join(' ')} fill={item.color} />
        </>
      );
    case 'text':
      return (
        <text x={item.at[0]} y={item.at[1]} fill={item.color} fontSize={item.size} fontFamily="Inter Variable, sans-serif" fontWeight={700} stroke="#ffffff" strokeWidth={0.6} paintOrder="stroke">
          {item.text}
        </text>
      );
    case 'arrow3d':
      return <Arrow3D {...item} />;
  }
}

function Arrow3D({ at, size, yaw, pitch, roll, color, length, bend, persp }: { at: P; size: number; yaw: number; pitch: number; roll: number; color: string; length?: number; bend?: number; persp?: number }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]}) scale(${size})`}>
      {arrow3dFaces({ yaw, pitch, roll, length, bend, persp }).map((f, i) => (
        <polygon key={i} points={f.points.map((p) => p.join(',')).join(' ')} fill={shadeColor(color, f.shade)} stroke={shadeColor(color, 0.45)} strokeWidth={0.008} strokeLinejoin="round" />
      ))}
    </g>
  );
}

function SelectionBox({ item }: { item: SketchItem }) {
  const pts: P[] = item.kind === 'pen' ? item.points : item.kind === 'arrow' ? [item.from, item.to] : item.kind === 'arrow3d' ? [[item.at[0] - item.size * 0.6, item.at[1] - item.size * 0.5], [item.at[0] + item.size * 0.6, item.at[1] + item.size * 0.5]] : [item.at, [item.at[0] + item.text.length * item.size * 0.5, item.at[1] - item.size]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return <rect className="no-image" x={Math.min(...xs) - 8} y={Math.min(...ys) - 8} width={Math.max(...xs) - Math.min(...xs) + 16} height={Math.max(...ys) - Math.min(...ys) + 16} fill="none" stroke="#4a4f57" strokeDasharray="6 4" strokeWidth={1.5} pointerEvents="none" />;
}

/** Charge une image et attend son décodage (libère l'adresse temporaire ensuite si demandé). */
async function loadImage(url: string, revoke = false): Promise<HTMLImageElement> {
  const img = new Image();
  try {
    await new Promise<void>((ok, ko) => {
      img.onload = () => ok();
      img.onerror = () => ko(new Error('Rendu impossible'));
      img.src = url;
    });
    await img.decode().catch(() => undefined);
    return img;
  } finally {
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
