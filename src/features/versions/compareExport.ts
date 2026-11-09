/**
 * Export PDF d'une comparaison de versions : pages A4 au gabarit du scénario (Courier Prime 12 pt),
 * mêmes marques qu'à l'écran, sans couleur : bloc ajouté = filet noir épais à gauche et fond gris clair ;
 * bloc retiré = texte gris barré ; mots ajoutés = gras soulignés ; mots retirés = gris barrés.
 */
import { edges, type ScriptDiff, type DiffItem } from '../../domain/scriptDiff';
import { layoutDiff, type DiffLine } from '../../domain/scriptDiffLayout';
import { SCRIPT_COLUMNS, SCRIPT_PAGE, baselineOf } from '../../domain/scriptLayout';
import { loadFontBytes, type Face } from '../scenario/scriptExport';

/** Début de la ligne, selon l'alignement de sa colonne. */
function startX(l: DiffLine, len: number): number {
  const { cw, right } = SCRIPT_PAGE;
  if (l.align === 'right') return right - len * cw;
  if (l.align === 'center') {
    const col = SCRIPT_COLUMNS[l.type];
    return col.x + (col.chars * cw - len * cw) / 2;
  }
  return l.x;
}

export async function comparePdf(
  diff: ScriptDiff,
  items: readonly DiffItem[],
  header: readonly string[],
  meta: { title: string },
): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }, bytes] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    loadFontBytes(),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const faces: Face[] = ['regular', 'bold'];
  const fonts = Object.fromEntries(
    await Promise.all(faces.map(async (k) => [k, await pdf.embedFont(bytes[k], { subset: true })] as const)),
  ) as Record<'regular' | 'bold', Awaited<ReturnType<typeof pdf.embedFont>>>;
  const { w, h, fontSize, cw, lineH, sceneNumberRight, right, pageNumberBaseline } = SCRIPT_PAGE;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);
  const tint = rgb(0.92, 0.92, 0.92);
  const small = 8;
  const smallCw = (1228 / 2048) * small;
  const pages = layoutDiff(diff, items, header);
  for (const p of pages) {
    const page = pdf.addPage([w, h]);
    if (p.number > 1) {
      const t = `${p.number}.`;
      page.drawText(t, {
        x: right - t.length * cw,
        y: h - pageNumberBaseline,
        size: fontSize,
        font: fonts.regular,
        color: black,
      });
    }
    for (const l of p.lines) {
      const base = baselineOf(l.row);
      const y = h - base;
      // Hauteur d'une ligne autour de sa ligne de base : les lignes d'un bloc ajouté se touchent.
      const top = y + lineH * 0.76;
      if (l.kind === 'text' && l.op === 'add') {
        page.drawRectangle({ x: l.x - 3, y: top - lineH, width: l.width + 6, height: lineH, color: tint });
        page.drawRectangle({ x: l.x - 7.5, y: top - lineH, width: 2.2, height: lineH, color: black });
      }
      const len = l.runs.reduce((n, r) => n + r.text.length, 0);
      let x = startX(l, len);
      for (const r of l.runs) {
        const removed = r.op === 'del' || l.op === 'del' || l.kind === 'fold';
        const added = r.op === 'add' && l.op === 'mod';
        const bold = added || (l.kind === 'head' && l.type === 'heading');
        const color = removed ? gray : black;
        if (r.text.trim())
          page.drawText(r.text, { x, y, size: fontSize, font: bold ? fonts.bold : fonts.regular, color });
        const [lead, core] = edges(r.text);
        const x0 = x + lead.length * cw;
        const x1 = x0 + core.length * cw;
        if (core && added)
          page.drawLine({
            start: { x: x0, y: y - 1.9 },
            end: { x: x1, y: y - 1.9 },
            thickness: 0.7,
            color: black,
          });
        if (core && (r.op === 'del' || l.op === 'del') && l.kind === 'text')
          page.drawLine({
            start: { x: x0, y: y + 3.4 },
            end: { x: x1, y: y + 3.4 },
            thickness: 0.6,
            color: gray,
          });
        x += r.text.length * cw;
      }
      if (l.sceneNumber) {
        const t = `${l.sceneNumber}.`;
        const x0 = sceneNumberRight - t.length * cw;
        page.drawText(t, {
          x: x0,
          y,
          size: fontSize,
          font: fonts.regular,
          color: l.op === 'del' ? gray : black,
        });
        if (l.op === 'del')
          page.drawLine({
            start: { x: x0, y: y + 3.4 },
            end: { x: sceneNumberRight, y: y + 3.4 },
            thickness: 0.6,
            color: gray,
          });
      }
      if (l.margin)
        page.drawText(l.margin, {
          x: sceneNumberRight - l.margin.length * smallCw,
          y: y - lineH,
          size: small,
          font: fonts.regular,
          color: gray,
        });
    }
  }
  pdf.setTitle(`${meta.title} : ${header[0] ?? 'comparaison'}`);
  pdf.setCreator('Découpage Studio');
  pdf.setProducer('Découpage Studio');
  pdf.setLanguage('fr-FR');
  const out = await pdf.save();
  return new Blob([out], { type: 'application/pdf' });
}
