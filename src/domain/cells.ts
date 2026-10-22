import { BEAT_COLUMNS } from './oneshot';
/**
 * Lecture / écriture d'une cellule de la grille sous forme de texte (saisie, collage, recopie).
 */
import { formatAperture, parseAperture, parseFocalInput } from './focal';
import { setShotSubject } from './ops';
import { formatRange, formatTc, parseRange, parseTc } from './timecode';
import { parseTokens } from './tokens';
import { fold } from './text';
import type { ColumnKey, ID, ProjectDoc, ShotStatus } from './types';

export const READONLY_COLUMNS: readonly ColumnKey[] = ['number', 'characters', 'grip', 'shotDuration'];

export function isEditable(col: ColumnKey): boolean {
  return !READONLY_COLUMNS.includes(col);
}

/** Texte brut proposé à l'édition (sans la mise en forme d'export). */
export function editableText(doc: ProjectDoc, shotId: ID, col: ColumnKey): string {
  const shot = doc.shots[shotId];
  if (!shot) return '';
  const block = doc.blocks[shot.actionBlockId];
  const seq = doc.sequences[shot.sequenceId];
  const s = doc.project.settings;
  switch (col) {
    case 'sequence':
      return seq?.label ?? '';
    case 'subject':
      return shot.subject;
    case 'value':
      return shot.value;
    case 'angle':
      return shot.angle.join(', ');
    case 'movement':
      return shot.movement.join(shot.movementSep ?? ', ');
    case 'focal': {
      const { from, to } = shot.focal;
      if (from !== undefined && to !== undefined) return `${from} → ${to}`;
      return from !== undefined ? String(from) : '';
    }
    case 'action':
      return block?.text ?? '';
    case 'dialogue':
      return block?.dialogue ?? '';
    case 'tc':
      if (s.tcMode === 'piste') return formatRange(block?.tc);
      if (s.tcGranularity === 'sequence') return seq?.overrideSec !== undefined ? formatTc(seq.overrideSec) : '';
      return block?.overrideSec !== undefined ? formatTc(block.overrideSec) : '';
    case 'aperture':
      return formatAperture(shot.aperture);
    case 'sound':
      return shot.sound ?? '';
    case 'light':
      return shot.light ?? '';
    case 'notes':
      return shot.notes ?? '';
    case 'status':
      return shot.status;
    case 'shootingDay':
      return shot.shootingDay !== undefined ? String(shot.shootingDay) : '';
    default:
      return '';
  }
}

function parseStatus(text: string): ShotStatus | undefined {
  const t = fold(text);
  if (!t || t.startsWith('a t') || t === 'a') return 'à tourner';
  if (t.startsWith('ab')) return 'abandonné';
  if (t.startsWith('tourn') || t === 'ok') return 'tourné';
  return undefined;
}

/**
 * Écrit une cellule à partir d'un texte. Renvoie `false` si la saisie est invalide (rien n'est modifié).
 */
export function setCellText(doc: ProjectDoc, shotId: ID, col: ColumnKey, text: string): boolean {
  const shot = doc.shots[shotId];
  if (!shot || !isEditable(col)) return false;
  // Plan-séquence : les colonnes de cadrage se modifient temps par temps, dans l'inspecteur.
  if (shot.oneShot && BEAT_COLUMNS.includes(col)) return false;
  const block = doc.blocks[shot.actionBlockId];
  const seq = doc.sequences[shot.sequenceId];
  const s = doc.project.settings;
  const t = text.replace(/\r/g, '');
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  switch (col) {
    case 'sequence':
      if (seq) seq.label = t.trim();
      return true;
    case 'subject':
      setShotSubject(doc, shotId, t.trim());
      return true;
    case 'value':
      shot.value = t.trim();
      return true;
    case 'angle':
      shot.angle = t.trim() === '-' ? ['-'] : parseTokens(t).tokens;
      return true;
    case 'movement': {
      const { tokens, sep } = parseTokens(t);
      shot.movement = tokens;
      shot.movementSep = sep;
      return true;
    }
    case 'focal': {
      const parts = t.split(/→|->|>|-|–|à/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) {
        shot.focal = { to: shot.focal.to };
        if (shot.focal.to === undefined) shot.focal = {};
        return true;
      }
      const from = parseFocalInput(parts[0]);
      const to = parts[1] !== undefined ? parseFocalInput(parts[1]) : shot.focal.to;
      if (from === undefined) return false;
      shot.focal = to !== undefined ? { from, to } : { from };
      return true;
    }
    case 'action':
      if (block) block.text = t.trim();
      return true;
    case 'dialogue':
      if (block) block.dialogue = opt(t);
      return true;
    case 'tc': {
      if (!block || !seq) return false;
      if (s.tcMode === 'piste') {
        const r = parseRange(t);
        if (r === null) return false;
        block.tc = Object.keys(r).length ? r : undefined;
        return true;
      }
      if (!t.trim()) {
        if (s.tcGranularity === 'sequence') seq.overrideSec = undefined;
        else block.overrideSec = undefined;
        return true;
      }
      const p = parseTc(t);
      if (!p || p.kind !== 'sec') return false;
      if (s.tcGranularity === 'sequence') seq.overrideSec = p.sec;
      else block.overrideSec = p.sec;
      return true;
    }
    case 'aperture': {
      if (!t.trim()) {
        shot.aperture = undefined;
        return true;
      }
      const n = parseAperture(t);
      if (n === undefined) return false;
      shot.aperture = n;
      return true;
    }
    case 'sound':
      shot.sound = opt(t);
      return true;
    case 'light':
      shot.light = opt(t);
      return true;
    case 'notes':
      shot.notes = opt(t);
      return true;
    case 'status': {
      const st = parseStatus(t);
      if (!st) return false;
      shot.status = st;
      return true;
    }
    case 'shootingDay': {
      if (!t.trim()) {
        shot.shootingDay = undefined;
        return true;
      }
      const m = /(\d+)/.exec(t);
      if (!m) return false;
      shot.shootingDay = Number(m[1]);
      return true;
    }
    default:
      return false;
  }
}

/** Analyse un collage TSV (Excel, Sheets) en matrice de cellules. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function toTsv(matrix: readonly (readonly string[])[]): string {
  const esc = (c: string) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return matrix.map((r) => r.map(esc).join('\t')).join('\n');
}
