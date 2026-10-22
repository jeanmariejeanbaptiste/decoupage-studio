import { setCellText } from './cells';
import { COLUMN_DEFS } from './columns';
import { addSequence, addShot, linkAction } from './ops';
import { cellText } from './rows';
import { fold } from './text';
import { computeTiming } from './timing';
import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS, type ColumnKey, type ProjectDoc } from './types';

export const CSV_COLUMNS: readonly ColumnKey[] = [...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS];

function esc(v: string, sep: string): string {
  return v.includes(sep) || /["\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV : une ligne par plan, sans fusion (§8.3). Séparateur « ; » (Excel français). */
export function toCsv(doc: ProjectDoc, columns: readonly ColumnKey[] = doc.project.settings.exportColumns, sep = ';'): string {
  const timing = computeTiming(doc);
  const header = ['Code', ...columns.map((c) => COLUMN_DEFS[c].label)];
  const lines = [header.map((h) => esc(h, sep)).join(sep)];
  doc.project.sequenceIds.forEach((seqId, si) => {
    const seq = doc.sequences[seqId];
    seq?.shotIds.forEach((shotId, i) => {
      const shot = doc.shots[shotId];
      if (!shot) return;
      const cells = [`${si + 1}.${i + 1}`, ...columns.map((c) => cellText(doc, timing, shot, c, i))];
      lines.push(cells.map((v) => esc(v, sep)).join(sep));
    });
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Détecte le séparateur (tabulation, point-virgule ou virgule) d'après la première ligne. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const [best] = ['\t', ';', ','].map((d) => [d, first.split(d).length - 1] as const).sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ';';
}

/** Analyse un CSV/TSV (guillemets, retours à la ligne dans les cellules). */
export function parseDelimited(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^\uFEFF/, '');
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
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Partial<Record<ColumnKey, string[]>> = {
  sequence: ['sequence', 'seq', 'sequences', 'decor', 'lieu', 'scene'],
  number: ['n°', 'no', 'num', 'numero', 'plan', 'n'],
  subject: ['sujet', 'subject', 'personnage', 'cadre sur'],
  value: ['valeur', 'valeur de cadre', 'valeur de plan', 'echelle', 'taille de plan'],
  angle: ['angle', 'axe', 'angle de vue'],
  movement: ['mouvement', 'mouvement de camera', 'mvt', 'mouvements'],
  focal: ['focale', 'objectif', 'optique', 'mm'],
  action: ['action', 'description', 'actions'],
  tc: ['tc', 'tc min', 'duree', 'timecode', 'temps'],
  dialogue: ['dialogue', 'dialogues', 'repliques', 'texte'],
  aperture: ['ouverture', 'diaphragme', 'diaph', 'iris', 'f stop'],
  sound: ['son', 'sound'],
  light: ['lumiere', 'eclairage'],
  notes: ['notes', 'remarques', 'commentaires', 'raccord'],
  status: ['statut', 'etat'],
  shootingDay: ['jour', 'jour de tournage'],
};

/** Correspondance automatique des en-têtes vers les colonnes (assistant d'import). */
export function guessMapping(headers: readonly string[]): Array<ColumnKey | null> {
  const used = new Set<ColumnKey>();
  return headers.map((h) => {
    const f = fold(h).replace(/[^\p{L}\p{N}° ]/gu, '').trim();
    const found = (Object.keys(HEADER_ALIASES) as ColumnKey[]).find(
      (k) => !used.has(k) && (HEADER_ALIASES[k] ?? []).some((a) => fold(a) === f),
    );
    if (found) used.add(found);
    return found ?? null;
  });
}

/**
 * Importe des lignes dans le projet : une nouvelle séquence à chaque changement de libellé,
 * et les actions identiques consécutives sont liées. Renvoie le nombre de plans créés.
 */
export function importRows(doc: ProjectDoc, rows: readonly (readonly string[])[], mapping: readonly (ColumnKey | null)[]): number {
  const seqCol = mapping.indexOf('sequence');
  const actionCol = mapping.indexOf('action');
  let seqId: string | undefined;
  let lastLabel: string | undefined;
  let prevShot: string | undefined;
  let prevAction: string | undefined;
  let created = 0;
  for (const row of rows) {
    const rawLabel = seqCol >= 0 ? (row[seqCol] ?? '').trim() : '';
    const label = rawLabel.replace(/^\d+\s*[,.-]\s*/, '');
    if (!seqId || (seqCol >= 0 && rawLabel !== '' && label !== lastLabel)) {
      seqId = addSequence(doc, undefined, { label }, false);
      lastLabel = label;
      prevShot = undefined;
      prevAction = undefined;
    }
    const shotId = addShot(doc, seqId);
    created++;
    mapping.forEach((col, j) => {
      if (col && col !== 'sequence' && col !== 'number') setCellText(doc, shotId, col, row[j] ?? '');
    });
    const action = actionCol >= 0 ? (row[actionCol] ?? '').trim() : '';
    if (prevShot && action && action === prevAction) linkAction(doc, [prevShot, shotId]);
    prevShot = shotId;
    prevAction = action;
  }
  return created;
}
