import { tcLast } from '../../domain/columns';
import type { Borders, PaperSize, Workbook, Worksheet } from 'exceljs';
import { sequenceCharacterIds } from '../../domain/characters';
import { COLUMN_DEFS, columnWidths } from '../../domain/columns';
import { sequenceMerges } from '../../domain/rows';
import { bandColumns } from '../../domain/merge';
import { interviewBandText } from '../../domain/interview';
import { BEAT_COLUMNS } from '../../domain/oneshot';
import { formatTc } from '../../domain/timecode';
import { computeTiming, formatGap } from '../../domain/timing';
import type { ColumnKey, ExportTheme, ProjectDoc } from '../../domain/types';

const PALETTES: Record<ExportTheme, { bg: string; head: string; title: string; ink: string; red: string; brown: string }> = {
  // Un seul style : blanc, noir, bleu (le thème enregistré dans d'anciens projets est ignoré).
  mauve: { bg: 'FFFFFF', head: 'F1F3F6', title: '111111', ink: '111111', red: '111111', brown: '111111' },
  papier: { bg: 'FFFFFF', head: 'F1F3F6', title: '111111', ink: '111111', red: '111111', brown: '111111' },
  sobre: { bg: 'FFFFFF', head: 'F1F3F6', title: '111111', ink: '111111', red: '111111', brown: '111111' },
};

const FONT = 'Inter';
const TOTAL_WIDTH = 190; // largeur totale en caractères Excel (A4 paysage)

const border: Partial<Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

function colorFor(col: ColumnKey, p: (typeof PALETTES)['mauve']): string {
  if (col === 'number') return p.red;
  if (col === 'value' || col === 'angle' || col === 'movement' || col === 'action') return p.brown;
  return p.ink;
}

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${argb}` } });

/** Construit le classeur : onglet « Découpage » fusionné + onglet « Registre » (§8.3). */
export async function buildWorkbook(doc: ProjectDoc, columns: ColumnKey[] = doc.project.settings.exportColumns, theme: ExportTheme = doc.project.settings.exportTheme): Promise<Workbook> {
  columns = tcLast(columns);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.title = `${doc.project.title} — découpage technique`;
  const base = PALETTES[theme];
  // Le classeur garde toujours ses fonds d'en-tête (l'économie d'encre du storyboard ne le concerne pas).
  const p = base;
  const timing = computeTiming(doc);
  const ws = wb.addWorksheet('Découpage', {
    pageSetup: {
      orientation: 'landscape',
      paperSize: (doc.project.settings.exportPaper === 'A3' ? 8 : 9) as PaperSize,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.47, right: 0.47, top: 0.47, bottom: 0.47, header: 0.2, footer: 0.2 },
    },
    views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
    properties: { tabColor: { argb: `FF${p.head}` } },
  });
  // Pied de page selon le réglage d'export ; « & » est un code de mise en forme pour Excel : doublé.
  const amp = (t: string) => t.replace(/&/g, '&&');
  if (doc.project.settings.exportFooter !== false) ws.headerFooter.oddFooter = `&L${amp(doc.project.title)} · ${amp(doc.project.version)}&Rpage &P / &N`;
  // En-tête de colonnes répété sur chaque page imprimée.
  ws.pageSetup.printTitlesRow = '2:2';
  const widths = columnWidths(columns);
  ws.columns = columns.map((c) => ({ key: c, width: Math.max(4, (widths[c] / 100) * TOTAL_WIDTH) }));

  const title = ws.addRow(['Découpage technique']);
  ws.mergeCells(1, 1, 1, columns.length);
  title.height = 42;
  title.getCell(1).font = { name: 'Inter', size: 26, bold: true, color: { argb: `FF${p.title}` } };
  title.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  for (let c = 1; c <= columns.length; c++) title.getCell(c).fill = fill(p.bg);

  const head = ws.addRow(columns.map((c) => COLUMN_DEFS[c].label));
  head.height = 22;
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = fill(p.head);
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.font = { name: FONT, size: 10, bold: true, italic: c === 'tc', color: { argb: `FF${c === 'number' ? p.red : p.ink}` } };
  });

  // Hauteur estimée d'un texte dans une colonne (Excel n'ajuste jamais les lignes fusionnées).
  const charsPerLine = (c: ColumnKey) => Math.max(4, ((widths[c] / 100) * TOTAL_WIDTH) * 1.1);
  const needed = (c: ColumnKey, text: string) => {
    const lines = String(text)
      .split('\n')
      .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / charsPerLine(c))), 0);
    return lines * 12.5 + 8;
  };
  for (const seqId of doc.project.sequenceIds) {
    const noMerge = !!doc.project.settings.exportNoMerge;
    const { rows, merges } = sequenceMerges(doc, timing, seqId, columns, noMerge, true);
    if (!rows.length) {
      // Séquence sans plan : elle figure quand même, avec son libellé.
      const row = ws.addRow(columns.map((c) => (c === 'sequence' ? `${doc.project.sequenceIds.indexOf(seqId) + 1}, ${(doc.sequences[seqId]?.label ?? '').toUpperCase()}` : '')));
      row.height = 24;
      columns.forEach((_, i) => {
        row.getCell(i + 1).border = border;
        row.getCell(i + 1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        row.getCell(i + 1).font = { name: FONT, size: 9, bold: true };
      });
    }
    const firstBeat = BEAT_COLUMNS.find((c) => columns.includes(c));
    // Ligne Excel de départ de chaque plan : un plan-séquence occupe une ligne par temps et par liaison.
    const starts: number[] = [];
    const cover = bandColumns(columns, doc.project.settings);
    rows.forEach((r) => {
      // Cadre d'interview : une seule ligne (la bande), qui porte toutes ses caméras.
      if (r.follower) {
        starts.push(starts[starts.length - 1]);
        return;
      }
      starts.push(ws.rowCount + 1);
      if (r.band) {
        const band = r.band;
        const head = interviewBandText({ ...band, cameras: [] });
        const row = ws.addRow(columns.map((c) => (c === 'number' ? band.cameras.map((x) => x.number).join('\n') : c === cover[0] ? [head, ...band.cameras.map((x) => x.text)].join('\n') : cover.includes(c) ? '' : (r.cells[c] ?? ''))));
        row.height = Math.round((band.cameras.length + 1) * 12.5 + 8);
        columns.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const inBand = cover.includes(c) || c === 'number';
          cell.fill = fill(inBand ? p.head : p.bg);
          cell.border = border;
          cell.alignment = { vertical: c === 'number' ? 'bottom' : inBand ? 'top' : 'middle', horizontal: c === cover[0] ? 'left' : 'center', wrapText: true, indent: c === cover[0] ? 1 : 0 };
          cell.font = { name: FONT, size: 9, bold: c === 'number' || c === 'sequence', color: { argb: `FF${colorFor(c, p)}` } };
        });
        if (cover.length > 1) ws.mergeCells(row.number, columns.indexOf(cover[0]) + 1, row.number, columns.indexOf(cover[cover.length - 1]) + 1);
        return;
      }
      const lines = r.lines ?? [undefined];
      lines.forEach((l, k) => {
        const row = ws.addRow(columns.map(() => ''));
        row.height = l ? (l.bridge ? 16 : 20) : 30;
        columns.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const beat = l && BEAT_COLUMNS.includes(c);
          cell.value = beat ? (l.bridge ? (l.cells[c] ? `↳ ${l.cells[c]}` : '') : `${c === firstBeat ? `${l.tag} ` : ''}${l.cells[c] ?? ''}`) : k === 0 ? (r.cells[c] ?? '') : '';
          cell.fill = fill(p.bg);
          cell.border = beat && lines.length > 1 ? { ...border, top: k > 0 ? { style: 'dotted' } : border.top, bottom: k < lines.length - 1 ? { style: 'dotted' } : border.bottom } : border;
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.font = { name: FONT, size: l?.bridge ? 8 : 9, bold: !l?.bridge, italic: c === 'tc' || !!l?.bridge, color: { argb: `FF${l?.bridge ? p.red : colorFor(c, p)}` } };
        });
      });
    });
    const endOf = (i: number) => starts[i] + Math.max(1, rows[i].lines?.length ?? 1) - 1;
    // Hauteur de chaque ligne : assez pour le texte le plus long, réparti sur les lignes qu'il couvre.
    rows.forEach((r, i) => {
      if ((r.lines && r.lines.length > 1) || r.band || r.follower) return;
      let need = 30;
      for (const c of columns) {
        const span = noMerge ? undefined : merges.get(c)?.find((m) => m.startRow <= i && i < m.startRow + m.span);
        const text = span ? span.value : (r.cells[c] ?? '');
        const n = span ? span.span : 1;
        need = Math.max(need, needed(c, text) / n);
      }
      ws.getRow(starts[i]).height = Math.min(400, Math.round(need));
    });
    columns.forEach((c, i) => {
      for (const span of merges.get(c) ?? []) {
        const top = starts[span.startRow];
        const bottom = endOf(span.startRow + span.span - 1);
        if (rows[span.startRow].lines && BEAT_COLUMNS.includes(c)) continue;
        if (rows[span.startRow].group && cover.includes(c)) continue;
        if (bottom > top && !noMerge) ws.mergeCells(top, i + 1, bottom, i + 1);
      }
    });
    const spacer = ws.addRow(columns.map(() => ''));
    spacer.height = 12;
    columns.forEach((_, i) => {
      spacer.getCell(i + 1).fill = fill(p.head);
      spacer.getCell(i + 1).border = border;
    });
  }

  addRegistry(wb.addWorksheet('Registre'), doc, timing);
  return wb;
}

function addRegistry(ws: Worksheet, doc: ProjectDoc, timing: ReturnType<typeof computeTiming>) {
  ws.columns = [
    { header: 'N°', key: 'n', width: 6 },
    { header: 'Séquence', key: 'label', width: 30 },
    { header: 'Décor', key: 'decor', width: 24 },
    { header: 'INT/EXT', key: 'ie', width: 9 },
    { header: 'Effet', key: 'effect', width: 12 },
    { header: 'Personnages', key: 'chars', width: 30 },
    { header: 'Plans', key: 'shots', width: 7 },
    { header: 'Tournés', key: 'done', width: 8 },
    { header: 'Durée estimée', key: 'est', width: 13 },
    { header: 'Durée calculée', key: 'calc', width: 13 },
    { header: 'Écart', key: 'gap', width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  doc.project.sequenceIds.forEach((seqId, i) => {
    const seq = doc.sequences[seqId];
    if (!seq) return;
    const t = timing.sequences.get(seqId);
    ws.addRow({
      n: i + 1,
      label: seq.label,
      decor: seq.decorId ? (doc.decors[seq.decorId]?.name ?? '') : '',
      ie: seq.intExt ?? '',
      effect: seq.effect ?? '',
      chars: sequenceCharacterIds(doc, seqId).map((id) => doc.characters[id]?.name).join(', '),
      shots: seq.shotIds.length,
      done: seq.shotIds.filter((id) => doc.shots[id]?.status === 'tourné').length,
      est: seq.estimatedSec !== undefined ? formatTc(seq.estimatedSec) : '',
      calc: t ? formatTc(t.durationSec) : '',
      gap: t?.gap ? formatGap(t.gap) : '',
    });
  });
  ws.addRow([]);
  const h = ws.addRow(['', 'Personnage', 'Type', 'Comédien']);
  h.font = { bold: true };
  for (const c of Object.values(doc.characters).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
    ws.addRow(['', c.name, c.kind, c.actor ?? '']);
  }
}

export async function exportXlsx(doc: ProjectDoc): Promise<Blob> {
  const wb = await buildWorkbook(doc);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
