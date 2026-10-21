import { tcLast } from '../../domain/columns';
import type { Borders, PaperSize, Workbook, Worksheet } from 'exceljs';
import { sequenceCharacterIds } from '../../domain/characters';
import { COLUMN_DEFS, columnWidths } from '../../domain/columns';
import { sequenceMerges } from '../../domain/rows';
import { formatTc } from '../../domain/timecode';
import { computeTiming, formatGap } from '../../domain/timing';
import type { ColumnKey, ExportTheme, ProjectDoc } from '../../domain/types';

const PALETTES: Record<ExportTheme, { bg: string; head: string; title: string; ink: string; red: string; brown: string }> = {
  mauve: { bg: 'C98BB4', head: 'DFA6D3', title: '7A4E74', ink: '111111', red: 'C42B2B', brown: '7A2E1F' },
  papier: { bg: 'FBF8F2', head: 'E6DAC0', title: '2A2824', ink: '2A2824', red: '9C3D2B', brown: '5A3A24' },
  sobre: { bg: 'FFFFFF', head: 'E6E6E6', title: '000000', ink: '000000', red: '000000', brown: '000000' },
};

const FONT = 'Barlow Semi Condensed';
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
  // Économie d'encre : pas d'aplats, seulement le texte coloré et les filets.
  const p = doc.project.settings.exportInkSaver ? { ...base, bg: 'FFFFFF', head: 'FFFFFF' } : base;
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
  ws.headerFooter.oddFooter = `&L${doc.project.title} · ${doc.project.version}&Rpage &P / &N`;
  const widths = columnWidths(columns);
  ws.columns = columns.map((c) => ({ key: c, width: Math.max(4, (widths[c] / 100) * TOTAL_WIDTH) }));

  const title = ws.addRow(['Découpage technique']);
  ws.mergeCells(1, 1, 1, columns.length);
  title.height = 42;
  title.getCell(1).font = { name: 'Fraunces', size: 26, bold: true, color: { argb: `FF${p.title}` } };
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

  for (const seqId of doc.project.sequenceIds) {
    const { rows, merges } = sequenceMerges(doc, timing, seqId, columns);
    const first = ws.rowCount + 1;
    rows.forEach((r) => {
      const row = ws.addRow(columns.map(() => ''));
      row.height = 30;
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = r.cells[c] ?? '';
        cell.fill = fill(p.bg);
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.font = { name: FONT, size: 9, bold: true, italic: c === 'tc', color: { argb: `FF${colorFor(c, p)}` } };
      });
    });
    columns.forEach((c, i) => {
      for (const span of merges.get(c) ?? []) {
        if (span.span > 1) ws.mergeCells(first + span.startRow, i + 1, first + span.startRow + span.span - 1, i + 1);
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
