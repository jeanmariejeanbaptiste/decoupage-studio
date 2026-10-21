import { isZoom, matchVocab, MOVEMENTS, ANGLES } from './vocabulary';
import { fold } from './text';
import type { EquipmentCategory, ID, ProjectDoc, Shot } from './types';

export interface EquipmentItem {
  key: string;
  category: EquipmentCategory;
  label: string;
}

export interface EquipmentLine extends EquipmentItem {
  shotIds: ID[];
  manual: boolean;
}

export const EQUIPMENT_CATEGORIES: readonly EquipmentCategory[] = ['Image', 'Machinerie', 'Lumière', 'Son'];

/** Postes du projet : les quatre de base, puis ceux ajoutés. */
export function equipmentCategories(doc: ProjectDoc): EquipmentCategory[] {
  return [...EQUIPMENT_CATEGORIES, ...(doc.equipmentExtra ?? []).filter((c) => !EQUIPMENT_CATEGORIES.includes(c))];
}

const MOVEMENT_RULES: ReadonlyArray<{ keys: string[]; item: EquipmentItem }> = [
  {
    keys: ['trav_avant', 'trav_arriere', 'trav_lateral', 'trav_lateral_gauche', 'trav_lateral_droit'],
    item: { key: 'rails-dolly', category: 'Machinerie', label: 'Rails + dolly ou slider' },
  },
  { keys: ['trav_circulaire', 'trav_courbe'], item: { key: 'rails-courbes', category: 'Machinerie', label: 'Rails courbes ou gimbal' } },
  { keys: ['trav_vertical', 'boom_up', 'boom_down', 'grue'], item: { key: 'grue', category: 'Machinerie', label: 'Grue, jib' } },
  { keys: ['steadicam', 'gimbal'], item: { key: 'stabilisateur', category: 'Image', label: 'Stabilisateur (steadicam / gimbal)' } },
  { keys: ['epaule'], item: { key: 'rig-epaule', category: 'Image', label: 'Rig épaule' } },
  { keys: ['drone'], item: { key: 'drone', category: 'Image', label: 'Drone + télépilote' } },
];

function movementKeys(shot: Shot): string[] {
  return shot.movement.map((m) => matchVocab(m, MOVEMENTS)?.key ?? fallbackMovementKey(m)).filter((k): k is string => !!k);
}

/** Reconnaissance large des jetons non canoniques (« Traveling latéral droit lent »). */
function fallbackMovementKey(token: string): string | undefined {
  const t = fold(token);
  if (/drone/.test(t)) return 'drone';
  if (/steadi|gimbal|ronin/.test(t)) return 'steadicam';
  if (/epaule/.test(t)) return 'epaule';
  if (/grue|jib|boom|vertical/.test(t)) return 'grue';
  if (/circul|courbe/.test(t)) return 'trav_circulaire';
  if (/trav/.test(t)) return 'trav_avant';
  return undefined;
}

/** Matériel déduit d'un plan (§10). */
export function deduceEquipment(shot: Shot): EquipmentItem[] {
  const items: EquipmentItem[] = [];
  const keys = movementKeys(shot);
  for (const rule of MOVEMENT_RULES) if (rule.keys.some((k) => keys.includes(k))) items.push(rule.item);
  const angleKeys = shot.angle.map((a) => matchVocab(a, ANGLES)?.key);
  if (angleKeys.includes('top_shot')) items.push({ key: 'potence', category: 'Machinerie', label: 'Potence ou grue (top shot)' });
  if (angleKeys.includes('low_angle')) items.push({ key: 'high-hat', category: 'Machinerie', label: 'Base basse (high-hat)' });
  const zoom = isZoom(shot.movement);
  if (zoom) {
    const { from, to } = shot.focal;
    const lo = Math.min(from ?? to ?? 0, to ?? from ?? 0);
    const hi = Math.max(from ?? 0, to ?? 0);
    items.push(
      lo && hi
        ? { key: `zoom-${lo}-${hi}`, category: 'Image', label: `Optique zoom couvrant ${lo}–${hi} mm` }
        : { key: 'zoom', category: 'Image', label: 'Optique zoom (plage à préciser)' },
    );
  } else if (shot.focal.from !== undefined) {
    items.push({ key: `prime-${shot.focal.from}`, category: 'Image', label: `Optique fixe ${shot.focal.from} mm` });
  }
  const sound = fold(shot.sound ?? '');
  if (sound.includes('playback')) items.push({ key: 'playback', category: 'Son', label: 'Système de playback' });
  if (/\bin\b/.test(sound)) items.push({ key: 'perche', category: 'Son', label: 'Perche + HF' });
  if (shot.light?.trim()) items.push({ key: `light-${fold(shot.light)}`, category: 'Lumière', label: `Lumière : ${shot.light.trim()}` });
  return items;
}

/** Agrégation par chef de poste de tout le matériel déduit + ajouts manuels. */
export function aggregateEquipment(doc: ProjectDoc): Record<EquipmentCategory, EquipmentLine[]> {
  const byKey = new Map<string, EquipmentLine>();
  for (const seqId of doc.project.sequenceIds) {
    const seq = doc.sequences[seqId];
    if (!seq) continue;
    const effect = seq.effect;
    for (const shotId of seq.shotIds) {
      const shot = doc.shots[shotId];
      if (!shot || shot.status === 'abandonné') continue;
      const items = deduceEquipment(shot);
      if (effect === 'NUIT') items.push({ key: 'nuit', category: 'Lumière', label: 'Projecteurs effet nuit' });
      for (const item of items) {
        const line = byKey.get(item.key) ?? { ...item, shotIds: [], manual: false };
        if (!line.shotIds.includes(shotId)) line.shotIds.push(shotId);
        byKey.set(item.key, line);
      }
    }
  }
  for (const m of doc.manualEquipment) {
    byKey.set(`manual-${m.id}`, { key: `manual-${m.id}`, category: m.category, label: m.label, shotIds: [...m.shotIds], manual: true });
  }
  const out: Record<EquipmentCategory, EquipmentLine[]> = Object.fromEntries(equipmentCategories(doc).map((c) => [c, [] as EquipmentLine[]])) as unknown as Record<EquipmentCategory, EquipmentLine[]>;
  for (const line of byKey.values()) (out[line.category] ??= []).push(line);
  for (const c of Object.keys(out)) out[c].sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));
  return out;
}
