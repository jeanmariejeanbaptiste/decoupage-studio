import { setCellText } from './cells';
import { activeColumns, COLUMN_DEFS } from './columns';
import { addSequence, addShot, linkAction } from './ops';
import { exportCellText } from './rows';
import { fold } from './text';
import { shotCode } from './numbering';
import { parseRange, parseTc } from './timecode';
import { computeTiming } from './timing';
import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS, type ColumnKey, type ProjectDoc } from './types';

/** Colonnes proposées à l'import : les colonnes abandonnées (personnages, lumière…) n'importeraient rien. */
export const CSV_COLUMNS: readonly ColumnKey[] = activeColumns([...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS]);

/**
 * Texte d'un fichier importé : UTF-8 (avec ou sans BOM), sinon Windows-1252, l'encodage des CSV
 * qu'Excel enregistre sous Windows (« Séquence » y deviendrait « S�quence »).
 */
export function decodeText(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // « Texte Unicode » d'Excel : UTF-16 avec sa marque d'ordre des octets.
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/**
 * Mode de minutage d'une colonne TC importée : « piste » si la plupart des valeurs non vides sont
 * des plages (« 0:00 - 0:35 »), comme dans l'export d'un découpage calé sur une piste.
 */
export function tcModeOfColumn(values: readonly string[]): 'piste' | undefined {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return undefined;
  const ranges = filled.filter((v) => parseTc(v)?.kind !== 'sec' && parseRange(v) !== null && /\d/.test(v)).length;
  return ranges * 2 > filled.length ? 'piste' : undefined;
}

/** Cellule protégée : une valeur qui commence par = + - @ ne devient pas une formule dans un tableur. */
export const safeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v);

function esc(raw: string, sep: string): string {
  const v = safeCell(raw);
  return v.includes(sep) || /["\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV : une ligne par plan, sans fusion (§8.3). Séparateur « ; » (Excel français). */
export function toCsv(doc: ProjectDoc, columns: readonly ColumnKey[] = doc.project.settings.exportColumns, sep = ';'): string {
  const timing = computeTiming(doc);
  const header = ['Code', ...columns.map((c) => COLUMN_DEFS[c].label)];
  const lines = [header.map((h) => esc(h, sep)).join(sep)];
  doc.project.sequenceIds.forEach((seqId) => {
    const seq = doc.sequences[seqId];
    seq?.shotIds.forEach((shotId, i) => {
      const shot = doc.shots[shotId];
      if (!shot) return;
      const cells = [shotCode(doc, shotId), ...columns.map((c) => exportCellText(doc, timing, shot, c, i))];
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
  // « Image » : en-tête de la colonne des notes dans l'export (« Image storyboard » reste à part).
  notes: ['notes', 'remarques', 'commentaires', 'raccord', 'image'],
  status: ['statut', 'etat'],
  shootingDay: ['jour', 'jour de tournage'],
};

/** Correspondance automatique des en-têtes vers les colonnes (assistant d'import). */
export function guessMapping(headers: readonly string[]): Array<ColumnKey | null> {
  const used = new Set<ColumnKey>();
  return headers.map((h) => {
    const f = fold(h).replace(/[^\p{L}\p{N}° ]/gu, '').trim();
    // Seules les colonnes proposées à l'import : une colonne abandonnée (lumière…) n'écrirait qu'un champ invisible.
    const found = (Object.keys(HEADER_ALIASES) as ColumnKey[]).find(
      (k) => CSV_COLUMNS.includes(k) && !used.has(k) && (HEADER_ALIASES[k] ?? []).some((a) => fold(a) === f),
    );
    if (found) used.add(found);
    return found ?? null;
  });
}

/**
 * Importe des lignes dans le projet : une nouvelle séquence à chaque changement de libellé,
 * et les actions identiques consécutives sont liées. Renvoie le nombre de plans créés.
 * Une ligne liée à la précédente ne réécrit pas le bloc commun (action, réplique, plage de TC) :
 * la réplique répétée sur chaque ligne d'un export ne se retrouve pas bout à bout.
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
    const action = actionCol >= 0 ? (row[actionCol] ?? '').trim() : '';
    const linked = !!prevShot && !!action && action === prevAction && !!linkAction(doc, [prevShot, shotId]);
    const blockCol = (col: ColumnKey) => col === 'action' || col === 'dialogue' || (col === 'tc' && doc.project.settings.tcMode !== 'duree');
    mapping.forEach((col, j) => {
      if (col && col !== 'sequence' && col !== 'number' && !(linked && blockCol(col))) setCellText(doc, shotId, col, row[j] ?? '');
    });
    prevShot = shotId;
    prevAction = action;
  }
  return created;
}
