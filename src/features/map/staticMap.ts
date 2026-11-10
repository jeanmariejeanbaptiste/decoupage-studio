import { dayLabels, dayPlaces, mapPlaces, placeCoords, placeTitle, staticMapFrame, TILE_SIZE, type FrameTile } from '../../domain/geo';
import type { CallSheetMap } from '../../domain/documents';
import type { ProjectDoc } from '../../domain/types';
import { known } from '../../store/geocoder';

/**
 * Carte statique des lieux d'un jour, pour l'export de la feuille de service : tuiles OpenStreetMap
 * (servies en CORS) posées sur un canevas, passées en niveaux de gris, repères numérotés comme à
 * l'écran et attribution. Rien si aucun lieu du jour n'est géocodé, hors ligne ou si aucune tuile ne vient.
 */

const WIDTH = 560;
const HEIGHT = 260;
const SCALE = 2;
const TIMEOUT = 8000;
const INK = '#111318';
const FONT = "'Inter Variable', 'Inter', 'Helvetica Neue', Arial, sans-serif";

async function tile(t: FrameTile): Promise<ImageBitmap | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`, { signal: ctrl.signal });
    return res.ok ? await createImageBitmap(await res.blob()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Niveaux de gris, un peu adoucis comme la carte à l'écran (indépendant de `ctx.filter`, absent de Safari). */
function grayscale(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const v = Math.max(0, Math.min(255, (y - 128) * 0.92 + 128 + 10));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function dayMapImage(doc: ProjectDoc, day: number): Promise<CallSheetMap | undefined> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
  const today = dayPlaces(mapPlaces(doc), doc, day);
  const labels = dayLabels(today);
  const placed = today.flatMap((p) => {
    const at = placeCoords(known(doc, p.key));
    return at ? [{ place: p, label: labels.get(p)!, ...at }] : [];
  });
  const frame = staticMapFrame(placed, WIDTH, HEIGHT);
  if (!frame) return undefined;
  const bitmaps = await Promise.all(frame.tiles.map(tile));
  if (!bitmaps.some(Boolean)) return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#eeeeef';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  frame.tiles.forEach((t, i) => {
    const b = bitmaps[i];
    if (b) ctx.drawImage(b, t.left * SCALE, t.top * SCALE, TILE_SIZE * SCALE, TILE_SIZE * SCALE);
  });
  try {
    grayscale(ctx, canvas.width, canvas.height);
  } catch {
    // Canevas illisible (tuile sans CORS) : pas de carte plutôt qu'une carte en couleurs.
    return undefined;
  }

  // Repères : pastille noire numérotée, carrée pour l'hôpital ; le premier de la journée dessus.
  ctx.scale(SCALE, SCALE);
  await document.fonts?.load(`600 11px ${FONT}`).catch(() => undefined);
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of [...placed].reverse()) {
    const { x, y } = frame.at(p.lat, p.lon);
    const w = Math.max(22, 10 + p.label.length * 7);
    const h = 22;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, p.place.kind === 'hopital' ? 4 : 11);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(p.label, x, y + 0.5);
  }

  // Attribution, discrète, en bas à droite.
  const credit = '© OpenStreetMap';
  ctx.font = `400 9px ${FONT}`;
  const tw = ctx.measureText(credit).width + 10;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillRect(WIDTH - tw, HEIGHT - 14, tw, 14);
  ctx.fillStyle = '#4b4f57';
  ctx.textAlign = 'right';
  ctx.fillText(credit, WIDTH - 5, HEIGHT - 6.5);

  return {
    src: canvas.toDataURL('image/png'),
    width: WIDTH,
    height: HEIGHT,
    legend: placed.map((p) => ({ label: p.label, title: placeTitle(p.place), hospital: p.place.kind === 'hopital' || undefined })),
  };
}
