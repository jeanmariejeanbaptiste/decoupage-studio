import { recoverStaleChunk } from '../../ui/staleChunk';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Copy,
  Layers,
  Sparkles,
  Maximize,
  Plus,
  ZoomIn,
  ZoomOut,
  RectangleVertical,
  DoorOpen,
  Lightbulb,
  MousePointer2,
  Minus,
  Square,
  Trash2,
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
  duplicatePlan,
  DEFAULT_RANGE,
  DEFAULT_SPREAD,
  computeLighting,
  plansOf,
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
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { ask } from '../../ui/dialogStore';
import { useDraft } from '../../ui/useDraft';
import { useUi } from '../../store/uiStore';
import { putBlob } from '../../store/db';
import { useBlobUrl } from '../../ui/useBlobUrl';
import { aiPlanInstructions, extractPlanText, parsePlanFile, placePlan, type ParsedPlan } from '../../domain/planImport';
import { askWithImage, isConfigured, loadAiSettings, modelOf, type ImageInput } from '../assistant/providers';
import { navigate } from '../../app/router';
import { LIGHT_PRESETS, ROOM_PRESETS, WORLD, lightSpecs, roomSize, setRoom, type FloorPlan, type Room } from '../../domain/floorplan';
import { Button } from '../../ui/Button';
import s from './FloorPlanPage.module.css';
import { CineCameraIcon, FresnelIcon, RailsIcon } from './icons';
import { CAMERA, FRESNEL, labelBehind, type SymbolShape } from '../../domain/floorSymbols';
import { allFloorPlans, floorPlanSvg } from '../../domain/exports';
import { exportSvgPages } from '../export/imageExport';
import { ExportPanel } from '../export/ExportPanel';
import { downloadWord } from '../export/docExport';
import { downloadBlob } from '../../store/persistence';
import { floorPlansDocument } from '../../domain/documents';

type Tool = 'select' | FloorKind | 'practical';
/** Outils rangés par famille : décor, équipe et machinerie, lumière. */
const TI = { size: 17, strokeWidth: 1.3 } as const;
const TOOL_GROUPS: Array<{ label: string; tools: Array<{ key: Tool; label: string; icon: JSX.Element; hotkey?: string }> }> = [
  { label: 'Sélection', tools: [{ key: 'select', label: 'Sélection', icon: <MousePointer2 {...TI} />, hotkey: 'V' }] },
  {
    label: 'Décor',
    tools: [
      { key: 'wall', label: 'Mur', icon: <Minus {...TI} />, hotkey: 'M' },
      { key: 'door', label: 'Porte', icon: <DoorOpen {...TI} />, hotkey: 'P' },
      { key: 'window', label: 'Fenêtre', icon: <Square {...TI} />, hotkey: 'F' },
    ],
  },
  {
    label: 'Plateau',
    tools: [
      { key: 'camera', label: 'Caméra', icon: <CineCameraIcon />, hotkey: 'C' },
      { key: 'rail', label: 'Rails', icon: <RailsIcon /> },
      { key: 'actor', label: 'Comédien', icon: <User {...TI} />, hotkey: 'A' },
    ],
  },
  {
    label: 'Lumière',
    tools: [
      { key: 'light', label: 'Projecteur', icon: <FresnelIcon />, hotkey: 'L' },
      { key: 'practical', label: 'Lampe de jeu', icon: <Lightbulb {...TI} /> },
      { key: 'reflector', label: 'Réflecteur', icon: <RectangleVertical {...TI} /> },
      { key: 'diffuser', label: 'Diffuseur', icon: <Grid2x2 {...TI} /> },
      { key: 'flag', label: 'Drapeau', icon: <Flag {...TI} /> },
    ],
  },
];
const HOTKEYS: Record<string, Tool> = Object.fromEntries(TOOL_GROUPS.flatMap((g) => g.tools.filter((x) => x.hotkey).map((x) => [x.hotkey!.toLowerCase(), x.key])));

/**
 * Un geste (curseur glissé, touches fléchées) = une seule étape d'annulation : la première
 * modification est retenue, les suivantes remplacent l'état sans s'ajouter à l'historique.
 */
const gesture = { on: false };
function gestureMutate(fn: (d: ProjectDoc) => void) {
  mutateDoc(fn);
  if (!gesture.on) {
    gesture.on = true;
    useProjectStore.temporal.getState().pause();
  }
}
function endGesture() {
  if (!gesture.on) return;
  gesture.on = false;
  useProjectStore.temporal.getState().resume();
}
const gestureEnd = { onPointerUp: endGesture, onKeyUp: endGesture, onBlur: endGesture };

type Drag =
  | { mode: 'move'; id: ID; from: Point; to: Point }
  | { mode: 'rotate'; id: ID; from: Point; to: Point }
  | { mode: 'path'; id: ID; from: Point; to: Point }
  | { mode: 'end1' | 'end2'; id: ID; from: Point; to: Point }
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
const handleOffset = (item: FloorItem) => (item.kind === 'door' || item.kind === 'window' ? 90 : 0);

type View = { x: number; y: number; w: number; h: number };

/**
 * Mémoire de la page entre deux visites : séquence, vue et cadrage (zoom, déplacement) de chaque vue,
 * conservés aussi après un rechargement (par navigateur, sans toucher au projet).
 */
const memory: { seq?: ID; pick?: string; views: Record<string, View> } = (() => {
  try {
    return { views: JSON.parse(localStorage.getItem('fp-views') ?? '{}') as Record<string, View> };
  } catch {
    return { views: {} };
  }
})();
const rememberView = (key: string, v: View) => {
  memory.views[key] = v;
  try {
    localStorage.setItem('fp-views', JSON.stringify(memory.views));
  } catch {
    /* stockage indisponible : la vue reste en mémoire pour la session */
  }
};

/** Plan au sol par séquence (§15.2). */
export function FloorPlanPage({ doc }: { doc: ProjectDoc }) {
  const [seqId, setSeqId] = useState<ID | undefined>(memory.seq && doc.sequences[memory.seq] ? memory.seq : doc.project.sequenceIds[0]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<ID | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Zoom et déplacement : fenêtre visible du plan (bornée), recentrable.
  const [view, setView] = useState<View>({ x: 0, y: 0, w: PLAN_W, h: PLAN_H });
  // Le cadre visible prend les proportions de la zone de dessin : pas de bandes vides, et le point
  // sous le pointeur reste exact pour le zoom.
  const aspectRef = useRef(PLAN_H / PLAN_W);
  const fitAspect = (v: View): View => {
    const h = v.w * aspectRef.current;
    return Math.abs(h - v.h) < 0.01 ? v : { ...v, y: v.y + (v.h - h) / 2, h };
  };
  // Import du fichier .md de l'IA : analysé en mémoire, jamais conservé.
  const [mdImport, setMdImport] = useState<{ name: string; plan: ParsedPlan } | null>(null);
  const [realScale, setRealScale] = useState(false);
  const [bgEdit, setBgEdit] = useState(false);
  const [multi, setMulti] = useState<ID[]>([]);
  const [ghost, setGhost] = useState<Ghost>({ dx: 0, dy: 0, k: 1 });
  const ghostOnRef = useRef(false);

  const [planPick, setPlanPick] = useState<string | undefined>(memory.pick);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [planMenu, setPlanMenu] = useState(false);
  const planMenuRef = useRef<HTMLDivElement>(null);
  const [tracing, setTracing] = useState(false);
  const bgInput = useRef<HTMLInputElement>(null);
  const aiInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!planMenu) return;
    const away = (e: globalThis.PointerEvent) => !planMenuRef.current?.contains(e.target as Node) && setPlanMenu(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setPlanMenu(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [planMenu]);
  useEffect(() => {
    if (!seqId || !doc.sequences[seqId]) setSeqId(doc.project.sequenceIds[0]);
  }, [doc, seqId]);

  const plans = seqId ? plansOf(doc, seqId) : [];
  const psPlans = seqId ? oneShotPlansOf(doc, seqId) : [];
  const planKey = [...plans, ...psPlans].find((p) => p.key === planPick)?.key ?? seqId ?? '';
  const psView = psPlans.find((p) => p.key === planKey);
  // Retrouve le cadrage de cette vue tel qu'on l'a laissé, et le mémorise à chaque changement.
  const viewFor = useRef<string | null>(null);
  useEffect(() => {
    memory.seq = seqId;
    memory.pick = planPick;
  }, [seqId, planPick]);
  useEffect(() => {
    if (!planKey) return;
    if (viewFor.current !== planKey) {
      viewFor.current = planKey;
      setView(fitAspect(memory.views[planKey] ?? { x: 0, y: 0, w: PLAN_W, h: PLAN_H }));
      return;
    }
    rememberView(planKey, view);
  }, [planKey, view]);
  const items = useMemo(() => (planKey ? planOf(doc, planKey).items : []), [doc, planKey]);
  const lighting = useMemo(() => computeLighting(items), [items]);
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
          const h = w * aspectRef.current;
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
        const h = w * aspectRef.current;
        return { x: px - (px - v.x) * (w / v.w), y: py - (py - v.y) * (h / v.h), w, h };
      });
    };
    // La zone de dessin change de taille (fenêtre, panneau) : le cadre suit ses proportions.
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      aspectRef.current = r.height / r.width;
      setView((v) => fitAspect(v));
    });
    ro.observe(svg);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions);
    svg.addEventListener('gesturechange', onGesture, { passive: false } as AddEventListenerOptions);
    return () => {
      ro.disconnect();
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('gesturestart', onGestureStart);
      svg.removeEventListener('gesturechange', onGesture);
    };
  }, [planKey]);
  /** Recentre sur les éléments de la vue (ou tout le plan s'il est vide). */
  const fitView = () => {
    const pts = items.flatMap((i) => ('x2' in i ? [[i.x, i.y], [i.x2, i.y2]] : [[i.x, i.y]]));
    if (bg) pts.push([bg.x, bg.y], [bg.x + bg.w, bg.y + bg.w * bgRatio]);
    if (!pts.length) return setView(fitAspect({ x: 0, y: 0, w: PLAN_W, h: PLAN_H }));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 80, Math.max(...xs) + 80, Math.min(...ys) - 80, Math.max(...ys) + 80];
    const w = Math.min(ZOOM_MAX, Math.max(PLAN_W / 6, x1 - x0, (y1 - y0) / aspectRef.current));
    const h = w * aspectRef.current;
    setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
  };
  const zoomBy = (f: number) =>
    setView((v) => {
      const w = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.w * f));
      const h = w * aspectRef.current;
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
    // Bouton principal seulement (le clic droit ou du milieu ne pose rien) ; Safari ne donne pas le
    // focus clavier à un dessin SVG cliqué : on le lui donne.
    if (e.button !== 0) return;
    svgRef.current?.focus({ preventScroll: true });
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
        // Rectangle de sélection : glisser sur le fond pour sélectionner plusieurs éléments ;
        // avec Maj, la sélection en cours (même d'un seul élément) est complétée.
        if (e.shiftKey) setMulti(multi.length ? multi : selected ? [selected] : []);
        else setMulti([]);
        setSelected(null);
        svgRef.current?.setPointerCapture(e.pointerId);
        const p = toSvg(e);
        setDrag({ mode: 'box', from: p, to: p });
      }
      return;
    }
    const p = toSvg(e);
    setMulti([]);
    if (isLineKind(tool)) {
      svgRef.current?.setPointerCapture(e.pointerId);
      setDrag({ mode: 'line', kind: tool, from: p, to: p });
      return;
    }
    const id = mutateDoc((d) => {
      const nid = addFloorItem(d, planKey, tool === 'practical' ? 'light' : tool, p);
      if (tool === 'practical') {
        const n = planOf(d, planKey).items.filter((i) => i.kind === 'light' && i.practical).length + 1;
        updateFloorItem(d, planKey, nid, { practical: true, spread: 360, range: 170, power: 0.6, label: `P${n}` } as Partial<FloorItem>);
      }
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

  // Quel que soit l'outil actif, cliquer sur un élément existant le sélectionne et le déplace
  // (sans en créer un nouveau) ; l'outil reste actif pour le placement suivant.
  const onItemDown = (e: PointerEvent, id: ID, mode: 'move' | 'rotate' | 'path' | 'end1' | 'end2' = 'move') => {
    if (bgEdit || e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.focus({ preventScroll: true });
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
    setDrag({ mode, id, from: p, to: p });
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
    // Poignée saisie puis relâchée sans bouger : rien ne change.
    if (d0.mode !== 'move' && Math.hypot(d0.to.x - d0.from.x, d0.to.y - d0.from.y) < 1) return;
    if (d0.mode === 'move') {
      const dx = snap(d0.to.x - d0.from.x);
      const dy = snap(d0.to.y - d0.from.y);
      if (dx || dy) mutate((d) => moveFloorItem(d, planKey, item.id, dx, dy));
    } else if ((d0.mode === 'end1' || d0.mode === 'end2') && 'x2' in item) {
      const p = { x: snap(d0.to.x, 5), y: snap(d0.to.y, 5) };
      mutate((d) => updateFloorItem(d, planKey, item.id, (d0.mode === 'end1' ? { x: p.x, y: p.y } : { x2: p.x, y2: p.y }) as Partial<FloorItem>));
    } else if (d0.mode === 'rotate') {
      // La poignée d'une porte ou d'une fenêtre est posée à 90° de son axe.
      const rot = Math.round((deg(item, d0.to) - handleOffset(item)) / 5) * 5;
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
    // Lettres seules : choix de l'outil (V sélection, M mur, P porte, F fenêtre, C caméra, A comédien, L projecteur) ;
    // R reste la rotation de l'élément sélectionné.
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && HOTKEYS[e.key.toLowerCase()]) {
      e.preventDefault();
      setTool(HOTKEYS[e.key.toLowerCase()]);
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
      return { ...item, rot: Math.round((deg(item, drag.to) - handleOffset(item)) / 5) * 5 } as FloorItem;
    if ((drag.mode === 'end1' || drag.mode === 'end2') && 'x2' in item) {
      const p = { x: snap(drag.to.x, 5), y: snap(drag.to.y, 5) };
      return (drag.mode === 'end1' ? { ...item, x: p.x, y: p.y } : { ...item, x2: p.x, y2: p.y }) as FloorItem;
    }
    if (drag.mode === 'path' && item.kind === 'actor')
      return { ...item, to: { x: snap(drag.to.x), y: snap(drag.to.y) } };
    return item;
  };
  // Pendant qu'on déplace ou tourne un élément, la lumière et les ombres suivent.
  const { beams, shadows } = drag && (drag.mode === 'move' || drag.mode === 'rotate' || drag.mode === 'end1' || drag.mode === 'end2') ? computeLighting(items.map(preview)) : lighting;

  const seq = doc.sequences[seqId];

  const exportPanel = (
    <ExportPanel
      doc={doc}
      id="floorplan"
      title="Exporter les plans au sol (une page par vue)"
      extra={[
        { key: 'svg', label: 'SVG', hint: 'Toutes les vues en dessins vectoriels, dans un dossier compressé.' },
        { key: 'word', label: 'Word', hint: 'Document Word avec toutes les vues.' },
      ]}
      onExport={async ({ format, orientation, numbers }) => {
        try {
          const all = allFloorPlans(doc);
          const base = `${doc.project.title || 'projet'}-plans-au-sol`;
          if (format === 'pdf' || format === 'images') {
            const svgs = all.length ? all.map((p) => p.svg) : [floorPlanSvg(doc, planKey, sequenceHeading(doc, seqId))];
            return await exportSvgPages(svgs, `${base}-A4-${orientation === 'portrait' ? 'portrait' : 'paysage'}`, { format, orientation, numbers });
          }
          if (format === 'word') return downloadWord(floorPlansDocument(doc), base);
          const { default: JSZip } = await import('jszip');
          const zip = new JSZip();
          for (const p of all) zip.file(`${p.name.replace(/[\\/:*?"<>|]+/g, '-')}.svg`, p.svg);
          downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}.zip`);
        } catch (err) {
          if (recoverStaleChunk(err)) return;
          useUi.getState().toast({ message: `Export impossible : ${(err as Error).message}`, tone: 'warn' });
        }
      }}
    />
  );
  const pickView = (key: string | undefined) => {
    setPlanPick(key);
    setSelected(null);
    setMulti([]);
  };
  const stroke = planOf(doc, planKey).stroke ?? 1;

  return (
    <div className={['page page--wide', s.page].join(' ')}>
      <header className={s.toolbar}>
        <div className={s.tbLeft}>
          <select
            className={s.seqSelect}
            value={seqId}
            onChange={(e) => {
              setSeqId(e.target.value);
              pickView(undefined);
            }}
            aria-label="Séquence du plan au sol"
            data-view
          >
            {doc.project.sequenceIds.map((id) => (
              <option key={id} value={id}>
                {sequenceHeading(doc, id)}
              </option>
            ))}
          </select>
          <div className={s.plans} role="tablist" aria-label="Vues du plan au sol">
            {plans.map((p) =>
              renaming === p.key ? (
                <RenameField
                  key={p.key}
                  value={p.name}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name !== null && name !== p.name) mutateDoc((d) => renamePlan(d, p.key, name));
                  }}
                />
              ) : (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={p.key === planKey}
                  className={p.key === planKey ? s.planOn : ''}
                  onClick={() => pickView(p.key)}
                  onDoubleClick={() => setRenaming(p.key)}
                  title="Double-cliquer pour renommer"
                >
                  {p.name}
                </button>
              ),
            )}
            {psPlans.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={p.key === planKey}
                className={[s.psTab, p.key === planKey ? s.planOn : ''].join(' ')}
                onClick={() => {
                  pickView(p.key);
                  setBeat(1);
                }}
                title="Vue propre au plan-séquence : caméra et comédiens placés temps par temps"
                data-testid="fp-oneshot-view"
              >
                {p.name}
              </button>
            ))}
            <span className={s.planActions} data-edit>
              <Button
                variant="icon"
                size="sm"
                icon={<Plus size={14} strokeWidth={1.4} />}
                aria-label="Nouvelle vue"
                title="Nouvelle vue"
                onClick={() => {
                  const key = mutateDoc((d) => addPlan(d, seqId));
                  if (key) pickView(key);
                }}
                data-testid="add-plan"
              />
              <Button
                variant="icon"
                size="sm"
                icon={<Copy size={13} strokeWidth={1.4} />}
                aria-label="Dupliquer la vue"
                title="Dupliquer la vue"
                onClick={() => {
                  const key = mutateDoc((d) => duplicatePlan(d, seqId, planKey));
                  if (key) pickView(key);
                }}
              />
              <Button
                variant="icon"
                size="sm"
                icon={<Trash2 size={13} strokeWidth={1.4} />}
                aria-label={plans.length > 1 && !psView ? 'Supprimer la vue' : 'Vider la vue'}
                title={plans.length > 1 && !psView ? 'Supprimer la vue' : 'Vider la vue (une séquence garde toujours une vue)'}
                data-testid="delete-plan"
                onClick={async () => {
                  const name = [...plans, ...psPlans].find((p) => p.key === planKey)?.name ?? 'cette vue';
                  if (planOf(doc, planKey).items.length) {
                    const r = await ask({ title: plans.length > 1 && !psView ? `Supprimer « ${name} » ?` : `Vider « ${name} » ?`, body: 'Son contenu disparaît (annulable avec ⌘Z).', confirmLabel: plans.length > 1 && !psView ? 'Supprimer' : 'Vider', danger: true });
                    if (!r.ok) return;
                  }
                  mutateDoc((d) => deletePlan(d, planKey));
                  pickView(undefined);
                }}
              />
            </span>
          </div>
        </div>
        <div className={s.tbRight}>
          <div className={s.zoomGroup} data-view>
            <Button variant="icon" size="sm" icon={<ZoomOut size={15} strokeWidth={1.3} />} onClick={() => zoomBy(1.25)} aria-label="Dézoomer" title="Dézoomer" />
            <Button variant="icon" size="sm" icon={<ZoomIn size={15} strokeWidth={1.3} />} onClick={() => zoomBy(1 / 1.25)} aria-label="Zoomer" title="Zoomer (ou pincer)" />
            <Button variant="icon" size="sm" icon={<Maximize size={14} strokeWidth={1.3} />} onClick={fitView} aria-label="Recentrer" title="Recentrer sur les éléments" data-testid="fp-fit" />
          </div>
          <div className={s.menuWrap} ref={planMenuRef} data-edit>
            <Button variant="ghost" icon={<Layers size={15} strokeWidth={1.3} />} aria-expanded={planMenu} onClick={() => setPlanMenu(!planMenu)} data-testid="fp-plan-menu">
              Plan des locaux
            </Button>
            {planMenu && (
              <div className={s.menu} role="dialog" aria-label="Plan des locaux">
                <p className={s.menuTitle}>Image de fond</p>
                <div className={s.menuRow}>
                  <Button variant="outline" size="sm" onClick={() => bgInput.current?.click()}>
                    {bg ? 'Changer l’image…' : 'Choisir une image…'}
                  </Button>
                  {bg && (
                    <>
                      <Button
                        size="sm"
                        variant={bgEdit ? 'primary' : 'ghost'}
                        aria-pressed={bgEdit}
                        onClick={() => {
                          setBgEdit(!bgEdit);
                          setPlanMenu(false);
                        }}
                        title="Glisser pour déplacer l’image, molette ou pincement pour l’agrandir"
                        data-testid="fp-bg-edit"
                      >
                        Ajuster
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => mutateDoc((d) => void delete d.floorPlans![planKey].bg)}>
                        Retirer
                      </Button>
                    </>
                  )}
                </div>
                {bg && (
                  <label className={s.menuRange}>
                    <span>Opacité</span>
                    <input type="range" min={0.05} max={1} step={0.05} value={bg.opacity} onChange={(e) => gestureMutate((d) => void (d.floorPlans![planKey].bg!.opacity = Number(e.target.value)))} {...gestureEnd} aria-label="Opacité du fond" />
                  </label>
                )}
                <p className={s.menuTitle}>Pièce</p>
                <RoomFields key={planKey} room={planOf(doc, planKey).room} onCommit={(r) => mutateDoc((d) => setRoom(d, planKey, r))} />
                <p className={s.menuTitle}>Traits</p>
                <label className={s.menuRange} title="Épaisseur des traits : murs, rails, portes, fenêtres, réflecteurs, diffuseurs, drapeaux">
                  <span>Épaisseur</span>
                  <input
                    type="range"
                    min={0.3}
                    max={3}
                    step={0.1}
                    value={stroke}
                    onChange={(e) =>
                      gestureMutate((d) => {
                        const p = (d.floorPlans ??= {})[planKey] ?? ((d.floorPlans[planKey] = { items: [] }) as FloorPlan);
                        p.stroke = Number(e.target.value) === 1 ? undefined : Number(e.target.value);
                      })
                    }
                    {...gestureEnd}
                    aria-label="Épaisseur des traits"
                    data-testid="fp-stroke"
                  />
                </label>
                <p className={s.menuTitle}>Depuis un plan existant</p>
                {bg && (
                  <div className={s.menuRow}>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Sparkles size={14} strokeWidth={1.3} />}
                      disabled={tracing || !bgUrl}
                      title="L’assistant relève les murs, portes et fenêtres de l’image de fond ; vous validez l’aperçu avant qu’ils soient posés"
                      onClick={async () => {
                        const settings = loadAiSettings();
                        if (!isConfigured(settings)) {
                          setPlanMenu(false);
                          navigate('settings', { section: 'assistant' });
                          return;
                        }
                        if (!bgUrl) return;
                        setTracing(true);
                        try {
                          const img = await imageForAi(bgUrl);
                          const reply = await askWithImage(settings, aiPlanInstructions({ ratio: img.h / img.w, pixels: { w: img.w, h: img.h }, direct: true }), img.input);
                          const plan = parsePlanFile(extractPlanText(reply));
                          setGhost({ dx: 0, dy: 0, k: 1 });
                          setRealScale(false);
                          setBgEdit(false);
                          setMdImport({ name: `Assistant · ${modelOf(settings)}`, plan });
                          setPlanMenu(false);
                        } catch (err) {
                          if ((err as Error).name !== 'AbortError') useUi.getState().toast({ message: (err as Error).message || 'Lecture du plan impossible.', tone: 'warn' });
                        } finally {
                          setTracing(false);
                        }
                      }}
                      data-testid="fp-ai-trace"
                    >
                      {tracing ? 'Lecture du plan…' : 'Tracer les murs avec l’assistant'}
                    </Button>
                  </div>
                )}
                <div className={s.menuRow}>
                  <Button
                    size="sm"
                    variant="outline"
                    title={bg ? 'Copier les consignes, calculées pour l’image de fond, à donner à une IA avec cette même image' : 'Copier les consignes à donner à une IA avec l’image du plan des locaux'}
                    onClick={async () => {
                      const text = aiPlanInstructions(bg && nat ? { ratio: nat.h / nat.w, pixels: nat } : {});
                      await navigator.clipboard.writeText(text).catch(() => undefined);
                      setPlanMenu(false);
                      useUi.getState().toast({
                        message: bg
                          ? 'Consignes copiées pour cette image : donnez-les à votre IA avec la même image, demandez un fichier plan.md, puis importez-le ici.'
                          : 'Consignes copiées : donnez-les à votre IA avec l’image du plan, demandez un fichier plan.md, puis importez-le ici. Posez d’abord l’image en fond pour un calage exact.',
                      });
                    }}
                    data-testid="fp-ai-copy"
                  >
                    Copier les consignes pour une IA
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => aiInput.current?.click()} title="Importer le fichier Markdown (.md) produit par l’IA : il est analysé puis oublié">
                    Importer le .md…
                  </Button>
                </div>
              </div>
            )}
          </div>
          {exportPanel}
        </div>
      </header>
      {/* Fichiers choisis depuis le menu « Plan des locaux » (champs toujours présents). */}
      <input
        ref={bgInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        data-testid="fp-bg-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          setPlanMenu(false);
          if (!f?.type.startsWith('image/')) return;
          const key = await putBlob(doc.project.id, f.name, f);
          mutateDoc((d) => {
            const p = (d.floorPlans ??= {})[planKey] ?? ((d.floorPlans[planKey] = { items: [] }) as FloorPlan);
            p.bg = { blobKey: key, opacity: 0.45, x: 0, y: 0, w: PLAN_W };
          });
        }}
      />
      <input
        ref={aiInput}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="visually-hidden"
        data-testid="fp-ai-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          setPlanMenu(false);
          if (!f) return;
          const plan = parsePlanFile(await f.text());
          setGhost({ dx: 0, dy: 0, k: 1 });
          setRealScale(false);
          setBgEdit(false);
          setMdImport({ name: f.name, plan });
        }}
      />

      <div className={s.layout}>
        <div className={s.stageCol}>
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
          <div className={s.stage}>
            <div className={s.palette} role="toolbar" aria-label="Outils du plan au sol" aria-orientation="vertical" data-edit>
              {TOOL_GROUPS.map((g) => (
                <div key={g.label} className={s.paletteGroup} role="group" aria-label={g.label}>
                  {g.tools.map((x) => (
                    <button
                      key={x.key}
                      type="button"
                      className={[s.paletteTool, tool === x.key ? s.on : ''].join(' ')}
                      aria-pressed={tool === x.key}
                      aria-label={x.label}
                      title={x.hotkey ? `${x.label} (${x.hotkey})` : x.label}
                      onClick={() => {
                        setTool(x.key);
                        svgRef.current?.focus({ preventScroll: true });
                      }}
                      data-testid={`tool-${x.key}`}
                    >
                      {x.icon}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {bgEdit && bg && (
              <div className={s.bgBar} data-edit>
                <span>Fond : glisser pour le déplacer, molette pour l’agrandir</span>
                <button type="button" onClick={() => scaleBg(1 / 1.15)} aria-label="Réduire le fond">
                  −
                </button>
                <button type="button" onClick={() => scaleBg(1.15)} aria-label="Agrandir le fond">
                  +
                </button>
                <button type="button" className={s.bgDone} onClick={() => setBgEdit(false)}>
                  Terminer
                </button>
              </div>
            )}
          <svg
            ref={svgRef}
            className={[s.canvas, tool !== 'select' ? s.placing : ''].join(' ')}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onPointerDown={onCanvasDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={onKey}
            tabIndex={0}
            role="application"
            aria-label={`Plan au sol de la séquence ${sequenceHeading(doc, seqId)}`}
            data-testid="floorplan"
            style={{ '--fp-k': planOf(doc, planKey).stroke ?? 1 } as React.CSSProperties}
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
                className={[s[drag.kind], s.linePreview].join(' ')}
              />
            )}
          </svg>
          </div>
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
              {seq.shotIds.filter((id) => camerasForShot(doc, id).length > 0).length} / {seq.shotIds.length} avec caméra
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
  onDown: (e: PointerEvent, id: ID, mode?: 'move' | 'rotate' | 'path' | 'end1' | 'end2') => void;
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
          <g transform={`translate(${item.x} ${item.y}) rotate(${item.rot})`} onPointerDown={(e) => onDown(e, item.id)} data-testid="fp-camera-body">
            <circle r={18} className={s.hitArea} />
            <Symbol shapes={CAMERA} />
          </g>
          <BehindLabel x={item.x} y={item.y} rot={item.rot} dist={34}>
            {item.label}
            {cone.focal ? ` · ${cone.focal}mm · ${Math.round(cone.fov)}°` : ''}
          </BehindLabel>
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
          {item.kind === 'reflector' && <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.reflectorEdge} />}
          <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s[item.kind]} />
          <text x={(item.x + item.x2) / 2} y={(item.y + item.y2) / 2 - 10} className={s.label}>
            {item.label}
          </text>
          {selected && <Ends item={item} onDown={onDown} />}
        </g>
      );
    case 'wall':
    case 'rail':
      return (
        <g className={cls} onPointerDown={(e) => onDown(e, item.id)} data-testid={`fp-${item.kind}`}>
          <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.hit} />
          {item.kind === 'wall' ? (
            <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={item.white ? s.wallWhite : s.wall} />
          ) : (
            // Rails : traverses sous deux rails fins.
            <>
              <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.railTies} />
              <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.rail} />
              <line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={s.railGap} />
            </>
          )}
          {selected && <Ends item={item} onDown={onDown} />}
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
      if (item.practical)
        return (
          <g className={cls} onPointerDown={(e) => onDown(e, item.id)} data-testid="fp-practical">
            <circle cx={item.x} cy={item.y} r={9} className={s.light} />
            <path d={[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r = (a * Math.PI) / 180; return `M ${item.x + Math.cos(r) * 12} ${item.y + Math.sin(r) * 12} L ${item.x + Math.cos(r) * 17} ${item.y + Math.sin(r) * 17}`; }).join(' ')} className={s.practicalRays} />
            <text x={item.x} y={item.y + 30} className={s.label}>
              {item.label}
              {lightSpecs(item) && (
                <tspan x={item.x} dy="1.25em" className={s.specs}>
                  {lightSpecs(item)}
                </tspan>
              )}
            </text>
          </g>
        );
      return (
        <g className={cls} data-testid="fp-light">
          <g transform={`translate(${item.x} ${item.y}) rotate(${item.rot})`} onPointerDown={(e) => onDown(e, item.id)}>
            <circle r={18} className={s.hitArea} />
            <Symbol shapes={FRESNEL} />
          </g>
          <BehindLabel x={item.x} y={item.y} rot={item.rot} dist={30} sub={lightSpecs(item) || undefined}>
            {item.label}
          </BehindLabel>
          {selected && (
            <circle {...h} r={7} className={s.handle} onPointerDown={(e) => onDown(e, item.id, 'rotate')} />
          )}
        </g>
      );
    }
  }
}

/**
 * Image de fond prête pour l'assistant : redessinée sur fond blanc en PNG (format accepté partout),
 * 2000 pixels au plus sur le grand côté ; en JPEG si le PNG est trop lourd.
 */
async function imageForAi(url: string): Promise<{ input: ImageInput; w: number; h: number }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let data = c.toDataURL('image/png');
  let mediaType: ImageInput['mediaType'] = 'image/png';
  if (data.length > 4_500_000) {
    data = c.toDataURL('image/jpeg', 0.9);
    mediaType = 'image/jpeg';
  }
  return { input: { mediaType, base64: data.slice(data.indexOf(',') + 1) }, w, h };
}

/** Repère placé derrière un objet orienté (projecteur, caméra). */
function BehindLabel({ x, y, rot, dist, children, sub }: { x: number; y: number; rot: number; dist: number; children: React.ReactNode; sub?: string }) {
  const at = labelBehind(x, y, rot, dist);
  return (
    <text x={at.x} y={at.y} className={s.label} style={{ textAnchor: at.anchor }}>
      {children}
      {sub && (
        // Repère au-dessus de l'objet : la ligne de caractéristiques monte, pour ne pas le chevaucher.
        <tspan x={at.x} dy={at.y < y ? '-1.25em' : '1.25em'} className={s.specs}>
          {sub}
        </tspan>
      )}
    </text>
  );
}

/** Symbole partagé avec l'export, aux couleurs du thème. */
function Symbol({ shapes }: { shapes: readonly SymbolShape[] }) {
  return (
    <>
      {shapes.map((sh, i) => (
        <path key={i} d={sh.d} className={sh.role === 'body' ? s.symBody : sh.role === 'solid' ? s.symSolid : s.symStroke} />
      ))}
    </>
  );
}

const KIND_LABEL: Record<FloorKind, string> = {
  camera: 'Caméra',
  actor: 'Comédien',
  wall: 'Mur',
  rail: 'Rails',
  door: 'Porte',
  window: 'Fenêtre',
  light: 'Projecteur',
  reflector: 'Réflecteur',
  diffuser: 'Diffuseur',
  flag: 'Drapeau (négatif)',
};

/** Repère d'un élément : appliqué après une pause ou en quittant le champ (une étape d'annulation). */
function LabelField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft, flush] = useDraft(value, onCommit);
  return (
    <label className={s.field}>
      <span>Repère</span>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={flush} onKeyDown={(e) => e.key === 'Enter' && flush()} />
    </label>
  );
}

/** Largeur d'une porte ou d'une fenêtre : saisie libre, bornée à la validation. */
function WidthField({ value, onCommit }: { value: number; onCommit: (w: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const w = Math.max(20, Math.round(Number(text.replace(',', '.')) || 0));
    if (w !== value) onCommit(w);
    else setText(String(value));
  };
  return (
    <label className={s.field}>
      <span>Largeur (cm)</span>
      <input inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

/** Nom d'une vue modifié sur place (Entrée valide, Échap annule). */
function RenameField({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className={s.renameField}
      value={v}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(null);
      }}
      aria-label="Nom de la vue"
    />
  );
}

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
  // Curseurs : un geste entier = une seule étape d'annulation.
  const slide = (patch: Partial<FloorItem>) => gestureMutate((d) => updateFloorItem(d, planKey, item.id, patch));
  const seq = doc.sequences[seqId];
  return (
    <div className={s.props} data-testid="fp-properties">
      <h2 className={s.h2}>{item.kind === 'light' && item.practical ? 'Lampe de jeu' : KIND_LABEL[item.kind]}</h2>
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
        <LabelField key={item.id} value={item.label ?? ''} onCommit={(v) => update({ label: v } as Partial<FloorItem>)} />
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
                : '60° (aucun plan lié)';
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
                to: item.to ? undefined : { x: item.x + 120, y: item.y },
              } as Partial<FloorItem>)
            }
          >
            {item.to ? 'Retirer le déplacement' : 'Ajouter un déplacement'}
          </Button>
        </>
      )}
      {item.kind === 'light' && (
        <>
          {!item.practical && (
          <label className={s.field}>
            <span>Focalisation : faisceau de {item.spread ?? DEFAULT_SPREAD}° ({(item.spread ?? DEFAULT_SPREAD) <= 30 ? 'serré' : (item.spread ?? DEFAULT_SPREAD) >= 90 ? 'large' : 'moyen'})</span>
            <input
              type="range"
              min={10}
              max={160}
              step={5}
              value={item.spread ?? DEFAULT_SPREAD}
              onChange={(e) => slide({ spread: Number(e.target.value) } as Partial<FloorItem>)}
              {...gestureEnd}
              aria-label="Ouverture du faisceau"
            />
          </label>
          )}
          <label className={s.field}>
            <span>Portée</span>
            <input
              type="range"
              min={80}
              max={700}
              step={20}
              value={item.range ?? DEFAULT_RANGE}
              onChange={(e) => slide({ range: Number(e.target.value) } as Partial<FloorItem>)}
              {...gestureEnd}
              aria-label="Portée"
            />
          </label>
          <LightSpecsFields key={item.id} item={item} onCommit={(p) => update(p as Partial<FloorItem>)} />
          <label className={s.field}>
            <span>Intensité : {Math.round((item.power ?? 1) * 100)} %</span>
            <input type="range" min={0.2} max={1.6} step={0.1} value={item.power ?? 1} onChange={(e) => slide({ power: Number(e.target.value) } as Partial<FloorItem>)} {...gestureEnd} aria-label="Intensité" />
          </label>
        </>
      )}
      {(item.kind === 'door' || item.kind === 'window') && (
        <WidthField key={item.id} value={item.width} onCommit={(w) => update({ width: w } as Partial<FloorItem>)} />
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

/** Poignées aux deux extrémités d'un élément tracé : on les tire pour pivoter ou allonger. */
function Ends({ item, onDown }: { item: { id: ID; x: number; y: number; x2: number; y2: number }; onDown: (e: PointerEvent, id: ID, mode?: 'end1' | 'end2') => void }) {
  return (
    <>
      <circle cx={item.x} cy={item.y} r={6} className={s.handle} onPointerDown={(e) => onDown(e, item.id, 'end1')} data-testid="fp-end1" />
      <circle cx={item.x2} cy={item.y2} r={6} className={s.handle} onPointerDown={(e) => onDown(e, item.id, 'end2')} data-testid="fp-end2" />
    </>
  );
}

/** Nombre saisi au clavier (virgule acceptée) ; vide = non renseigné. */
const parseNum = (v: string) => {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Dimensions réelles de la pièce : les murs suivent, la superficie s'affiche. */
function RoomFields({ room, onCommit }: { room?: Room; onCommit: (r: Room | undefined) => void }) {
  const [w, setW] = useState(room?.w ? String(room.w) : '');
  const [l, setL] = useState(room?.l ? String(room.l) : '');
  const [h, setH] = useState(room?.h ? String(room.h) : '');
  const draft = parseNum(w) && parseNum(l) ? { w: parseNum(w)!, l: parseNum(l)!, ...(parseNum(h) ? { h: parseNum(h) } : {}) } : undefined;
  const size = draft ? roomSize(draft) : undefined;
  const apply = (r: Room | undefined) => {
    setW(r ? String(r.w) : '');
    setL(r ? String(r.l) : '');
    setH(r?.h ? String(r.h) : '');
    onCommit(r);
  };
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className={s.roomField}>
      <span>{label}</span>
      <input value={value} inputMode="decimal" onChange={(e) => set(e.target.value)} onBlur={() => draft && onCommit(draft)} onKeyDown={(e) => e.key === 'Enter' && draft && onCommit(draft)} aria-label={`${label} de la pièce (m)`} />
      <em>m</em>
    </label>
  );
  return (
    <div className={s.room} data-testid="fp-room">
      <div className={s.roomFields}>
        {field('Largeur', w, setW)}
        {field('Longueur', l, setL)}
        {field('Hauteur', h, setH)}
      </div>
      <div className={s.menuRow}>
        {ROOM_PRESETS.map((p) => (
          <Button key={p.label} size="sm" variant="ghost" onClick={() => apply(p.room)} title={`${p.room.w} × ${p.room.l} × ${p.room.h} m`}>
            {p.label}
          </Button>
        ))}
      </div>
      {size && (
        <p className={s.roomSize} data-testid="fp-room-size">
          Superficie {String(size.area).replace('.', ',')} m²{size.volume ? ` · volume ${String(size.volume).replace('.', ',')} m³` : ''}
          {room && (
            <button type="button" className={s.roomClear} onClick={() => apply(undefined)}>
              Retirer les murs
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Projecteur réel : modèle, puissance (W), température de couleur (K). */
function LightSpecsFields({ item, onCommit }: { item: { model?: string; watts?: number; kelvin?: number }; onCommit: (p: { model?: string; watts?: number; kelvin?: number }) => void }) {
  const [model, setModel] = useState(item.model ?? '');
  const [watts, setWatts] = useState(item.watts ? String(item.watts) : '');
  const [kelvin, setKelvin] = useState(item.kelvin ? String(item.kelvin) : '');
  const commit = (m = model, w = watts, k = kelvin) => onCommit({ model: m.trim() || undefined, watts: parseNum(w), kelvin: parseNum(k) });
  return (
    <>
      <label className={s.field}>
        <span>Modèle</span>
        <input
          list="fp-light-models"
          value={model}
          placeholder="Fresnel 2 kW, HMI M18…"
          onChange={(e) => {
            const v = e.target.value;
            setModel(v);
            const preset = LIGHT_PRESETS.find((p) => p.model === v);
            if (preset) {
              setWatts(String(preset.watts));
              setKelvin(String(preset.kelvin));
              commit(v, String(preset.watts), String(preset.kelvin));
            }
          }}
          onBlur={() => commit()}
          aria-label="Modèle du projecteur"
        />
        <datalist id="fp-light-models">
          {LIGHT_PRESETS.map((p) => (
            <option key={p.model} value={p.model} />
          ))}
        </datalist>
      </label>
      <div className={s.roomFields}>
        <label className={s.roomField}>
          <span>Puissance</span>
          <input value={watts} inputMode="numeric" onChange={(e) => setWatts(e.target.value)} onBlur={() => commit()} aria-label="Puissance (W)" data-testid="fp-watts" />
          <em>W</em>
        </label>
        <label className={s.roomField}>
          <span>Température</span>
          <input value={kelvin} inputMode="numeric" onChange={(e) => setKelvin(e.target.value)} onBlur={() => commit()} aria-label="Température de couleur (K)" data-testid="fp-kelvin" />
          <em>K</em>
        </label>
      </div>
      <div className={s.menuRow}>
        {[3200, 4300, 5600].map((k) => (
          <Button key={k} size="sm" variant={Number(kelvin) === k ? 'primary' : 'ghost'} onClick={() => (setKelvin(String(k)), commit(model, watts, String(k)))}>
            {k.toLocaleString('fr-FR')} K
          </Button>
        ))}
      </div>
    </>
  );
}

