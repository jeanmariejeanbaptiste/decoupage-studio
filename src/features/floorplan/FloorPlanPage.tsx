import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Camera,
  Copy,
  RectangleVertical,
  DoorOpen,
  Lamp,
  MousePointer2,
  Minus,
  Square,
  Trash2,
  TrainTrack,
  User,
  Flag,
  Grid2x2,
} from 'lucide-react';
import { sequenceCharacterIds, sortedCharacters } from '../../domain/characters';
import {
  addFloorItem,
  addPlan,
  choreography,
  oneShotPlansOf,
  cameraCone,
  camerasForShot,
  deletePlan,
  DEFAULT_RANGE,
  DEFAULT_SPREAD,
  computeLighting,
  plansOf,
  reflectorSize,
  isLineKind,
  LINE_KINDS,
  renamePlan,
  moveFloorItem,
  PLAN_H,
  PLAN_W,
  planOf,
  removeFloorItem,
  snap,
  updateFloorItem,
  GRID,
  type FloorItem,
  type FloorKind,
  type Point,
} from '../../domain/floorplan';
import { formatFocal } from '../../domain/focal';
import { sequenceHeading, shotCode } from '../../domain/numbering';
import type { ID, ProjectDoc } from '../../domain/types';
import { isZoom } from '../../domain/vocabulary';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { putBlob } from '../../store/db';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { aiPlanInstructions, parsePlanFile, placePlan, type ParsedPlan } from '../../domain/planImport';
import { WORLD, type FloorPlan } from '../../domain/floorplan';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import s from './FloorPlanPage.module.css';
import { allFloorPlans, floorPlanSvg } from '../../domain/exports';
import { exportSvgPages } from '../export/imageExport';
import { ExportPanel } from '../export/ExportPanel';
import { downloadWord } from '../export/docExport';
import { downloadBlob } from '../../store/persistence';
import { floorPlansDocument } from '../../domain/documents';

type Tool = 'select' | FloorKind;
const IC = { size: 15, strokeWidth: 1.25 } as const;
const TOOLS: Array<{ key: Tool; label: string; icon: JSX.Element }> = [
  { key: 'select', label: 'Sélection', icon: <MousePointer2 {...IC} /> },
  { key: 'camera', label: 'Caméra', icon: <Camera {...IC} /> },
  { key: 'actor', label: 'Comédien', icon: <User {...IC} /> },
  { key: 'wall', label: 'Mur', icon: <Minus {...IC} /> },
  { key: 'rail', label: 'Rails', icon: <TrainTrack {...IC} /> },
  { key: 'door', label: 'Porte', icon: <DoorOpen {...IC} /> },
  { key: 'window', label: 'Fenêtre', icon: <Square {...IC} /> },
  { key: 'light', label: 'Lumière', icon: <Lamp {...IC} /> },
  { key: 'reflector', label: 'Réflecteur', icon: <RectangleVertical {...IC} /> },
  { key: 'diffuser', label: 'Diffuseur', icon: <Grid2x2 {...IC} /> },
  { key: 'flag', label: 'Drapeau', icon: <Flag {...IC} /> },
];

type Drag =
  | { mode: 'move'; id: ID; from: Point; to: Point }
  | { mode: 'rotate'; id: ID; to: Point }
  | { mode: 'path'; id: ID; to: Point }
  | { mode: 'line'; kind: (typeof LINE_KINDS)[number]; from: Point; to: Point }
  | { mode: 'group'; ids: ID[]; from: Point; to: Point }
  | { mode: 'box'; from: Point; to: Point }
  | { mode: 'bg'; from: Point; to: Point }
  | { mode: 'ghost'; from: Point; to: Point };

/** Ajustement de l'aperçu des murs importés avant validation : décalage et échelle autour du centre. */
interface Ghost {
  dx: number;
  dy: number;
  k: number;
}

/** Bornes du zoom : de 1/10 de la vue par défaut jusqu'à tout l'espace de travail. */
const ZOOM_MIN = PLAN_W / 10;
const ZOOM_MAX = WORLD.max - WORLD.min;

/** Dimensions naturelles d'une image (pour son format exact et les consignes IA). */
function useImageSize(url: string | null | undefined): { w: number; h: number } | undefined {
  const [size, setSize] = useState<{ w: number; h: number }>();
  useEffect(() => {
    setSize(undefined);
    if (!url) return;
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);
  return size;
}

const deg = (a: Point, b: Point) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** Plan au sol par séquence (§15.2). */
export function FloorPlanPage({ doc }: { doc: ProjectDoc }) {
  const [seqId, setSeqId] = useState<ID | undefined>(doc.project.sequenceIds[0]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<ID | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Zoom et déplacement : fenêtre visible du plan (bornée), recentrable.
  const [view, setView] = useState({ x: 0, y: 0, w: PLAN_W, h: PLAN_H });
  // Import du fichier .md de l'IA : analysé en mémoire, jamais conservé.
  const [mdImport, setMdImport] = useState<{ name: string; plan: ParsedPlan } | null>(null);
  const [realScale, setRealScale] = useState(false);
  const [bgEdit, setBgEdit] = useState(false);
  const [multi, setMulti] = useState<ID[]>([]);
  const [ghost, setGhost] = useState<Ghost>({ dx: 0, dy: 0, k: 1 });
  const ghostOnRef = useRef(false);

  const [planPick, setPlanPick] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!seqId || !doc.sequences[seqId]) setSeqId(doc.project.sequenceIds[0]);
  }, [doc, seqId]);

  const plans = seqId ? plansOf(doc, seqId) : [];
  const psPlans = seqId ? oneShotPlansOf(doc, seqId) : [];
  const planKey = [...plans, ...psPlans].find((p) => p.key === planPick)?.key ?? seqId ?? '';
  const psView = psPlans.find((p) => p.key === planKey);
  const items = useMemo(() => (planKey ? planOf(doc, planKey).items : []), [doc, planKey]);
  const { beams, shadows } = useMemo(() => computeLighting(items), [items]);
  const bg = planKey ? planOf(doc, planKey).bg : undefined;
  const bgUrl = useBlobUrl(bg?.blobKey);
  const nat = useImageSize(bgUrl);
  const bgRatio = nat ? nat.h / nat.w : 0.7;
  // Aperçu de l'import : murs placés sur le fond (ou la vue), puis ajustés à la main avant validation.
  const placed = useMemo(() => {
    if (!mdImport) return null;
    const scale = mdImport.plan.mode === 'cm' ? 1 : mdImport.plan.scale;
    const target = bg && mdImport.plan.mode === 'image' ? { x: bg.x, y: bg.y, w: realScale && scale ? mdImport.plan.grid.w * scale : bg.w, h: 0 } : undefined;
    return placePlan(mdImport.plan, target, realScale);
  }, [mdImport, bg, realScale]);
  const ghostCenter = useMemo(() => {
    const pts = placed ? [...placed.walls.flatMap((w) => [[w.x, w.y], [w.x2, w.y2]]), ...[...placed.doors, ...placed.windows].map((o) => [o.x, o.y])] : [];
    if (!pts.length) return { x: 0, y: 0 };
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }, [placed]);
  const liveGhost: Ghost = drag?.mode === 'ghost' ? { ...ghost, dx: ghost.dx + drag.to.x - drag.from.x, dy: ghost.dy + drag.to.y - drag.from.y } : ghost;
  const gx = (x: number, g: Ghost = liveGhost) => Math.round((ghostCenter.x + (x - ghostCenter.x) * g.k + g.dx) * 10) / 10;
  const gy = (y: number, g: Ghost = liveGhost) => Math.round((ghostCenter.y + (y - ghostCenter.y) * g.k + g.dy) * 10) / 10;
  ghostOnRef.current = !!placed;
  const scaleGhostRef = useRef((f: number) => setGhost((g) => ({ ...g, k: Math.max(0.05, Math.min(40, g.k * f)) })));
  const bgEditRef = useRef(bgEdit);
  bgEditRef.current = bgEdit;
  /** Met le fond à l'échelle autour d'un point (repère du plan). */
  const scaleBg = (f: number, at?: Point) =>
    mutateDoc((d) => {
      const b = d.floorPlans?.[planKey]?.bg;
      if (!b) return;
      const w = Math.max(50, Math.min(ZOOM_MAX, b.w * f));
      const k = w / b.w;
      const c = at ?? { x: b.x + b.w / 2, y: b.y + (b.w * bgRatio) / 2 };
      b.x = c.x - (c.x - b.x) * k;
      b.y = c.y - (c.y - b.y) * k;
      b.w = w;
    });
  const scaleBgRef = useRef(scaleBg);
  scaleBgRef.current = scaleBg;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      setView((v) => {
        const k = v.w / r.width;
        if (ghostOnRef.current && !(e.ctrlKey || e.metaKey)) {
          // Aperçu d'import : la molette agrandit ou réduit l'ensemble des murs importés.
          scaleGhostRef.current(Math.exp(-e.deltaY * 0.002));
          return v;
        }
        if (bgEditRef.current) {
          // Réglage du fond : la molette (ou le pincement) agrandit ou réduit l'image sous le pointeur.
          const at = { x: v.x + (e.clientX - r.left) * k, y: v.y + (e.clientY - r.top) * k };
          scaleBgRef.current(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), at);
          return v;
        }
        if (e.ctrlKey || e.metaKey) {
          // Pincer (ou Ctrl + molette) : zoom centré sur le pointeur, borné.
          const f = Math.exp(e.deltaY * 0.01);
          const w = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.w * f));
          const h = (w * PLAN_H) / PLAN_W;
          const px = v.x + (e.clientX - r.left) * k;
          const py = v.y + (e.clientY - r.top) * k;
          return { x: px - (px - v.x) * (w / v.w), y: py - (py - v.y) * (h / v.h), w, h };
        }
        return { ...v, x: v.x + e.deltaX * k, y: v.y + e.deltaY * k };
      });
    };
    // Safari (trackpad) : le pincement arrive en événements « gesture », pas en molette.
    let last = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const f = last / g.scale;
      last = g.scale;
      const r = svg.getBoundingClientRect();
      setView((v) => {
        const k = v.w / r.width;
        const px = v.x + (g.clientX - r.left) * k;
        const py = v.y + (g.clientY - r.top) * k;
        if (bgEditRef.current) {
          scaleBgRef.current(1 / f, { x: px, y: py });
          return v;
        }
        const w = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.w * f));
        const h = (w * PLAN_H) / PLAN_W;
        return { x: px - (px - v.x) * (w / v.w), y: py - (py - v.y) * (h / v.h), w, h };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions);
    svg.addEventListener('gesturechange', onGesture, { passive: false } as AddEventListenerOptions);
    return () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('gesturestart', onGestureStart);
      svg.removeEventListener('gesturechange', onGesture);
    };
  }, [planKey]);
  /** Recentre sur les éléments de la vue (ou tout le plan s'il est vide). */
  const fitView = () => {
    const pts = items.flatMap((i) => ('x2' in i ? [[i.x, i.y], [i.x2, i.y2]] : [[i.x, i.y]]));
    if (bg) pts.push([bg.x, bg.y], [bg.x + bg.w, bg.y + bg.w * bgRatio]);
    if (!pts.length) return setView({ x: 0, y: 0, w: PLAN_W, h: PLAN_H });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 80, Math.max(...xs) + 80, Math.min(...ys) - 80, Math.max(...ys) + 80];
    const w = Math.min(ZOOM_MAX, Math.max(PLAN_W / 6, x1 - x0, ((y1 - y0) * PLAN_W) / PLAN_H));
    const h = (w * PLAN_H) / PLAN_W;
    setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
  };
  const zoomBy = (f: number) =>
    setView((v) => {
      const w = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.w * f));
      const h = (w * PLAN_H) / PLAN_W;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });
  const sel = items.find((i) => i.id === selected);
  // Plan-séquence : temps choisi (null = tous) et trajectoires caméra / comédiens.
  const [beat, setBeat] = useState<number | null>(null);
  // Les temps n'existent que dans la vue propre au plan-séquence.
  const psShots = psView ? [psView.shotId] : [];
  const nBeats = psView ? (doc.shots[psView.shotId]?.oneShot?.beats.length ?? 0) : 0;
  const paths = useMemo(() => choreography(items), [items]);

  if (!seqId || !doc.sequences[seqId]) {
    return (
      <div className="page">
        <div className="card empty">
          <span className="hand">Aucune séquence</span>
          <p>Créez d’abord une séquence dans le découpage.</p>
        </div>
      </div>
    );
  }

  const toSvg = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };

  const mutate = (fn: (d: ProjectDoc) => void) => mutateDoc(fn);

  const onCanvasDown = (e: PointerEvent<SVGSVGElement>) => {
    if (placed && (e.target as Element).closest('[data-ghost]')) {
      svgRef.current?.setPointerCapture(e.pointerId);
      const p = toSvg(e);
      setDrag({ mode: 'ghost', from: p, to: p });
      return;
    }
    if (bgEdit && bg) {
      svgRef.current?.setPointerCapture(e.pointerId);
      const p = toSvg(e);
      setDrag({ mode: 'bg', from: p, to: p });
      return;
    }
    if (tool === 'select') {
      if (e.target === svgRef.current || (e.target as Element).getAttribute('data-bg')) {
        // Rectangle de sélection : glisser sur le fond pour sélectionner plusieurs éléments.
        setSelected(null);
        if (!e.shiftKey) setMulti([]);
        svgRef.current?.setPointerCapture(e.pointerId);
        const p = toSvg(e);
        setDrag({ mode: 'box', from: p, to: p });
      }
      return;
    }
    const p = toSvg(e);
    if (isLineKind(tool)) {
      svgRef.current?.setPointerCapture(e.pointerId);
      setDrag({ mode: 'line', kind: tool, from: p, to: p });
      return;
    }
    const id = mutateDoc((d) => {
      const nid = addFloorItem(d, planKey, tool, p);
      if (tool === 'actor') {
        // Nommage rapide : le premier personnage de la séquence pas encore placé.
        const placed = planOf(d, planKey).items.map((i) => (i.kind === 'actor' ? i.characterId : undefined));
        const next = sequenceCharacterIds(d, seqId).find((c) => !placed.includes(c));
        if (next) updateFloorItem(d, planKey, nid, { characterId: next } as Partial<FloorItem>);
      }
      if (psView && beat && (tool === 'camera' || tool === 'actor')) {
        const it = planOf(d, planKey).items.find((i) => i.id === nid);
        const prev = planOf(d, planKey).items.find((i) => i.kind === tool && i.id !== nid && i.beat === beat - 1);
        const patch: Record<string, unknown> = { beat };
        // Le comédien du temps précédent est repris ; la caméra couvre le plan-séquence.
        if (tool === 'actor' && prev?.kind === 'actor') Object.assign(patch, { characterId: prev.characterId, label: prev.label });
        if (tool === 'camera' && psShots.length === 1) patch.shotIds = [psShots[0]];
        if (it) updateFloorItem(d, planKey, nid, patch as Partial<FloorItem>);
      }
      return nid;
    });
    if (id) setSelected(id);
  };

  const onItemDown = (e: PointerEvent, id: ID, mode: 'move' | 'rotate' | 'path' = 'move') => {
    if (tool !== 'select' || bgEdit) return;
    e.stopPropagation();
    if (e.shiftKey && mode === 'move') {
      // Maj + clic : ajoute ou retire l'élément de la sélection.
      const cur = multi.length ? multi : selected ? [selected] : [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      setMulti(next);
      setSelected(next.length === 1 ? next[0] : null);
      return;
    }
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toSvg(e);
    if (mode === 'move' && multi.length > 1 && multi.includes(id)) {
      setDrag({ mode: 'group', ids: multi, from: p, to: p });
      return;
    }
    setMulti([]);
    setSelected(id);
    setDrag(mode === 'move' ? { mode, id, from: p, to: p } : { mode, id, to: p });
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, to: toSvg(e) });
  };

  const onUp = () => {
    const d0 = drag;
    setDrag(null);
    if (!d0) return;
    if (d0.mode === 'ghost') {
      setGhost((g) => ({ ...g, dx: g.dx + d0.to.x - d0.from.x, dy: g.dy + d0.to.y - d0.from.y }));
      return;
    }
    if (d0.mode === 'bg') {
      const [dx, dy] = [d0.to.x - d0.from.x, d0.to.y - d0.from.y];
      if (dx || dy) mutate((d) => {
        const b = d.floorPlans?.[planKey]?.bg;
        if (b) Object.assign(b, { x: b.x + dx, y: b.y + dy });
      });
      return;
    }
    if (d0.mode === 'box') {
      const [x0, x1] = [Math.min(d0.from.x, d0.to.x), Math.max(d0.from.x, d0.to.x)];
      const [y0, y1] = [Math.min(d0.from.y, d0.to.y), Math.max(d0.from.y, d0.to.y)];
      if (x1 - x0 < 4 && y1 - y0 < 4) return;
      const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const ids = items.filter((i) => inside(i.x, i.y) && (!('x2' in i) || inside(i.x2, i.y2))).map((i) => i.id);
      const next = [...new Set([...multi, ...ids])];
      setMulti(next);
      setSelected(next.length === 1 ? next[0] : null);
      return;
    }
    if (d0.mode === 'group') {
      const dx = snap(d0.to.x - d0.from.x);
      const dy = snap(d0.to.y - d0.from.y);
      if (dx || dy) mutate((d) => d0.ids.forEach((id) => moveFloorItem(d, planKey, id, dx, dy)));
      return;
    }
    if (d0.mode === 'line') {
      if (Math.hypot(d0.to.x - d0.from.x, d0.to.y - d0.from.y) < GRID) return;
      const id = mutateDoc((d) => addFloorItem(d, planKey, d0.kind, d0.from, d0.to));
      if (id) setSelected(id);
      return;
    }
    const item = items.find((i) => i.id === d0.id);
    if (!item) return;
    if (d0.mode === 'move') {
      const dx = snap(d0.to.x - d0.from.x);
      const dy = snap(d0.to.y - d0.from.y);
      if (dx || dy) mutate((d) => moveFloorItem(d, planKey, item.id, dx, dy));
    } else if (d0.mode === 'rotate') {
      const rot = Math.round(deg(item, d0.to) / 5) * 5;
      mutate((d) => updateFloorItem(d, planKey, item.id, { rot } as Partial<FloorItem>));
    } else {
      mutate((d) =>
        updateFloorItem(d, planKey, item.id, {
          to: { x: snap(d0.to.x), y: snap(d0.to.y) },
        } as Partial<FloorItem>),
      );
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (multi.length > 1) {
      const step = e.shiftKey ? GRID * 5 : GRID;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (mv[e.key]) {
        e.preventDefault();
        const [dx, dy] = mv[e.key];
        mutate((d) => multi.forEach((id) => moveFloorItem(d, planKey, id, dx, dy)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        mutate((d) => multi.forEach((id) => removeFloorItem(d, planKey, id)));
        setMulti([]);
      } else if (e.key === 'Escape') setMulti([]);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      setMulti(items.map((i) => i.id));
      setSelected(null);
      return;
    }
    if (e.key === 'Escape' && !sel) {
      setTool('select');
      return;
    }
    if (!sel) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      mutate((d) => moveFloorItem(d, planKey, sel.id, dx, dy));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      mutate((d) => removeFloorItem(d, planKey, sel.id));
      setSelected(null);
    } else if ((e.key === 'r' || e.key === 'R') && ('rot' in sel || sel.kind === 'actor')) {
      e.preventDefault();
      const rot = (sel as { rot?: number }).rot ?? 90;
      mutate((d) => updateFloorItem(d, planKey, sel.id, { rot: rot + (e.shiftKey ? -15 : 15) } as Partial<FloorItem>));
    } else if (e.key === 'Escape') {
      setSelected(null);
      setTool('select');
    }
  };

  // Aperçu d'un élément pendant le glissement.
  const preview = (item: FloorItem): FloorItem => {
    if (!drag || drag.mode === 'line' || drag.mode === 'box' || drag.mode === 'bg' || drag.mode === 'ghost') return item;
    if (drag.mode === 'group' ? !drag.ids.includes(item.id) : drag.id !== item.id) return item;
    if (drag.mode === 'move' || drag.mode === 'group') {
      const dx = snap(drag.to.x - drag.from.x);
      const dy = snap(drag.to.y - drag.from.y);
      const moved = { ...item, x: item.x + dx, y: item.y + dy } as FloorItem;
      if ('x2' in moved)
        Object.assign(moved, { x2: moved.x2 + dx, y2: moved.y2 + dy });
      if (moved.kind === 'actor' && moved.to) moved.to = { x: moved.to.x + dx, y: moved.to.y + dy };
      return moved;
    }
    if (drag.mode === 'rotate' && ('rot' in item || item.kind === 'actor'))
      return { ...item, rot: Math.round(deg(item, drag.to) / 5) * 5 } as FloorItem;
    if (drag.mode === 'path' && item.kind === 'actor')
      return { ...item, to: { x: snap(drag.to.x), y: snap(drag.to.y) } };
    return item;
  };

  const seq = doc.sequences[seqId];

  return (
    <div className="page page--wide">
      <header className="page-head">
        <ExportPanel
          doc={doc}
          id="floorplan"
          title="Exporter les plans au sol (une page par vue)"
          extra={[
            { key: 'svg', label: 'SVG', hint: 'Toutes les vues en dessins vectoriels, dans un dossier compressé.' },
            { key: 'word', label: 'Word', hint: 'Document Word avec toutes les vues.' },
          ]}
          onExport={async ({ format, orientation, numbers }) => {
            const all = allFloorPlans(doc);
            const base = `${doc.project.title || 'projet'}-plans-au-sol`;
            if (format === 'pdf' || format === 'images') {
              const svgs = all.length ? all.map((p) => p.svg) : [floorPlanSvg(doc, planKey, sequenceHeading(doc, seqId))];
              return exportSvgPages(svgs, `${base}-A4-${orientation === 'portrait' ? 'portrait' : 'paysage'}`, { format, orientation, numbers });
            }
            if (format === 'word') return downloadWord(floorPlansDocument(doc), base);
            const { default: JSZip } = await import('jszip');
            const zip = new JSZip();
            for (const p of all) zip.file(`${p.name.replace(/[\\/:*?"<>|]+/g, '-')}.svg`, p.svg);
            downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}.zip`);
          }}
        />
        <label className={s.seqPick}>
          <span>Séquence</span>
          <select
            value={seqId}
            onChange={(e) => {
              setSeqId(e.target.value);
              setPlanPick(undefined);
              setSelected(null);
            }}
            aria-label="Séquence du plan au sol"
          >
            {doc.project.sequenceIds.map((id) => (
              <option key={id} value={id}>
                {sequenceHeading(doc, id)}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className={s.layout}>
        <div>
          <div className={s.plans} role="tablist" aria-label="Vues du plan au sol">
            {plans.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={p.key === planKey}
                className={p.key === planKey ? s.planOn : ''}
                onClick={() => {
                  setPlanPick(p.key);
                  setSelected(null);
                }}
                onDoubleClick={() => {
                  const name = window.prompt('Nom de la vue', p.name);
                  if (name !== null) mutateDoc((d) => renamePlan(d, p.key, name));
                }}
                title="Double-cliquer pour renommer"
              >
                {p.name}
              </button>
            ))}
            {psPlans.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={p.key === planKey}
                className={[s.psTab, p.key === planKey ? s.planOn : ''].join(' ')}
                onClick={() => {
                  setPlanPick(p.key);
                  setSelected(null);
                  setBeat(1);
                }}
                title="Vue propre au plan-séquence : caméra et comédiens placés temps par temps"
                data-testid="fp-oneshot-view"
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              className={s.planAdd}
              onClick={() => {
                const key = mutateDoc((d) => addPlan(d, seqId));
                if (key) setPlanPick(key);
                setSelected(null);
              }}
              data-testid="add-plan"
            >
              + Nouvelle vue
            </button>
            <button
              type="button"
              className={s.planAdd}
              title="Dupliquer cette vue"
              onClick={() => {
                const key = mutateDoc((d) => {
                  const k = addPlan(d, seqId);
                  d.floorPlans![k].items = JSON.parse(JSON.stringify(planOf(d, planKey).items));
                  return k;
                });
                if (key) setPlanPick(key);
              }}
            >
              <Copy size={12} /> Dupliquer
            </button>
            <button
              type="button"
              className={s.planAdd}
              data-testid="delete-plan"
              title={
                plans.length > 1
                  ? 'Supprimer cette vue'
                  : 'Vider cette vue (une séquence garde toujours une vue)'
              }
              onClick={() => {
                const name = plans.find((p) => p.key === planKey)?.name ?? 'cette vue';
                if (
                  planOf(doc, planKey).items.length &&
                  !window.confirm(`Supprimer « ${name} » et son contenu ? (annulable avec ⌘Z)`)
                )
                  return;
                mutateDoc((d) => deletePlan(d, planKey));
                setPlanPick(undefined);
                setSelected(null);
              }}
            >
              <Trash2 size={12} /> {plans.length > 1 && !psView ? 'Supprimer cette vue' : 'Vider la vue'}
            </button>
          </div>
          <div className={s.tools} role="toolbar" aria-label="Outils du plan au sol">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={[s.tool, tool === t.key ? s.on : ''].join(' ')}
                aria-pressed={tool === t.key}
                onClick={() => setTool(t.key)}
                data-testid={`tool-${t.key}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
            <Hand className={s.toolHint}>
              {tool === 'select'
                ? 'glisser pour déplacer · R pour pivoter · Suppr pour retirer'
                : isLineKind(tool)
                  ? 'cliquer-glisser pour tracer · Échap pour finir'
                  : 'cliquer pour placer · Échap pour finir'}
            </Hand>
          </div>
          <div className={s.viewBar}>
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoomer" title="Zoomer (ou pincer)">+</button>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Dézoomer" title="Dézoomer">−</button>
            <button type="button" onClick={fitView} data-testid="fp-fit" title="Recentrer sur les éléments">Recentrer</button>
            <span className={s.viewSep} />
            <label className={s.bgBtn} title="Plan des locaux en fond, pour dessiner les murs par-dessus">
              {bg ? 'Changer le fond' : 'Fond de plan'}
              <input
                type="file"
                accept="image/*"
                className="visually-hidden"
                data-testid="fp-bg-input"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f?.type.startsWith('image/')) return;
                  const key = await putBlob(doc.project.id, f.name, f);
                  mutateDoc((d) => {
                    const p = (d.floorPlans ??= {})[planKey] ?? ((d.floorPlans[planKey] = { items: [] }) as FloorPlan);
                    p.bg = { blobKey: key, opacity: 0.45, x: 0, y: 0, w: PLAN_W };
                  });
                }}
              />
            </label>
            {bg && (
              <>
                <button type="button" className={bgEdit ? s.on : ''} aria-pressed={bgEdit} onClick={() => setBgEdit(!bgEdit)} title="Glisser pour déplacer l’image, molette ou pincement pour l’agrandir" data-testid="fp-bg-edit">
                  Ajuster le fond
                </button>
                {bgEdit && (
                  <>
                    <button type="button" onClick={() => scaleBg(1 / 1.15)} aria-label="Réduire le fond">−</button>
                    <button type="button" onClick={() => scaleBg(1.15)} aria-label="Agrandir le fond">+</button>
                  </>
                )}
                <label className={s.bgRange}>
                  opacité
                  <input type="range" min={0.05} max={1} step={0.05} value={bg.opacity} onChange={(e) => mutateDoc((d) => void (d.floorPlans![planKey].bg!.opacity = Number(e.target.value)))} aria-label="Opacité du fond" />
                </label>
                <button type="button" onClick={() => mutateDoc((d) => void delete d.floorPlans![planKey].bg)} title="Retirer le fond">×</button>
              </>
            )}
            <span className={s.viewSep} />
            <button
              type="button"
              className={s.aiBtn}
              title={bg ? 'Copier les consignes, calculées pour l’image de fond, à donner à une IA avec cette même image' : 'Copier les consignes à donner à une IA avec l’image du plan des locaux'}
              onClick={async () => {
                const text = aiPlanInstructions(bg && nat ? { ratio: nat.h / nat.w, pixels: nat } : {});
                await navigator.clipboard.writeText(text).catch(() => undefined);
                useUi.getState().toast({
                  message: bg
                    ? 'Consignes copiées pour cette image : donnez-les à votre IA avec la même image, demandez un fichier plan.md, puis importez-le ici.'
                    : 'Consignes copiées : donnez-les à votre IA avec l’image du plan, demandez un fichier plan.md, puis importez-le ici. Conseil : posez d’abord l’image en fond pour un calage exact.',
                });
              }}
              data-testid="fp-ai-copy"
            >
              Consignes IA
            </button>
            <label className={s.aiBtn} title="Importer le fichier Markdown (.md) produit par l’IA : il est analysé puis oublié">
              Importer le fichier .md
              <input
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="visually-hidden"
                data-testid="fp-ai-file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const plan = parsePlanFile(await f.text());
                  setGhost({ dx: 0, dy: 0, k: 1 });
                  setRealScale(false);
                  setBgEdit(false);
                  setMdImport({ name: f.name, plan });
                }}
              />
            </label>
          </div>
          {mdImport && (
            <div className={s.mdBox} data-testid="fp-ai-report">
              <p className={s.mdHead}>
                <b>{mdImport.name}</b> · {mdImport.plan.walls.length} murs, {mdImport.plan.doors.length} portes, {mdImport.plan.windows.length} fenêtres · repère {mdImport.plan.mode === 'image' ? `image ${mdImport.plan.grid.w}×${mdImport.plan.grid.h}` : 'cm'}
                {mdImport.plan.scale ? ` · 1 unité ≈ ${mdImport.plan.scale} cm` : ' · échelle inconnue'}
              </p>
              {mdImport.plan.errors.length > 0 && (
                <ul className={s.mdErrors} data-testid="fp-ai-errors">
                  {mdImport.plan.errors.slice(0, 12).map((x, i) => (
                    <li key={i}>
                      {x.line ? `ligne ${x.line} : ` : ''}
                      {x.message}
                    </li>
                  ))}
                  {mdImport.plan.errors.length > 12 && <li>… et {mdImport.plan.errors.length - 12} autre(s) écart(s).</li>}
                </ul>
              )}
              {mdImport.plan.warnings.map((x, i) => (
                <p key={i} className={s.mdWarn}>{x.message}</p>
              ))}
              {placed && (
                <div className={s.mdTools}>
                  <Hand>aperçu en pointillés : glisser pour déplacer, molette ou boutons pour l’échelle</Hand>
                  <button type="button" onClick={() => setGhost((g) => ({ ...g, k: g.k / 1.1 }))} aria-label="Réduire les murs importés">−</button>
                  <span className="mono" data-testid="fp-ai-scale">{Math.round(ghost.k * 100)} %</span>
                  <button type="button" onClick={() => setGhost((g) => ({ ...g, k: g.k * 1.1 }))} aria-label="Agrandir les murs importés">+</button>
                  <button type="button" onClick={() => setGhost({ dx: 0, dy: 0, k: 1 })}>Réinitialiser</button>
                  {(mdImport.plan.scale || mdImport.plan.mode === 'cm') && (
                    <label title="1 unité du plan au sol = 1 cm (1 carreau = 20 cm) : caméras et comédiens à la bonne taille">
                      <input type="checkbox" checked={realScale} onChange={(e) => setRealScale(e.target.checked)} data-testid="fp-ai-real" />
                      échelle réelle{bg && mdImport.plan.mode === 'image' ? ' (le fond suit)' : ''}
                    </label>
                  )}
                </div>
              )}
              <div>
                <Button variant="ghost" onClick={() => setMdImport(null)}>
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  data-testid="fp-ai-apply"
                  disabled={!placed || !(placed.walls.length + placed.doors.length + placed.windows.length)}
                  onClick={() => {
                    if (!placed) return;
                    const g = ghost;
                    const scale = mdImport.plan.mode === 'cm' ? 1 : mdImport.plan.scale;
                    mutateDoc((d) => {
                      // Le fond suit l'échelle réelle et l'ajustement, pour rester sous les murs.
                      const b = d.floorPlans?.[planKey]?.bg;
                      if (b && mdImport.plan.mode === 'image') {
                        const w0 = realScale && scale ? mdImport.plan.grid.w * scale : b.w;
                        Object.assign(b, { x: gx(b.x, g), y: gy(b.y, g), w: w0 * g.k });
                      }
                      for (const w of placed.walls) {
                        const id = addFloorItem(d, planKey, 'wall', { x: 0, y: 0 });
                        updateFloorItem(d, planKey, id, { x: gx(w.x, g), y: gy(w.y, g), x2: gx(w.x2, g), y2: gy(w.y2, g), ...(w.white ? { white: true } : {}) } as Partial<FloorItem>);
                      }
                      for (const [kind, list] of [['door', placed.doors], ['window', placed.windows]] as const)
                        for (const o of list) {
                          const id = addFloorItem(d, planKey, kind, { x: 0, y: 0 });
                          updateFloorItem(d, planKey, id, { x: gx(o.x, g), y: gy(o.y, g), width: Math.max(10, Math.round(o.width * g.k)), rot: o.rot } as Partial<FloorItem>);
                        }
                    });
                    useUi.getState().toast({ message: `${placed.walls.length} murs, ${placed.doors.length} portes et ${placed.windows.length} fenêtres placés (modifiables, annulable avec ⌘Z).` });
                    setMdImport(null);
                  }}
                >
                  Valider et placer
                </Button>
              </div>
            </div>
          )}
          {psShots.length > 0 && (
            <div className={s.beats} role="radiogroup" aria-label="Temps du plan-séquence" data-testid="fp-beats">
              <span>Plan-séquence {psShots.map((id) => shotCode(doc, id)).join(', ')} · temps</span>
              <button type="button" role="radio" aria-checked={beat === null} className={beat === null ? s.on : ''} onClick={() => setBeat(null)}>
                Tous
              </button>
              {Array.from({ length: nBeats }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={beat === n} className={beat === n ? s.on : ''} onClick={() => setBeat(n)} data-testid={`fp-beat-${n}`}>
                  T{n}
                </button>
              ))}
              <em>{beat ? `les caméras et comédiens placés maintenant sont au temps T${beat}` : 'choisissez un temps pour placer caméra et comédiens à chaque étape'}</em>
            </div>
          )}
          <svg
            ref={svgRef}
            className={[s.canvas, tool !== 'select' ? s.placing : ''].join(' ')}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onPointerDown={onCanvasDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onKeyDown={onKey}
            tabIndex={0}
            role="application"
            aria-label={`Plan au sol de la séquence ${sequenceHeading(doc, seqId)}`}
            data-testid="floorplan"
          >
            <defs>
              <pattern id="fp-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="var(--rule)" strokeWidth="0.6" />
              </pattern>
              <filter id="fp-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="10" />
              </filter>
              <marker
                id="fp-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="var(--navy)" />
              </marker>
            </defs>
            <rect data-bg="1" x={WORLD.min} y={WORLD.min} width={WORLD.max - WORLD.min} height={WORLD.max - WORLD.min} fill="url(#fp-grid)" />
            {bg && bgUrl && (() => {
              const off = drag?.mode === 'bg' ? { x: drag.to.x - drag.from.x, y: drag.to.y - drag.from.y } : { x: 0, y: 0 };
              return (
                <>
                  <image href={bgUrl} x={bg.x + off.x} y={bg.y + off.y} width={bg.w} height={bg.w * bgRatio} preserveAspectRatio="none" opacity={bg.opacity} pointerEvents="none" data-testid="fp-background" />
                  {bgEdit && <rect x={bg.x + off.x} y={bg.y + off.y} width={bg.w} height={bg.w * bgRatio} className={s.bgFrame} pointerEvents="none" />}
                </>
              );
            })()}
            {beams.map((b, i) => (
              <g
                key={`beam-${b.sourceId}-${i}`}
                className={s.beamGroup}
                data-testid={b.intensity < 1 ? 'fp-bounce' : 'fp-beam'}
              >
                <defs>
                  <radialGradient
                    id={`fp-light-${i}`}
                    cx={b.x}
                    cy={b.y}
                    r={b.range}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0" stopColor="var(--ochre)" stopOpacity={Math.min(0.85, (b.soft ? 0.32 : 0.55) * b.intensity)} />
                    <stop offset={b.soft ? '0.8' : '0.6'} stopColor="var(--ochre)" stopOpacity={Math.min(0.5, (b.soft ? 0.18 : 0.22) * b.intensity)} />
                    <stop offset="1" stopColor="var(--ochre)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <polygon
                  points={b.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={`url(#fp-light-${i})`}
                  filter={b.soft ? 'url(#fp-soft)' : undefined}
                />
              </g>
            ))}
            {shadows.map((sh, i) => (
              <polygon key={`shadow-${i}`} points={sh.map((p) => `${p.x},${p.y}`).join(' ')} className={s.shadow} data-testid="fp-shadow" />
            ))}
            {paths.map((p) => (
              <polyline
                key={p.key}
                points={p.points.map((q) => `${q.x},${q.y}`).join(' ')}
                className={p.kind === 'camera' ? s.camPath : s.actorPath}
                markerEnd={p.points.length > 1 ? 'url(#fp-arrow)' : undefined}
                data-testid="fp-choreo"
              />
            ))}
            {items.map((raw) => {
              const item = preview(raw);
              const itemBeat = item.kind === 'camera' || item.kind === 'actor' ? item.beat : undefined;
              return (
                <g key={item.id} opacity={psView && beat !== null && itemBeat !== undefined && itemBeat !== beat ? 0.25 : 1}>
                  <ItemShape doc={doc} item={item} selected={item.id === selected || multi.includes(item.id)} onDown={onItemDown} />
                  {itemBeat !== undefined && (
                    <text x={item.x + 14} y={item.y - 14} className={s.beatTag}>
                      T{itemBeat}
                    </text>
                  )}
                </g>
              );
            })}
            {drag?.mode === 'box' && (
              <rect
                x={Math.min(drag.from.x, drag.to.x)}
                y={Math.min(drag.from.y, drag.to.y)}
                width={Math.abs(drag.to.x - drag.from.x)}
                height={Math.abs(drag.to.y - drag.from.y)}
                className={s.marquee}
                data-testid="fp-marquee"
              />
            )}
            {placed && (
              <g data-ghost="1" className={s.ghost} data-testid="fp-ai-ghost">
                {placed.walls.map((w, i) => (
                  <line key={`w${i}`} x1={gx(w.x)} y1={gy(w.y)} x2={gx(w.x2)} y2={gy(w.y2)} />
                ))}
                {[...placed.doors, ...placed.windows].map((o, i) => (
                  <line key={`o${i}`} className={s.ghostOpen} x1={gx(o.x)} y1={gy(o.y)} x2={gx(o.x + Math.cos((o.rot * Math.PI) / 180) * o.width)} y2={gy(o.y + Math.sin((o.rot * Math.PI) / 180) * o.width)} />
                ))}
              </g>
            )}
            {drag?.mode === 'line' && (
              <line
                x1={snap(drag.from.x)}
                y1={snap(drag.from.y)}
                x2={snap(drag.to.x)}
                y2={snap(drag.to.y)}
                className={s[drag.kind]}
              />
            )}
          </svg>
        </div>

        <aside className={['card', s.panel].join(' ')} aria-label="Propriétés">
          {sel && (
            <Properties
              doc={doc}
              seqId={seqId}
              planKey={planKey}
              item={sel}
              beats={nBeats}
              onDelete={() => setSelected(null)}
            />
          )}
          <div className={sel ? s.coverage : undefined}>
            <h2 className={s.h2}>Plans du découpage</h2>
            <p className={s.note}>
              {seq.shotIds.filter((id) => camerasForShot(doc, id).length > 0).length} / {seq.shotIds.length}{' '}
              plans reliés à une caméra (toutes vues). Relier une caméra est facultatif.
            </p>
            <ul className={s.shotList}>
              {seq.shotIds.map((id) => {
                const cams = camerasForShot(doc, id);
                const sh = doc.shots[id];
                return (
                  <li key={id} data-testid="fp-shot" className={cams.length ? undefined : s.unassigned}>
                    <b>{shotCode(doc, id)}</b> {sh.subject} · {sh.value} ·{' '}
                    {formatFocal(sh.focal, isZoom(sh.movement))}
                    {cams.length > 0 ? <em>{cams.join(', ')}</em> : <em className={s.none}>non assigné</em>}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ItemShape({
  doc,
  item,
  selected,
  onDown,
}: {
  doc: ProjectDoc;
  item: FloorItem;
  selected: boolean;
  onDown: (e: PointerEvent, id: ID, mode?: 'move' | 'rotate' | 'path') => void;
}) {
  const cls = [s.item, selected ? s.sel : ''].join(' ');
  const handle = (rot: number, r = 46) => {
    const a = (rot * Math.PI) / 180;
    return { cx: item.x + Math.cos(a) * r, cy: item.y + Math.sin(a) * r };
  };
  switch (item.kind) {
    case 'camera': {
      const cone = cameraCone(doc, item);
      const h = handle(item.rot, 54);
      return (
        <g className={cls} data-testid="fp-camera">
          <polygon points={cone.points.map((p) => `${p.x},${p.y}`).join(' ')} className={s.cone} />
          <g transform={`rotate(${item.rot} ${item.x} ${item.y})`} onPointerDown={(e) => onDown(e, item.id)}>
            <rect x={item.x - 16} y={item.y - 11} width={28} height={22} rx={3} className={s.camBody} />
            <polygon
              points={`${item.x + 12},${item.y - 6} ${item.x + 22},${item.y - 11} ${item.x + 22},${item.y + 11} ${item.x + 12},${item.y + 6}`}
              className={s.camBody}
            />
          </g>
          <text x={item.x} y={item.y + 32} className={s.label}>
            {item.label}
            {cone.focal ? ` · ${cone.focal}mm · ${Math.round(cone.fov)}°` : ''}
          </text>
          {selected && (
            <circle
              {...h}
              r={7}
              className={s.handle}
              onPointerDown={(e) => onDown(e, item.id, 'rotate')}
              data-testid="fp-rotate"
            />
          )}
        </g>
      );
    }
    case 'actor':
      return (
        <g className={cls} data-testid="fp-actor">
          {item.to && (
            <>
              <line
                x1={item.x}
                y1={item.y}
                x2={item.to.x}
                y2={item.to.y}
                className={s.path}
                markerEnd="url(#fp-arrow)"
              />
              {selected && (
                <circle
                  cx={item.to.x}
                  cy={item.to.y}
                  r={7}
                  className={s.handle}
                  onPointerDown={(e) => onDown(e, item.id, 'path')}
                />
              )}
            </>
          )}
          {/* Vu de dessus : épaules, tête, yeux et nez dans la direction du regard. */}
          <g transform={`rotate(${(item.rot ?? 90) - 90} ${item.x} ${item.y})`} onPointerDown={(e) => onDown(e, item.id)}>
            <ellipse cx={item.x} cy={item.y} rx={17} ry={7} className={s.shoulders} />
            <circle cx={item.x} cy={item.y} r={8.5} className={s.actor} />
            <circle cx={item.x - 3.2} cy={item.y + 5.6} r={1.3} className={s.eye} />
            <circle cx={item.x + 3.2} cy={item.y + 5.6} r={1.3} className={s.eye} />
            <path d={`M ${item.x - 1.6} ${item.y + 8} L ${item.x} ${item.y + 11} L ${item.x + 1.6} ${item.y + 8}`} className={s.nose} />
          </g>
          <text x={item.x} y={item.y - 13} className={s.actorText}>
            {item.label}
          </text>
          {selected && (
            <circle
              {...handle(item.rot ?? 90, 30)}
              r={6}
              className={s.handle}
              onPointerDown={(e) => onDown(e, item.id, 'rotate')}
              data-testid="fp-actor-rotate"
            />
          )}
          {item.characterId && doc.characters[item.characterId] && (
            <text x={item.x} y={item.y + 32} className={s.label}>
              {doc.characters[item.characterId].name}
            </text>
          )}
        </g>
      );
    case 'reflector':
    case 'diffuser':
    case 'flag':
      return (
        <g className={cls} onPointerDown={(e) => onDown(e, item.id)} data-testid={`fp-${item.kind}`}>
          <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.hit} />
          <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s[item.kind]} />
          <text x={(item.x + item.x2) / 2} y={(item.y + item.y2) / 2 - 10} className={s.label}>
            {item.label}
          </text>
        </g>
      );
    case 'wall':
    case 'rail':
      return (
        <g className={cls} onPointerDown={(e) => onDown(e, item.id)}>
          <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.hit} />
          <line
            x1={item.x}
            y1={item.y}
            x2={item.x2}
            y2={item.y2}
            className={item.kind === 'wall' ? (item.white ? s.wallWhite : s.wall) : s.rail}
          />
        </g>
      );
    case 'door':
    case 'window': {
      const h = handle(item.rot + 90, 40);
      return (
        <g className={cls}>
          <g transform={`rotate(${item.rot} ${item.x} ${item.y})`} onPointerDown={(e) => onDown(e, item.id)}>
            {item.kind === 'door' ? (
              <>
                <line x1={item.x} y1={item.y} x2={item.x + item.width} y2={item.y} className={s.doorGap} />
                <path
                  d={`M ${item.x} ${item.y} L ${item.x} ${item.y + item.width} A ${item.width} ${item.width} 0 0 0 ${item.x + item.width} ${item.y}`}
                  className={s.door}
                />
              </>
            ) : (
              <rect x={item.x} y={item.y - 4} width={item.width} height={8} className={s.window} />
            )}
          </g>
          {selected && (
            <circle {...h} r={7} className={s.handle} onPointerDown={(e) => onDown(e, item.id, 'rotate')} />
          )}
        </g>
      );
    }
    case 'light': {
      const h = handle(item.rot, 40);
      return (
        <g className={cls}>
          <g transform={`rotate(${item.rot} ${item.x} ${item.y})`} onPointerDown={(e) => onDown(e, item.id)}>
            <rect x={item.x + 8} y={item.y - 9} width={10} height={18} rx={2} className={s.light} />
            <circle cx={item.x} cy={item.y} r={12} className={s.light} />
          </g>
          <text x={item.x} y={item.y + 28} className={s.label}>
            {item.label}
          </text>
          {selected && (
            <circle {...h} r={7} className={s.handle} onPointerDown={(e) => onDown(e, item.id, 'rotate')} />
          )}
        </g>
      );
    }
  }
}

const KIND_LABEL: Record<FloorKind, string> = {
  camera: 'Caméra',
  actor: 'Comédien',
  wall: 'Mur',
  rail: 'Rails',
  door: 'Porte',
  window: 'Fenêtre',
  light: 'Source de lumière',
  reflector: 'Réflecteur',
  diffuser: 'Diffuseur',
  flag: 'Drapeau (négatif)',
};

function Properties({
  doc,
  seqId,
  planKey,
  item,
  beats,
  onDelete,
}: {
  doc: ProjectDoc;
  seqId: ID;
  planKey: string;
  item: FloorItem;
  beats: number;
  onDelete: () => void;
}) {
  const update = (patch: Partial<FloorItem>) => mutateDoc((d) => updateFloorItem(d, planKey, item.id, patch));
  const seq = doc.sequences[seqId];
  return (
    <div className={s.props} data-testid="fp-properties">
      <h2 className={s.h2}>{KIND_LABEL[item.kind]}</h2>
      {item.kind === 'wall' && (
        <label className={s.check}>
          <input type="checkbox" checked={!!item.white} onChange={(e) => update({ white: e.target.checked } as Partial<FloorItem>)} />
          Mur blanc (renvoie un peu la lumière)
        </label>
      )}
      {(item.kind === 'camera' ||
        item.kind === 'light' ||
        item.kind === 'actor' ||
        item.kind === 'reflector' ||
        item.kind === 'diffuser' ||
        item.kind === 'flag') && (
        <label className={s.field}>
          <span>Repère</span>
          <input
            value={item.label ?? ''}
            onChange={(e) => update({ label: e.target.value } as Partial<FloorItem>)}
          />
        </label>
      )}
      {beats > 0 && (item.kind === 'camera' || item.kind === 'actor') && (
        <label className={s.field}>
          <span>Temps</span>
          <select value={item.beat ?? 0} onChange={(e) => update({ beat: Number(e.target.value) || undefined } as Partial<FloorItem>)} aria-label="Temps du plan-séquence">
            <option value={0}>fixe (tous les temps)</option>
            {Array.from({ length: beats }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                T{n}
              </option>
            ))}
          </select>
        </label>
      )}
      {item.kind === 'camera' && (
        <>
          <p className={s.note}>
            {(() => {
              const c = cameraCone(doc, item);
              return c.focal
                ? `${c.focal} mm → angle horizontal ${c.fov.toFixed(1).replace('.', ',')}°`
                : 'Liez un plan pour calculer le cône (60° par défaut).';
            })()}
          </p>
          <fieldset className={s.links}>
            <legend>Plans couverts</legend>
            {seq.shotIds.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={item.shotIds.includes(id)}
                  onChange={(e) =>
                    update({
                      shotIds: e.target.checked
                        ? [...item.shotIds, id]
                        : item.shotIds.filter((x) => x !== id),
                    } as Partial<FloorItem>)
                  }
                />
                <b>{shotCode(doc, id)}</b> {doc.shots[id].value} ·{' '}
                {formatFocal(doc.shots[id].focal, isZoom(doc.shots[id].movement)) || '—'}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {item.kind === 'actor' && (
        <>
          <label className={s.field}>
            <span>Personnage</span>
            <select
              value={item.characterId ?? ''}
              onChange={(e) => update({ characterId: e.target.value || undefined } as Partial<FloorItem>)}
            >
              <option value="">—</option>
              {sortedCharacters(doc).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className={s.quick} aria-label="Nommer rapidement">
            {sequenceCharacterIds(doc, seqId)
              .concat(
                sortedCharacters(doc)
                  .map((c) => c.id)
                  .filter((id) => !sequenceCharacterIds(doc, seqId).includes(id)),
              )
              .slice(0, 12)
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  className={item.characterId === id ? s.quickOn : ''}
                  onClick={() => update({ characterId: id } as Partial<FloorItem>)}
                >
                  {doc.characters[id]?.name}
                </button>
              ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              update({
                to: item.to ? undefined : { x: Math.min(PLAN_W, item.x + 120), y: item.y },
              } as Partial<FloorItem>)
            }
          >
            {item.to ? 'Retirer le déplacement' : 'Ajouter un déplacement'}
          </Button>
        </>
      )}
      {item.kind === 'light' && (
        <>
          <label className={s.field}>
            <span>Focalisation : faisceau de {item.spread ?? DEFAULT_SPREAD}° ({(item.spread ?? DEFAULT_SPREAD) <= 30 ? 'serré' : (item.spread ?? DEFAULT_SPREAD) >= 90 ? 'large' : 'moyen'})</span>
            <input
              type="range"
              min={10}
              max={160}
              step={5}
              value={item.spread ?? DEFAULT_SPREAD}
              onChange={(e) => update({ spread: Number(e.target.value) } as Partial<FloorItem>)}
              aria-label="Ouverture du faisceau"
            />
          </label>
          <label className={s.field}>
            <span>Portée</span>
            <input
              type="range"
              min={80}
              max={700}
              step={20}
              value={item.range ?? DEFAULT_RANGE}
              onChange={(e) => update({ range: Number(e.target.value) } as Partial<FloorItem>)}
              aria-label="Portée"
            />
          </label>
          <label className={s.field}>
            <span>Puissance : {Math.round((item.power ?? 1) * 100)} %</span>
            <input type="range" min={0.2} max={1.6} step={0.1} value={item.power ?? 1} onChange={(e) => update({ power: Number(e.target.value) } as Partial<FloorItem>)} aria-label="Puissance" />
          </label>
          <p className={s.note}>Un réflecteur renvoie la lumière, un diffuseur l’adoucit et l’élargit, un drapeau la coupe et projette une ombre.</p>
        </>
      )}
      {item.kind === 'reflector' && (
        <p className={s.note}>
          Taille {Math.round(reflectorSize(item) / 20) * 20} unités. Plus il est grand, plus la lumière
          renvoyée est large et douce. Pour le redimensionner, retracez-le.
        </p>
      )}
      {(item.kind === 'door' || item.kind === 'window') && (
        <label className={s.field}>
          <span>Largeur</span>
          <input
            type="number"
            min={20}
            step={10}
            value={item.width}
            onChange={(e) =>
              update({ width: Math.max(20, Number(e.target.value) || 20) } as Partial<FloorItem>)
            }
          />
        </label>
      )}
      <Button
        variant="danger"
        size="sm"
        icon={<Trash2 size={13} />}
        onClick={() => {
          mutateDoc((d) => removeFloorItem(d, planKey, item.id));
          onDelete();
        }}
      >
        Retirer
      </Button>
    </div>
  );
}
